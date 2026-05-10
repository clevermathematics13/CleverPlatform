import { createClient } from "@/lib/supabase/server";
import { probeQuestionPartsColumns, stripUnsupportedColumns } from "@/lib/question-parts-compat";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import ReviewClient from "./review-client";

type ReviewQuestionRow = Parameters<typeof ReviewClient>[0]["initialQuestions"][number];

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

  // Step 1: get all question IDs that have extracted images (targeted query, no row-limit risk)
  // We only need the IDs to bucket questions into the right fetch groups, so select minimally.
  const { data: imageRows } = await supabase
    .from("question_images")
    .select("question_id, image_type")
    .limit(10000);

  const allImageIds = [...new Set((imageRows ?? []).map((r) => r.question_id))];

  // Step 1b: get question IDs that have any latex stored in their parts
  const { data: latexPartRows } = await supabase
    .from("question_parts")
    .select("question_id")
    .or("content_latex.not.is.null,markscheme_latex.not.is.null");

  const withLatexIds = [...new Set((latexPartRows ?? []).map((r) => r.question_id as string))];

  // Step 2: fetch questions that have images (up to 100), then questions with
  // latex, then fill remainder with others (have google_doc_id / source_pdf_path)

  // Probe for migrations 029/030 (stem_latex, parts_draft_* columns on ib_questions).
  // If those migrations haven't been applied yet PostgREST returns an error for any
  // query that selects those columns, which would make the whole page return 0 results.
  const { error: stemProbeErr } = await supabase
    .from("ib_questions")
    .select("stem_latex")
    .limit(0);

  const coreSelectFields =
    "id, code, session, paper, level, timezone, page_image_paths, source_pdf_path, google_doc_id, google_ms_id, question_parts(id, part_label, marks, subtopic_codes, command_term, instructional_context_terms, sort_order, is_hence, is_hence_or_otherwise, is_using, is_deduce, is_verify, content_latex, markscheme_latex, latex_verified)";
  const fullSelectFields =
    "id, code, session, paper, level, timezone, page_image_paths, source_pdf_path, google_doc_id, google_ms_id, stem_latex, stem_markscheme_latex, parts_draft_latex, parts_draft_markscheme_latex, question_parts(id, part_label, marks, subtopic_codes, command_term, instructional_context_terms, sort_order, is_hence, is_hence_or_otherwise, is_using, is_deduce, is_verify, content_latex, markscheme_latex, latex_verified)";

  const baseSelectFields: string = stemProbeErr ? coreSelectFields : fullSelectFields;

  const excludeImgClause = allImageIds.slice(0, 200).join(",") || "00000000-0000-0000-0000-000000000000";

  const supportedColumns = await probeQuestionPartsColumns(async (col) => {
    const { error } = await supabase.from("question_parts").select(col).limit(0);
    return error;
  });

  const selectFields = stripUnsupportedColumns(baseSelectFields, supportedColumns);

  const [imgQuestions, latexQuestions, otherQuestions, focusQuestions] = await Promise.all([
    allImageIds.length > 0
      ? supabase.from("ib_questions").select(selectFields).in("id", allImageIds).order("code").limit(200)
      : Promise.resolve({ data: [], error: null }),
    withLatexIds.length > 0
      ? supabase.from("ib_questions").select(selectFields).in("id", withLatexIds).order("code").limit(200)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("ib_questions")
      .select(selectFields)
      .not("id", "in", `(${excludeImgClause})`)
      .or("google_doc_id.not.is.null,source_pdf_path.not.is.null")
      .order("code")
      .limit(200),
    focusId
      ? supabase.from("ib_questions").select(selectFields).eq("id", focusId).limit(1)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const groupedQuestionsResult = { imgQuestions, latexQuestions, otherQuestions, focusQuestions };

  const {
    imgQuestions: imgQuestionsResult,
    latexQuestions: latexQuestionsResult,
    otherQuestions: otherQuestionsResult,
    focusQuestions: focusQuestionsResult,
  } = groupedQuestionsResult;

  const imgQuestionRows = imgQuestionsResult.data;
  const latexQuestionRows = latexQuestionsResult.data;
  const otherQuestionRows = otherQuestionsResult.data;
  const focusQuestionRows = focusQuestionsResult.data;

  // Merge: focused question first (guaranteed), then image questions, latex, others; deduplicate
  const seen = new Set<string>();
  const mergedCandidates: unknown[] = [
    ...(focusQuestionRows ?? []),
    ...(imgQuestionRows ?? []),
    ...(latexQuestionRows ?? []),
    ...(otherQuestionRows ?? []),
  ];
  const merged = mergedCandidates.filter((q) => {
    if (!q || typeof q !== "object" || !("id" in q) || typeof q.id !== "string") return false;
    if (seen.has(q.id)) return false;
    seen.add(q.id);
    return true;
  }) as ReviewQuestionRow[];

  // Targeted image-presence lookup for the merged set (avoids Supabase 1000-row default cap)
  const mergedIds = merged.map((q) => q.id);
  const withQImg2 = new Set<string>();
  const withMSImg2 = new Set<string>();
  if (mergedIds.length > 0) {
    const { data: targetedImageRows } = await supabase
      .from("question_images")
      .select("question_id, image_type")
      .in("question_id", mergedIds);
    for (const row of targetedImageRows ?? []) {
      if (row.image_type === "question") withQImg2.add(row.question_id);
      if (row.image_type === "markscheme") withMSImg2.add(row.question_id);
    }
  }

  const enriched = merged.map((q) => ({
    ...q,
    has_question_images: withQImg2.has(q.id),
    has_markscheme_images: withMSImg2.has(q.id),
  }));

  return (
    <Suspense>
      <ReviewClient initialQuestions={enriched} focusId={focusId ?? null} />
    </Suspense>
  );
}
