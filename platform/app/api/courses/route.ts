import { NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

export async function GET() {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user, profile } = auth;

  const { data: courses, error } = await supabase
    .from("courses")
    .select("id, name")
    .order("name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ courses: courses ?? [] });
}
