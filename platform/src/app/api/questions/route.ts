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

  // If subtopic filter is active, first find matching question IDs
  let subtopicQuestionIds: string[] | null = null;
  if (subtopic) {
    const { data: matchingParts } = await supabase
      .from("question_parts")
      .select("question_id")
      .contains("subtopic_codes", [subtopic]);

    if (matchingParts && matchingParts.length > 0) {
      subtopicQuestionIds = [...new Set(matchingParts.map((p) => p.question_id))];
    } else {
      // No questions have this subtopic — return empty
      return NextResponse.json({ questions: [], total: 0, page, pageSize });
    }
  }

  // Build query for questions with parts
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
  if (subtopicQuestionIds) {
    query = query.in("id", subtopicQuestionIds);
  }

  const { data: questions, count, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const filtered = questions ?? [];

  // Sort parts within each question
  for (const q of filtered) {
    const parts = q.question_parts as { sort_order: number }[];
    parts.sort((a, b) => a.sort_order - b.sort_order);
  }

  return NextResponse.json({
    questions: filtered,
    total: count ?? 0,
    page,
    pageSize,
  });
}
