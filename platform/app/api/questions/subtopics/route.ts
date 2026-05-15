import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

  const update: Record<string, unknown> = { subtopic_codes: codes };
  if (primarySubtopicCode !== undefined) {
    update.primary_subtopic_code =
      typeof primarySubtopicCode === "string" && primarySubtopicCode.trim().length > 0
        ? primarySubtopicCode.trim()
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
