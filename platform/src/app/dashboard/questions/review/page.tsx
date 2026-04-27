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

  // Fetch all questions that have at least one part (limit to 200 at a time for performance)
  // has_question_images / has_markscheme_images are denormalised flags set by the extract-images pipeline
  const { data: questions } = await supabase
    .from("ib_questions")
    .select(
      "id, code, session, paper, level, timezone, page_image_paths, source_pdf_path, has_question_images, has_markscheme_images, question_parts(id, part_label, marks, subtopic_codes, command_term, sort_order, content_latex, markscheme_latex, latex_verified)"
    )
    .order("has_question_images", { ascending: false }) // images-first
    .order("code", { ascending: true })
    .limit(200);

  return <ReviewClient initialQuestions={questions ?? []} />;
}
