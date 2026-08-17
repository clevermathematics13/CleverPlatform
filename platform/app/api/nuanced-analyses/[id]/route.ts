/**
 * DELETE /api/nuanced-analyses/[id]  — permanently delete a saved packet
 *
 * WHY THIS EXISTS: /api/nuanced-analyses (the collection route) has GET and
 * POST but no DELETE, and no UI anywhere in the app calls a delete endpoint
 * even though the schema and RLS already support it (see the pre-existing
 * "Teachers can delete nuanced_analyses" policy on public.nuanced_analyses).
 * A teacher had no way to remove a saved packet short of a manual SQL
 * DELETE. This route, plus the browse page at
 * /dashboard/assignments/manage that calls it, closes that gap.
 *
 * Ownership check: owner_id is nullable — three packets saved before this
 * column was wired in have owner_id = null (see na-route.ts's POST, which
 * has always set it, vs earlier rows created before that). Requiring an
 * exact match would permanently lock those out for every teacher, so a
 * caller may delete a packet if owner_id is null OR matches their own
 * profile id. This app has exactly one teacher role in practice; the real
 * backstop against a student or unauthenticated caller reaching this route
 * at all is getApiTeacher() below plus the table's RLS DELETE policy, which
 * independently requires get_my_role() = 'teacher'.
 */

import { NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, profile } = auth;

  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id must be a UUID" }, { status: 400 });
  }

  const { data: existing, error: fetchError } = await supabase
    .from("nuanced_analyses")
    .select("id, owner_id, title")
    .eq("id", id)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!existing) {
    // Already gone — treat as success so a double-click or a stale list
    // doesn't surface a confusing error for something the teacher already
    // accomplished.
    return NextResponse.json({ success: true, alreadyDeleted: true }, { status: 200 });
  }
  if (existing.owner_id !== null && existing.owner_id !== profile.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error: deleteError } = await supabase
    .from("nuanced_analyses")
    .delete()
    .eq("id", id);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, deletedId: id, title: existing.title }, { status: 200 });
}
