import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  // teacher_settings holds one row per teacher (UNIQUE(teacher_id)), but this
  // endpoint is unauthenticated, so there is no caller identity to resolve a
  // specific teacher from. Ordering by teacher_id makes the choice stable
  // instead of leaving it to whatever order Postgres happens to return, which
  // could otherwise flip between deploys once a second teacher exists.
  //
  // TODO(multi-teacher): these flags decide whether a student sees corrections
  // and feedback at all. Before onboarding a second teacher, this must resolve
  // the teacher from the requesting student's course rather than picking first.
  const { data } = await supabase
    .from("teacher_settings")
    .select("show_corrections, show_feedback")
    .order("teacher_id", { ascending: true })
    .limit(1)
    .maybeSingle();
  return NextResponse.json({ show_corrections: data?.show_corrections ?? false, show_feedback: data?.show_feedback ?? false });
}