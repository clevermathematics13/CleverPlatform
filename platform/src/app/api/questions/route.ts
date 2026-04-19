import { NextRequest, NextResponse } from "next/server";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const profile = await getProfile();
  if (profile.role !== "teacher") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const url = request.nextUrl;

  const search = url.searchParams.get("search") ?? "";
  const session = url.searchParams.get("session") ?? "";
  const paper = url.searchParams.get("paper") ?? "";
  const level = url.searchParams.get("level") ?? "";
  const timezone = url.searchParams.get("timezone") ?? "";
  const subtopic = url.searchParams.get("subtopic") ?? "";
  const page = parseInt(url.searchParams.get("page") ?? "1") || 1;
  const pageSize = 50;

  // Build query for questions with parts count
  let query = supabase
    .from("ib_questions")
    .select(
      "id, code, session, paper, level, timezone, difficulty, google_doc_id, google_ms_id, question_parts(id, part_label, marks, subtopic_codes, command_term, sort_order)",
      { count: "exact" }
    )
    .order("code", { ascending: true })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (search) {
    query = query.ilike("code", `%${search}%`);
  }
  if (session) {
    query = query.eq("session", session);
  }
  if (paper) {
    query = query.eq("paper", parseInt(paper));
  }
  if (level) {
    query = query.eq("level", level);
  }
  if (timezone) {
    query = query.eq("timezone", timezone);
  }

  const { data: questions, count, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // If subtopic filter is set, filter client-side (parts contain subtopic_codes arrays)
  let filtered = questions ?? [];
  if (subtopic) {
    filtered = filtered.filter((q) => {
      const parts = q.question_parts as { subtopic_codes: string[] }[];
      return parts.some((p) =>
        p.subtopic_codes?.some((c: string) => c.startsWith(subtopic))
      );
    });
  }

  // Sort parts within each question
  for (const q of filtered) {
    const parts = q.question_parts as { sort_order: number }[];
    parts.sort((a, b) => a.sort_order - b.sort_order);
  }

  return NextResponse.json({
    questions: filtered,
    total: subtopic ? filtered.length : (count ?? 0),
    page,
    pageSize,
  });
}
