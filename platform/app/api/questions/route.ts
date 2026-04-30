import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
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
  const url = request.nextUrl;

  const search = url.searchParams.get("search") ?? "";
  const session = url.searchParams.get("session") ?? "";
  const paper = url.searchParams.get("paper") ?? "";
  const level = url.searchParams.get("level") ?? "";
  const timezone = url.searchParams.get("timezone") ?? "";
  const subtopic = url.searchParams.get("subtopic") ?? "";
  const searchContent = url.searchParams.get("searchContent") === "1";
  const page = parseInt(url.searchParams.get("page") ?? "1") || 1;
  const pageSize = 50;

  // If content search is active, find matching question IDs via question_parts.content_latex
  let contentSearchQuestionIds: string[] | null = null;
  if (searchContent && search) {
    const { data: matchingParts } = await supabase
      .from("question_parts")
      .select("question_id")
      .ilike("content_latex", `%${search}%`);
    if (matchingParts && matchingParts.length > 0) {
      contentSearchQuestionIds = [...new Set(matchingParts.map((p) => p.question_id))];
    } else {
      return NextResponse.json({ questions: [], total: 0, page, pageSize });
    }
  }

  // If subtopic filter is active, first find matching question IDs via raw SQL
  let subtopicQuestionIds: string[] | null = null;
  if (subtopic) {
    // Use RPC-style raw query to handle array containment properly
    const { data: matchingParts, error: subtopicError } = await supabase
      .from("question_parts")
      .select("question_id")
      .overlaps("subtopic_codes", [subtopic]);

    if (subtopicError) {
      // Fallback: try contains
      const { data: fallbackParts } = await supabase
        .from("question_parts")
        .select("question_id")
        .contains("subtopic_codes", [subtopic]);

      if (fallbackParts && fallbackParts.length > 0) {
        subtopicQuestionIds = [...new Set(fallbackParts.map((p) => p.question_id))];
      } else {
        return NextResponse.json({ questions: [], total: 0, page, pageSize });
      }
    } else if (matchingParts && matchingParts.length > 0) {
      subtopicQuestionIds = [...new Set(matchingParts.map((p) => p.question_id))];
    } else {
      return NextResponse.json({ questions: [], total: 0, page, pageSize });
    }
  }

  // Build query for questions with parts — show questions that have a Google Doc OR a PDF source
  let query = supabase
    .from("ib_questions")
    .select(
      "id, code, session, paper, level, timezone, difficulty, google_doc_id, google_ms_id, section, curriculum, source_pdf_path, page_image_paths, question_parts(id, part_label, marks, subtopic_codes, command_term, sort_order, content_latex, markscheme_latex, latex_verified)",
      { count: "exact" }
    )
    .or("google_doc_id.not.is.null,source_pdf_path.not.is.null")
    .order("code", { ascending: true })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (search && !searchContent) {
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
  if (contentSearchQuestionIds) {
    query = query.in("id", contentSearchQuestionIds);
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

  // Determine which questions have images (batch query on question_images)
  const questionIds = filtered.map((q) => q.id);
  const withQuestionImages = new Set<string>();
  const withMarkschemeImages = new Set<string>();

  if (questionIds.length > 0) {
    const { data: imageRows } = await supabase
      .from("question_images")
      .select("question_id, image_type")
      .in("question_id", questionIds);

    for (const row of imageRows ?? []) {
      if (row.image_type === "question") withQuestionImages.add(row.question_id);
      if (row.image_type === "markscheme") withMarkschemeImages.add(row.question_id);
    }
  }

  const enriched = filtered.map((q) => ({
    ...q,
    has_question_images: withQuestionImages.has(q.id),
    has_markscheme_images: withMarkschemeImages.has(q.id),
  }));

  return NextResponse.json({
    questions: enriched,
    total: count ?? 0,
    page,
    pageSize,
  });
}
