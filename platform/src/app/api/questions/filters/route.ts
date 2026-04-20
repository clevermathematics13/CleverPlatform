import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** GET /api/questions/filters — return distinct sessions, timezones, subtopics for filter dropdowns */
export async function GET(_request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role !== "teacher") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [sessionsRes, subtopicsRes] = await Promise.all([
    supabase
      .from("ib_questions")
      .select("session, timezone")
      .order("session", { ascending: true }),
    supabase
      .from("subtopics")
      .select("code, descriptor, section")
      .order("code", { ascending: true }),
  ]);

  const sessions = [
    ...new Set((sessionsRes.data ?? []).map((r) => r.session)),
  ].sort();
  const timezones = [
    ...new Set((sessionsRes.data ?? []).map((r) => r.timezone)),
  ].sort();

  return NextResponse.json({
    sessions,
    timezones,
    subtopics: subtopicsRes.data ?? [],
  });
}
