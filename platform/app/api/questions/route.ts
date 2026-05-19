import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getApiTeacher } from "@/lib/auth";
import { deriveCommandTermFlags, deriveInstructionalContextTerms } from "@/lib/command-term-flags";
import {
  probeQuestionPartsColumns,
  stripUnsupportedColumns,
  omitUnsupportedColumns,
} from "@/lib/question-parts-compat";

const QUESTIONS_SELECT = "id, code, session, paper, level, timezone, difficulty, google_doc_id, google_ms_id, section, curriculum, source_pdf_path, page_image_paths, stem_latex, stem_markscheme_latex, parts_draft_latex, parts_draft_markscheme_latex, question_parts(id, part_label, marks, subtopic_codes, primary_subtopic_code, command_term, command_terms, instructional_context_terms, sort_order, is_hence, is_hence_or_otherwise, is_using, is_deduce, is_verify, content_latex, markscheme_latex, latex_verified, mark_attributions)";

type QuestionListRow = {
  id: string;
  question_parts: { sort_order: number }[];
  [key: string]: unknown;
};

export async function GET(request: NextRequest) {
  try {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user, profile } = auth;
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

  // Probe once for which optional columns exist in this DB, then use that for all selects.
  const supportedColumns = await probeQuestionPartsColumns(async (col) => {
    const { error } = await supabase.from("question_parts").select(col).limit(0);
    return error;
  });

  const selectStr = stripUnsupportedColumns(QUESTIONS_SELECT, supportedColumns);

  let query = supabase
    .from("ib_questions")
    .select(selectStr, { count: "exact" })
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

  const filtered = (questions ?? []) as unknown as QuestionListRow[];

  // Sort parts within each question
  for (const q of filtered) {
    const parts = (q.question_parts ?? []) as { sort_order: number }[];
    q.question_parts = parts;
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
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role !== "teacher") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    code?: string;
    session?: string;
    paper?: number;
    level?: string;
    timezone?: string;
    curriculum?: string | string[];
    stemLatex?: string;
    stemMarkschemeLatex?: string;
    parts?: {
      partLabel?: string;
      marks?: number | null;
      commandTerm?: string | null;
      commandTerms?: string[];
      subtopicCodes?: string[];
      contentLatex?: string;
      markschemeLatex?: string;
    }[];
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { code, session, paper, level, timezone, curriculum, stemLatex, stemMarkschemeLatex, parts } = body;

  if (!code?.trim()) return NextResponse.json({ error: "Code is required" }, { status: 400 });
  if (!session?.trim()) return NextResponse.json({ error: "Session is required" }, { status: 400 });
  if (!paper || ![1, 2, 3].includes(Number(paper))) {
    return NextResponse.json({ error: "Paper must be 1, 2, or 3" }, { status: 400 });
  }
  if (!level || !["AHL", "SL"].includes(level)) {
    return NextResponse.json({ error: "Level must be AHL or SL" }, { status: 400 });
  }
  const curriculaArr = (Array.isArray(curriculum) ? curriculum : [curriculum]).filter(Boolean) as string[];
  if (!curriculaArr.length || !curriculaArr.every((c) => ["AA", "AI"].includes(c))) {
    return NextResponse.json({ error: "Curriculum must be AA and/or AI" }, { status: 400 });
  }

  const { data: question, error: qError } = await supabase
    .from("ib_questions")
    .insert({
      code: code.trim(),
      session: session.trim(),
      paper: Number(paper),
      level,
      timezone: timezone?.trim() || "TZ0",
      curriculum: curriculaArr,
      source_pdf_path: "manual",
      stem_latex: stemLatex?.trim() || null,
      stem_markscheme_latex: stemMarkschemeLatex?.trim() || null,
    })
    .select("id")
    .single();

  if (qError) {
    return NextResponse.json({ error: qError.message }, { status: 500 });
  }

  if (parts && parts.length > 0) {
    const partRows = parts.map((p, idx) => ({
      question_id: question.id,
      part_label: p.partLabel?.trim() ?? '',
      marks: p.marks != null ? Number(p.marks) : null,
      command_term: p.commandTerms && p.commandTerms.length > 0 ? p.commandTerms[0] : (p.commandTerm || null),
      command_terms: p.commandTerms ?? (p.commandTerm ? [p.commandTerm] : []),
      ...deriveCommandTermFlags({
        commandTerm: p.commandTerms && p.commandTerms.length > 0 ? p.commandTerms[0] : (p.commandTerm || null),
        sourceLatex: p.contentLatex?.trim() || "",
      }),
      instructional_context_terms: deriveInstructionalContextTerms({
        commandTerm: p.commandTerms && p.commandTerms.length > 0 ? p.commandTerms[0] : (p.commandTerm || null),
        sourceLatex: p.contentLatex?.trim() || "",
      }),
      subtopic_codes: p.subtopicCodes ?? [],
      sort_order: idx,
      content_latex: p.contentLatex?.trim() || null,
      markscheme_latex: p.markschemeLatex?.trim() || null,
      latex_verified: false,
    }));

    const supportedColumns = await probeQuestionPartsColumns(async (col) => {
      const { error } = await supabase.from("question_parts").select(col).limit(0);
      return error;
    });

    const { error: pError } = await supabase
      .from("question_parts")
      .insert(partRows.map((row) => omitUnsupportedColumns(row, supportedColumns)));

    if (pError) {
      return NextResponse.json({ error: pError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ id: question.id }, { status: 201 });
}
