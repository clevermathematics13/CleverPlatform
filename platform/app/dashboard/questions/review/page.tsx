import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import ReviewClient from "./review-client";

export default async function ReviewPage() {
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

  // Step 1: get all question IDs that have extracted images
  const { data: imageRows } = await supabase
    .from("question_images")
    .select("question_id, image_type");

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
  const selectFields =
    "id, code, session, paper, level, timezone, page_image_paths, source_pdf_path, question_parts(id, part_label, marks, subtopic_codes, command_term, sort_order, content_latex, markscheme_latex, latex_verified)";

  const excludeImgClause = allImageIds.slice(0, 200).join(",") || "00000000-0000-0000-0000-000000000000";

  const [{ data: imgQuestions }, { data: latexQuestions }, { data: otherQuestions }] = await Promise.all([
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
  ]);

  // Merge: image questions first, then latex questions, then others; deduplicate
  const seen = new Set<string>();
  const merged = [...(imgQuestions ?? []), ...(latexQuestions ?? []), ...(otherQuestions ?? [])].filter((q) => {
    if (seen.has(q.id)) return false;
    seen.add(q.id);
    return true;
  });

  const enriched = merged.map((q) => ({
    ...q,
    has_question_images: withQImg.has(q.id),
    has_markscheme_images: withMSImg.has(q.id),
  }));

  return <ReviewClient initialQuestions={enriched} />;
}
