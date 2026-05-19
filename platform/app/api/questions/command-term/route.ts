import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { deriveCommandTermFlags, deriveInstructionalContextTerms } from "@/lib/command-term-flags";
import { probeQuestionPartsColumns, stripUnsupportedColumns, omitUnsupportedColumns } from "@/lib/question-parts-compat";

const PART_SELECT = "id, command_term, command_terms, instructional_context_terms, is_hence, is_hence_or_otherwise, is_using, is_deduce, is_verify";

export async function PATCH(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user, profile } = auth;

  const body = await request.json();
  const { partId, commandTerm, commandTerms } = body;

  if (!partId || typeof partId !== "string") {
    return NextResponse.json({ error: "partId is required" }, { status: 400 });
  }

  const terms: string[] = Array.isArray(commandTerms)
    ? commandTerms
      .filter((t: unknown): t is string => typeof t === "string")
      .map((t: string) => t.trim())
      .filter(Boolean)
    : (commandTerm && typeof commandTerm === "string" && commandTerm.trim() ? [commandTerm.trim()] : []);
  const value = terms[0] ?? null;

  const { data: currentPart, error: currentErr } = await supabase
    .from("question_parts")
    .select("content_latex")
    .eq("id", partId)
    .single();

  if (currentErr || !currentPart) {
    return NextResponse.json({ error: "Part not found" }, { status: 404 });
  }

  const sourceLatex = currentPart.content_latex ?? "";

  const updatePayload = {
    command_term: value,
    command_terms: terms,
    ...deriveCommandTermFlags({ commandTerm: value, sourceLatex }),
    instructional_context_terms: deriveInstructionalContextTerms({ commandTerm: value, sourceLatex }),
  };

  const supportedColumns = await probeQuestionPartsColumns(async (col) => {
    const { error } = await supabase.from("question_parts").select(col).limit(0);
    return error;
  });

  const { data: updated, error } = await supabase
    .from("question_parts")
    .update(omitUnsupportedColumns(updatePayload, supportedColumns))
    .eq("id", partId)
    .select(stripUnsupportedColumns(PART_SELECT, supportedColumns))
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, part: updated });
}
