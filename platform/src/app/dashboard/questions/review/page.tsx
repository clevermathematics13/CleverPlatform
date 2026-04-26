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

  // Fetch questions that have a PDF source and at least one part with latex content
  const { data: questions } = await supabase
    .from("ib_questions")
    .select(
      "id, code, session, paper, level, timezone, page_image_paths, source_pdf_path, question_parts(id, part_label, marks, subtopic_codes, command_term, sort_order, content_latex, markscheme_latex, latex_verified)"
    )
    .not("source_pdf_path", "is", null)
    .order("code", { ascending: true });

  return <ReviewClient initialQuestions={questions ?? []} />;
}
