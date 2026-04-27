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

  // Fetch 200 questions with their parts
  const { data: rawQuestions } = await supabase
    .from("ib_questions")
    .select(
      "id, code, session, paper, level, timezone, page_image_paths, source_pdf_path, question_parts(id, part_label, marks, subtopic_codes, command_term, sort_order, content_latex, markscheme_latex, latex_verified)"
    )
    .order("code", { ascending: true })
    .limit(200);

  const questions = rawQuestions ?? [];

  // has_question_images / has_markscheme_images are derived from the question_images table
  // (not columns on ib_questions) — compute them with a single aggregation query
  let withImages: { question_id: string; image_type: string }[] = [];
  if (questions.length > 0) {
    const ids = questions.map((q) => q.id);
    const { data } = await supabase
      .from("question_images")
      .select("question_id, image_type")
      .in("question_id", ids);
    withImages = data ?? [];
  }

  const hasQImg = new Set(withImages.filter((r) => r.image_type === "question").map((r) => r.question_id));
  const hasMSImg = new Set(withImages.filter((r) => r.image_type === "markscheme").map((r) => r.question_id));

  const enriched = questions
    .map((q) => ({
      ...q,
      has_question_images: hasQImg.has(q.id),
      has_markscheme_images: hasMSImg.has(q.id),
    }))
    // Sort so questions with images come first
    .sort((a, b) => {
      const aImg = a.has_question_images || a.has_markscheme_images ? 1 : 0;
      const bImg = b.has_question_images || b.has_markscheme_images ? 1 : 0;
      return bImg - aImg || a.code.localeCompare(b.code);
    });

  return <ReviewClient initialQuestions={enriched} />;
}
