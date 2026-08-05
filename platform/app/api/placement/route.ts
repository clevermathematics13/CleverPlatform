import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

// GET /api/placement — list this teacher's placement tests
export async function GET(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const { data, error } = await supabase
    .from("placement_tests")
    .select(
      "id, student_name, student_name_source, student_name_confidence, student_name_notes, printed_grade_level, grade_level, grade_level_source, grade_level_confidence, grade_level_notes, file_name, status, error_message, created_at, completed_at"
    )
    .eq("teacher_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ placementTests: data ?? [] });
}
