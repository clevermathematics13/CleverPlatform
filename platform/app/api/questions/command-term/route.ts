import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deriveCommandTermFlags, deriveInstructionalContextTerms } from "@/lib/command-term-flags";

export async function PATCH(request: NextRequest) {
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

  const body = await request.json();
  const { partId, commandTerm } = body;

  if (!partId || typeof partId !== "string") {
    return NextResponse.json({ error: "partId is required" }, { status: 400 });
  }

  // Allow null/empty to clear
  const value = commandTerm && typeof commandTerm === "string" && commandTerm.trim()
    ? commandTerm.trim()
    : null;

  const { data: currentPart, error: currentErr } = await supabase
    .from("question_parts")
    .select("content_latex")
    .eq("id", partId)
    .single();

  if (currentErr || !currentPart) {
    return NextResponse.json({ error: "Part not found" }, { status: 404 });
  }

  const sourceLatex = currentPart.content_latex ?? "";

  const { data: updated, error } = await supabase
    .from("question_parts")
    .update({
      command_term: value,
      ...deriveCommandTermFlags({ commandTerm: value, sourceLatex }),
      instructional_context_terms: deriveInstructionalContextTerms({ commandTerm: value, sourceLatex }),
    })
    .eq("id", partId)
    .select("id, command_term, instructional_context_terms, is_hence, is_hence_or_otherwise, is_using, is_deduce, is_verify")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, part: updated });
}
