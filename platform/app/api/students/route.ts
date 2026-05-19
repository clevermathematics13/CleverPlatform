import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user, profile } = auth;

  const courseId = request.nextUrl.searchParams.get("courseId");
  if (!courseId) {
    return NextResponse.json({ error: "courseId is required" }, { status: 400 });
  }

  const { data: students, error } = await supabase
    .from("students")
    .select("id, profiles:profile_id(display_name, nickname)")
    .eq("course_id", courseId)
    .eq("hidden", false)
    .order("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ students: students ?? [] });
}
