import { createClient } from "@/lib/supabase/server";
import { probeQuestionPartsColumns, stripUnsupportedColumns } from "@/lib/question-parts-compat";
import { fetchAllRows, fetchInChunks } from "@/lib/supabase-paging";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import ReviewClient from "./review-client";
import type { SchemeBuildSummary } from "./components/review-types";

type ReviewQuestionRow = Parameters<typeof ReviewClient>[0]["initialQuestions"][number];
type Rows<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

// How many questions each group below contributes, besides every question
// with a flagged mark-scheme build and the focused one.
const GROUP_SIZE = 200;

/** A read that fails leaves its group empty, as a failed query always has here, rather than failing the page. */
async function orEmpty<T>(rows: Promise<T[]>): Promise<T[]> {
  try {
    return await rows;
  } catch {
    return [];
  }
}

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string }>;
}) {
  const { focus: focusId } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "teacher") redirect("/unauthorized");

  // Step 1: the questions that have extracted images, and those with LaTeX on
  // any part. Both reads are paged: each outgrows PostgREST's 1000-row cap
  // (the scheme images alone are over 1,200 rows), and a capped read drops
  // questions without saying so.
  const [codeRows, imageRows, latexPartRows, flaggedBuilds] = await Promise.all([
    // Every question's code, in code order, to pick each group's first GROUP_SIZE.
    orEmpty(
      fetchAllRows<{ id: string; code: string }>((from, to) =>
        supabase.from("ib_questions").select("id, code").order("code").order("id").range(from, to)
      )
    ),
    orEmpty(
      fetchAllRows<{ question_id: string }>((from, to) =>
        supabase.from("question_images").select("question_id").order("id").range(from, to)
      )
    ),
    orEmpty(
      fetchAllRows<{ question_id: string }>((from, to) =>
        supabase
          .from("question_parts")
          .select("question_id")
          .or("content_latex.not.is.null,markscheme_latex.not.is.null")
          .order("id")
          .range(from, to)
      )
    ),
    // Mark-scheme builds waiting for the teacher (scripts/build-mark-schemes.ts).
    // Only why they were flagged rides on the page; a card loads its proposal.
    orEmpty(
      fetchAllRows<{
        id: string;
        question_id: string;
        created_at: string;
        checks: { issues?: string[] } | null;
        plan: { flags?: string[] } | null;
      }>((from, to) =>
        supabase
          .from("markscheme_builds")
          .select("id, question_id, created_at, checks, plan")
          .eq("status", "flagged")
          .order("id")
          .range(from, to)
      )
    ),
  ]);

  const imageIds = new Set(imageRows.map((r) => r.question_id));
  const latexIds = new Set(latexPartRows.map((r) => r.question_id));
  const buildByQuestion = new Map<string, SchemeBuildSummary>(
    flaggedBuilds.map((b) => [
      b.question_id,
      { id: b.id, createdAt: b.created_at, issues: b.checks?.issues ?? [], flags: b.plan?.flags ?? [] },
    ])
  );

  // Step 2: fetch questions that have images, then questions with latex, then
  // fill remainder with others (have google_doc_id / source_pdf_path)

  // Probe for migrations 029/030 (stem_latex, parts_draft_* columns on ib_questions).
  // If those migrations haven't been applied yet PostgREST returns an error for any
  // query that selects those columns, which would make the whole page return 0 results.
  const { error: stemProbeErr } = await supabase
    .from("ib_questions")
    .select("stem_latex")
    .limit(0);

  const coreSelectFields =
    "id, code, session, paper, level, timezone, page_image_paths, source_pdf_path, google_doc_id, google_ms_id, question_parts(id, part_label, marks, subtopic_codes, command_term, command_terms, instructional_context_terms, sort_order, is_hence, is_hence_or_otherwise, is_using, is_deduce, is_verify, content_latex, markscheme_latex, latex_verified, mark_attributions)";
  const fullSelectFields =
    "id, code, session, paper, level, timezone, page_image_paths, source_pdf_path, google_doc_id, google_ms_id, stem_latex, stem_markscheme_latex, parts_draft_latex, parts_draft_markscheme_latex, question_parts(id, part_label, marks, subtopic_codes, command_term, command_terms, instructional_context_terms, sort_order, is_hence, is_hence_or_otherwise, is_using, is_deduce, is_verify, content_latex, markscheme_latex, latex_verified, mark_attributions)";

  const baseSelectFields: string = stemProbeErr ? coreSelectFields : fullSelectFields;

  const supportedColumns = await probeQuestionPartsColumns(async (col) => {
    const { error } = await supabase.from("question_parts").select(col).limit(0);
    return error;
  });

  const selectFields = stripUnsupportedColumns(baseSelectFields, supportedColumns);

  // Questions by id, 100 ids a request: a thousand ids in one .in() is a URL
  // longer than the gateway accepts.
  const loadQuestions = (ids: readonly string[]) =>
    fetchInChunks<ReviewQuestionRow>(
      ids,
      (chunk) => supabase.from("ib_questions").select(selectFields).in("id", chunk) as unknown as Rows<ReviewQuestionRow>
    );
  // The first GROUP_SIZE of these questions by code.
  const firstByCode = async (ids: Set<string>) => {
    const chosen = codeRows
      .filter((r) => ids.has(r.id))
      .slice(0, GROUP_SIZE)
      .map((r) => r.id);
    return (await loadQuestions(chosen)).sort((a, b) => a.code.localeCompare(b.code));
  };

  const [imgQuestionRows, latexQuestionRows, flaggedQuestionRows, focusQuestionRows] = await Promise.all([
    orEmpty(firstByCode(imageIds)),
    orEmpty(firstByCode(latexIds)),
    orEmpty(loadQuestions([...buildByQuestion.keys()])),
    focusId ? orEmpty(loadQuestions([focusId])) : Promise.resolve([] as ReviewQuestionRow[]),
  ]);

  const excludeImgClause =
    imgQuestionRows.map((q) => q.id).join(",") || "00000000-0000-0000-0000-000000000000";
  const { data: otherQuestionRows } = await supabase
    .from("ib_questions")
    .select(selectFields)
    .not("id", "in", `(${excludeImgClause})`)
    .or("google_doc_id.not.is.null,source_pdf_path.not.is.null")
    .order("code")
    .limit(GROUP_SIZE);

  // Merge: focused question first (guaranteed), then the flagged builds waiting
  // for review, image questions, latex, others; deduplicate
  const seen = new Set<string>();
  const mergedCandidates: unknown[] = [
    ...focusQuestionRows,
    ...flaggedQuestionRows.sort((a, b) => a.code.localeCompare(b.code)),
    ...imgQuestionRows,
    ...latexQuestionRows,
    ...((otherQuestionRows as unknown[] | null) ?? []),
  ];
  const merged = mergedCandidates.filter((q) => {
    if (!q || typeof q !== "object" || !("id" in q) || typeof q.id !== "string") return false;
    if (seen.has(q.id)) return false;
    seen.add(q.id);
    return true;
  }) as ReviewQuestionRow[];

  // Targeted image-presence lookup for the merged set, 50 questions a request
  // so that neither the URL nor the 1000-row cap is reached.
  const withQImg2 = new Set<string>();
  const withMSImg2 = new Set<string>();
  const targetedImageRows = await orEmpty(
    fetchInChunks<{ question_id: string; image_type: string }>(
      merged.map((q) => q.id),
      (chunk) => supabase.from("question_images").select("question_id, image_type").in("question_id", chunk),
      50
    )
  );
  for (const row of targetedImageRows) {
    if (row.image_type === "question") withQImg2.add(row.question_id);
    if (row.image_type === "markscheme") withMSImg2.add(row.question_id);
  }

  const enriched = merged.map((q) => ({
    ...q,
    has_question_images: withQImg2.has(q.id),
    has_markscheme_images: withMSImg2.has(q.id),
    scheme_build: buildByQuestion.get(q.id) ?? null,
  }));

  return (
    <Suspense>
      <ReviewClient initialQuestions={enriched} focusId={focusId ?? null} />
    </Suspense>
  );
}
