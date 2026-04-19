import { NextRequest, NextResponse } from "next/server";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** GET /api/questions/filters — return distinct sessions, timezones, subtopics for filter dropdowns */
export async function GET(_request: NextRequest) {
  const profile = await getProfile();
  if (profile.role !== "teacher") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();

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
