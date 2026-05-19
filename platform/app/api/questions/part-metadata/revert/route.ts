import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getApiTeacher } from "@/lib/auth";
import { deriveCommandTermFlags, deriveInstructionalContextTerms } from "@/lib/command-term-flags";
import { probeQuestionPartsColumns, stripUnsupportedColumns, omitUnsupportedColumns } from "@/lib/question-parts-compat";

type RevertBody = {
  partId?: unknown;
  historyId?: unknown;
};

const PART_SELECT = "id, part_label, marks, subtopic_codes, command_term, command_terms, instructional_context_terms, sort_order, is_hence, is_hence_or_otherwise, is_using, is_deduce, is_verify, content_latex, markscheme_latex, latex_verified";

type PartMetadataRow = {
  id: string;
  question_id: string;
  part_label: string;
  marks: number;
  command_term: string | null;
  subtopic_codes: string[] | null;
  sort_order: number;
};

async function snapshotPartMetadata(
  supabase: Awaited<ReturnType<typeof createClient>>,
  part: PartMetadataRow,
  changedBy: string,
) {
  const { error } = await supabase
    .from("question_part_metadata_history")
    .insert({
      part_id: part.id,
      question_id: part.question_id,
      part_label: part.part_label ?? "",
      marks: part.marks ?? 1,
      command_term: part.command_term,
      subtopic_codes: part.subtopic_codes ?? [],
      sort_order: part.sort_order ?? 0,
      changed_by: changedBy,
    });

  return error;
}

export async function POST(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user, profile } = auth;

  let body: RevertBody;
  try {
    body = (await request.json()) as RevertBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { partId, historyId } = body;
  if (typeof partId !== "string" || !partId) {
    return NextResponse.json({ error: "partId is required" }, { status: 400 });
  }

  const { data: currentPart, error: currentErr } = await supabase
    .from("question_parts")
    .select("id, question_id, part_label, marks, command_term, subtopic_codes, sort_order, content_latex")
    .eq("id", partId)
    .single();

  if (currentErr || !currentPart) {
    return NextResponse.json({ error: "Part not found" }, { status: 404 });
  }

  const historyQuery = supabase
    .from("question_part_metadata_history")
    .select("id, part_id, part_label, marks, command_term, subtopic_codes, sort_order");

  const { data: previous, error: previousErr } =
    typeof historyId === "string" && historyId
      ? await historyQuery
          .eq("id", historyId)
          .eq("part_id", partId)
          .maybeSingle()
      : await historyQuery
          .eq("part_id", partId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

  if (previousErr) {
    return NextResponse.json({ error: previousErr.message }, { status: 500 });
  }

  if (!previous) {
    return NextResponse.json({ error: "No previous metadata snapshot found" }, { status: 404 });
  }

  const historyErr = await snapshotPartMetadata(supabase, currentPart as PartMetadataRow, user.id);
  if (historyErr) {
    return NextResponse.json({ error: historyErr.message }, { status: 500 });
  }

  const updatePayload = {
    part_label: previous.part_label ?? "",
    marks: previous.marks ?? 1,
    command_term: previous.command_term,
    command_terms: previous.command_term ? [previous.command_term] : [],
    ...deriveCommandTermFlags({
      commandTerm: previous.command_term,
      sourceLatex: currentPart.content_latex ?? "",
    }),
    instructional_context_terms: deriveInstructionalContextTerms({
      commandTerm: previous.command_term,
      sourceLatex: currentPart.content_latex ?? "",
    }),
    subtopic_codes: previous.subtopic_codes ?? [],
    sort_order: previous.sort_order ?? 0,
  };

  const supportedColumns = await probeQuestionPartsColumns(async (col) => {
    const { error } = await supabase.from("question_parts").select(col).limit(0);
    return error;
  });

  const { data: reverted, error: revertErr } = await supabase
    .from("question_parts")
    .update(omitUnsupportedColumns(updatePayload, supportedColumns))
    .eq("id", partId)
    .select(stripUnsupportedColumns(PART_SELECT, supportedColumns))
    .single();

  if (revertErr) {
    return NextResponse.json({ error: revertErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, part: reverted });
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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

  const partId = request.nextUrl.searchParams.get("partId");
  if (!partId) {
    return NextResponse.json({ error: "partId is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("question_part_metadata_history")
    .select("id, part_label, marks, command_term, subtopic_codes, sort_order, changed_by, created_at")
    .eq("part_id", partId)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, versions: data ?? [] });
}
