import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { MAX_GUIDANCE_CHARS } from "@/lib/boundary-suggestion";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/boundary-guidance
 * Body: { note: string, scope: "test" | "all", testId?: string }
 *
 * Saves guidance the AI reads when it suggests grade boundaries: for one
 * assessment (scope "test", stored with its test_id) or as a general rule
 * for every assessment (scope "all", test_id null). Rules are never edited
 * in place -- a changed rule is a new row and the old one is removed, so a
 * suggestion's stored guidance always says what it was given.
 */
export async function POST(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  let body: { note?: unknown; scope?: unknown; testId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!note) return NextResponse.json({ error: "Write the guidance first" }, { status: 400 });
  if (note.length > MAX_GUIDANCE_CHARS) {
    return NextResponse.json({ error: `Guidance must be ${MAX_GUIDANCE_CHARS} characters or fewer` }, { status: 400 });
  }
  const scope = body.scope === "all" || body.scope === "test" ? body.scope : null;
  if (!scope) return NextResponse.json({ error: "scope must be test or all" }, { status: 400 });

  let testId: string | null = null;
  if (scope === "test") {
    testId = typeof body.testId === "string" && UUID_RE.test(body.testId) ? body.testId : null;
    if (!testId) return NextResponse.json({ error: "testId is required for guidance on one assessment" }, { status: 400 });
    const { data: test } = await supabase.from("tests").select("id").eq("id", testId).maybeSingle();
    if (!test) return NextResponse.json({ error: "Test not found" }, { status: 404 });
  }

  const { data: row, error } = await supabase
    .from("boundary_guidance")
    .insert({ test_id: testId, note, created_by: user.id })
    .select("id, test_id, note, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    guidance: { id: row.id, scope: row.test_id ? "test" : "all", note: row.note, createdAt: row.created_at },
  });
}
