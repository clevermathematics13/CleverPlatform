import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deriveCommandTermFlags, deriveInstructionalContextTerms } from "@/lib/command-term-flags";
import { omitInstructionalContextTerms, retryWithoutInstructionalContextTerms } from "@/lib/question-parts-compat";

// PATCH /api/questions/latex-update
// Body: { partId: string, field: "content_latex"|"markscheme_latex", value: string }
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "teacher") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
      .select("command_term")
      .eq("id", partId)
      .single();
    if (fetchErr || !currentPart) {
      return NextResponse.json({ error: "Part not found" }, { status: 404 });
    }
    const commandTerm = currentPart.command_term;
    updatePayload = {
      ...updatePayload,
      ...deriveCommandTermFlags({ commandTerm, sourceLatex: value }),
      instructional_context_terms: deriveInstructionalContextTerms({ commandTerm, sourceLatex: value }),
    };
  }

  const { result: updateResult } = await retryWithoutInstructionalContextTerms(
    async (includeInstructionalContextTerms) =>
      supabase
        .from("question_parts")
        .update(includeInstructionalContextTerms ? updatePayload : omitInstructionalContextTerms(updatePayload))
        .eq("id", partId),
    (result) => result.error,
  );

  const { error } = updateResult;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
