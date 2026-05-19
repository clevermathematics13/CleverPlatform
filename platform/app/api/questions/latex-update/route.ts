import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { deriveCommandTermFlags, deriveInstructionalContextTerms } from "@/lib/command-term-flags";
import { probeQuestionPartsColumns, omitUnsupportedColumns } from "@/lib/question-parts-compat";

// PATCH /api/questions/latex-update
// Body: { partId: string, field: "content_latex"|"markscheme_latex", value: string }
export async function PATCH(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user, profile } = auth;

  const body = await request.json() as {
    partId: string;
    field: "content_latex" | "markscheme_latex";
    value: string;
  };

  const { partId, field, value } = body;

  if (!partId || !field || value === undefined) {
    return NextResponse.json(
      { error: "partId, field, and value are required" },
      { status: 400 }
    );
  }
  if (!["content_latex", "markscheme_latex"].includes(field)) {
    return NextResponse.json({ error: "Invalid field" }, { status: 400 });
  }

  let updatePayload: Record<string, unknown> = { [field]: value };
  if (field === "content_latex") {
    const { data: currentPart, error: fetchErr } = await supabase
      .from("question_parts")
      .select("command_term, command_terms")
      .eq("id", partId)
      .single();
    if (fetchErr || !currentPart) {
      return NextResponse.json({ error: "Part not found" }, { status: 404 });
    }
    const commandTerm = (currentPart.command_terms?.[0] as string | undefined) ?? currentPart.command_term;
    updatePayload = {
      ...updatePayload,
      ...deriveCommandTermFlags({ commandTerm, sourceLatex: value }),
      instructional_context_terms: deriveInstructionalContextTerms({ commandTerm, sourceLatex: value }),
    };
  }

  const supportedColumns = await probeQuestionPartsColumns(async (col) => {
    const { error } = await supabase.from("question_parts").select(col).limit(0);
    return error;
  });

  const { error } = await supabase
    .from("question_parts")
    .update(omitUnsupportedColumns(updatePayload, supportedColumns))
    .eq("id", partId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
