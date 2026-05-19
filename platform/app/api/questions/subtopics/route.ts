import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

export async function PATCH(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user, profile } = auth;

  const body = await request.json();
  const { partId, subtopicCodes, primarySubtopicCode } = body;

  if (!partId || typeof partId !== "string") {
    return NextResponse.json({ error: "partId is required" }, { status: 400 });
  }

  if (!Array.isArray(subtopicCodes)) {
    return NextResponse.json({ error: "subtopicCodes must be an array" }, { status: 400 });
  }

  // Sanitize: only allow non-empty strings
  const codes = subtopicCodes.filter(
    (c: unknown) => typeof c === "string" && c.trim().length > 0
  ).map((c: string) => c.trim());

  // Auto-set primary when exactly one code and no explicit primary provided
  let effectivePrimary = primarySubtopicCode;
  if (effectivePrimary === undefined && codes.length === 1) {
    effectivePrimary = codes[0];
  } else if (
    typeof effectivePrimary === "string" &&
    effectivePrimary.trim().length > 0 &&
    !codes.includes(effectivePrimary.trim())
  ) {
    // Primary code was removed from the list — clear it
    effectivePrimary = null;
  }

  const update: Record<string, unknown> = { subtopic_codes: codes };
  if (effectivePrimary !== undefined) {
    update.primary_subtopic_code =
      typeof effectivePrimary === "string" && effectivePrimary.trim().length > 0
        ? effectivePrimary.trim()
        : null;
  }

  const { error } = await supabase
    .from("question_parts")
    .update(update)
    .eq("id", partId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, subtopic_codes: codes, primary_subtopic_code: update.primary_subtopic_code ?? undefined });
}
