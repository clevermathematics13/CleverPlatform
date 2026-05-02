import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import ReviewClient from "./review-client";

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

  const withQImg = new Set((imageRows ?? []).filter((r) => r.image_type === "question").map((r) => r.question_id));
  const withMSImg = new Set((imageRows ?? []).filter((r) => r.image_type === "markscheme").map((r) => r.question_id));
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
    "id, code, session, paper, level, timezone, page_image_paths, source_pdf_path, google_doc_id, google_ms_id, question_parts(id, part_label, marks, subtopic_codes, command_term, sort_order, content_latex, markscheme_latex, latex_verified)";
  const fullSelectFields =
    "id, code, session, paper, level, timezone, page_image_paths, source_pdf_path, google_doc_id, google_ms_id, stem_latex, stem_markscheme_latex, parts_draft_latex, parts_draft_markscheme_latex, question_parts(id, part_label, marks, subtopic_codes, command_term, sort_order, content_latex, markscheme_latex, latex_verified)";

  const selectFields = stemProbeErr ? coreSelectFields : fullSelectFields;

  const excludeImgClause = allImageIds.slice(0, 200).join(",") || "00000000-0000-0000-0000-000000000000";

  const [{ data: imgQuestions }, { data: latexQuestions }, { data: otherQuestions }, { data: focusQuestions }] = await Promise.all([
    allImageIds.length > 0
      ? supabase.from("ib_questions").select(selectFields).in("id", allImageIds).order("code").limit(200)
      : Promise.resolve({ data: [] }),
    withLatexIds.length > 0
      ? supabase.from("ib_questions").select(selectFields).in("id", withLatexIds).order("code").limit(200)
      : Promise.resolve({ data: [] }),
    supabase
      .from("ib_questions")
      .select(selectFields)
      .not("id", "in", `(${excludeImgClause})`)
      .or("google_doc_id.not.is.null,source_pdf_path.not.is.null")
      .order("code")
      .limit(200),
    // Always fetch the focused question so it's guaranteed to be in the list
    focusId
      ? supabase.from("ib_questions").select(selectFields).eq("id", focusId).limit(1)
      : Promise.resolve({ data: [] }),
  ]);

  // Merge: focused question first (guaranteed), then image questions, latex, others; deduplicate
  const seen = new Set<string>();
  const merged = [...(focusQuestions ?? []), ...(imgQuestions ?? []), ...(latexQuestions ?? []), ...(otherQuestions ?? [])].filter((q) => {
    if (seen.has(q.id)) return false;
    seen.add(q.id);
    return true;
  });

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
