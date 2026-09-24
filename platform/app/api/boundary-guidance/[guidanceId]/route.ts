import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * DELETE /api/boundary-guidance/[guidanceId]
 *
 * Removes a guidance rule from what the AI reads next time. The row is kept
 * with archived_at set, so a stored suggestion's guidance still reads as it
 * did when it was made.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ guidanceId: string }> }) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { guidanceId } = await params;
  if (!UUID_RE.test(guidanceId)) return NextResponse.json({ error: "Guidance not found" }, { status: 404 });

  const { data, error } = await supabase
    .from("boundary_guidance")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", guidanceId)
    .is("archived_at", null)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: "Guidance not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
