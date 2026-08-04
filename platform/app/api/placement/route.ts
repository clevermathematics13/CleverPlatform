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
      "id, student_name, course_id, file_name, status, error_message, created_at, completed_at, courses:course_id(name)"
    )
    .eq("teacher_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ placementTests: data ?? [] });
}
