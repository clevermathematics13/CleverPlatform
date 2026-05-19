import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getApiTeacher } from "@/lib/auth";

async function loadAllQuestionFilterRows(
  supabase: Awaited<ReturnType<typeof createClient>>
) {
  const pageSize = 1000;
  const rows: Array<{ session: string; timezone: string }> = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("ib_questions")
      .select("session, timezone")
      .or("google_doc_id.not.is.null,source_pdf_path.not.is.null")
      .order("session", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      throw error;
    }

    const page = data ?? [];
    rows.push(...page);

    if (page.length < pageSize) {
      break;
    }
  }

  return rows;
}

/** GET /api/questions/filters — return distinct sessions, timezones, subtopics for filter dropdowns */
export async function GET(_request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user, profile } = auth;

  const [questionRows, subtopicsRes] = await Promise.all([
    loadAllQuestionFilterRows(supabase),
    supabase
      .from("subtopics")
      .select("code, descriptor, section")
      .order("code", { ascending: true }),
  ]);

  const sessions = [
    ...new Set((questionRows ?? []).map((r) => r.session)),
  ].sort();
  const timezones = [
    ...new Set((questionRows ?? []).map((r) => r.timezone)),
  ].sort();

  return NextResponse.json({
    sessions,
    timezones,
    subtopics: subtopicsRes.data ?? [],
  });
}
