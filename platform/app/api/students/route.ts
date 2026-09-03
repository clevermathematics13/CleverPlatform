import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { getShowHiddenStudents } from "@/lib/teacher-preferences";

export async function GET(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, profile } = auth;

  const courseId = request.nextUrl.searchParams.get("courseId");
  if (!courseId) {
    return NextResponse.json({ error: "courseId is required" }, { status: 400 });
  }

  const showHidden = await getShowHiddenStudents(supabase, profile.id);

  let query = supabase
    .from("students")
    .select("id, profile_id, profiles:profile_id(display_name, nickname)")
    .eq("course_id", courseId);
  if (!showHidden) query = query.eq("hidden", false);
  const { data: students, error } = await query.order("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ students: students ?? [] });
}
