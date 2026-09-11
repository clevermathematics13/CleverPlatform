/**
 * GET    /api/nuanced-analyses/[id]  — the packet, plus whether it is locked
 * PUT    /api/nuanced-analyses/[id]  — write an edited draft back to it
 * DELETE /api/nuanced-analyses/[id]  — permanently delete a saved packet
 *
 * GET and PUT exist so the Nuanced Analysis editor can edit the PACKET rather
 * than only a copy of it. Before them, opening a packet built a working copy
 * in assignment_templates and every save landed there; the packet itself was
 * never updated, so the editor quietly diverged from the thing it claimed to
 * be editing.
 *
 * PUT refuses a packet that students have already written on -- see
 * evaluatePacketLock in lib/na-packet-edit.ts for why that line is drawn at
 * scanned work rather than at the print master. A refusal is a 409 carrying
 * the reason, not a generic error, because the editor shows that text to the
 * teacher verbatim; a packet that is printed but unscanned comes back
 * editable with a warning the editor shows the same way.
 *
 * On a successful write the rubric is re-synced through the same
 * syncRubricItems the sandbox save uses, so the answer key follows the
 * questions. That function will not overwrite a row whose source is no longer
 * 'generated', which is what protects hand-authored keys.
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
import type { SupabaseClient } from "@supabase/supabase-js";
import { syncRubricItems } from "@/lib/na-rubric-bridge";
import {
  evaluatePacketLock,
  buildPacketContentUpdate,
  type PacketLock,
} from "@/lib/na-packet-edit";
import type { AssignmentDraft } from "@/lib/assignments";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Counts the print-master facts the lock is decided from. Anchors and scans
 * both hang off na_packet_versions, so a packet with no version row cannot
 * have either and the two follow-up counts are skipped.
 */
async function readPacketLock(
  supabase: SupabaseClient,
  packetId: string,
): Promise<{ ok: true; lock: PacketLock } | { ok: false; error: string }> {
  const { data: versions, error } = await supabase
    .from("na_packet_versions")
    .select("id")
    .eq("nuanced_analysis_id", packetId);

  if (error) return { ok: false, error: error.message };

  const versionIds = (versions ?? []).map((v: { id: string }) => v.id);
  if (versionIds.length === 0) {
    return { ok: true, lock: evaluatePacketLock({ packetVersions: 0, anchors: 0, scans: 0 }) };
  }

  const [anchorsRes, scansRes] = await Promise.all([
    supabase
      .from("na_anchors")
      .select("id", { count: "exact", head: true })
      .in("packet_version_id", versionIds),
    supabase
      .from("na_packet_scans")
      .select("id", { count: "exact", head: true })
      .in("packet_version_id", versionIds),
  ]);

  if (anchorsRes.error) return { ok: false, error: anchorsRes.error.message };
  if (scansRes.error) return { ok: false, error: scansRes.error.message };

  return {
    ok: true,
    lock: evaluatePacketLock({
      packetVersions: versionIds.length,
      anchors: anchorsRes.count ?? 0,
      scans: scansRes.count ?? 0,
    }),
  };
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id must be a UUID" }, { status: 400 });
  }

  const { data: packet, error } = await supabase
    .from("nuanced_analyses")
    .select("id, slug, title, subtitle, course, section_code, grade_level, draft_content")
    .eq("id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!packet) return NextResponse.json({ error: "Packet not found" }, { status: 404 });

  const lockResult = await readPacketLock(supabase, id);
  if (!lockResult.ok) {
    return NextResponse.json({ error: lockResult.error }, { status: 500 });
  }

  return NextResponse.json({ packet, lock: lockResult.lock }, { status: 200 });
}

export async function PUT(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, profile } = auth;

  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id must be a UUID" }, { status: 400 });
  }

  let draft: AssignmentDraft;
  try {
    const body = (await req.json()) as { draft?: AssignmentDraft };
    if (!body.draft || typeof body.draft !== "object") {
      return NextResponse.json({ error: "Missing draft" }, { status: 400 });
    }
    draft = body.draft;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  if (!draft.title || !Array.isArray(draft.sections)) {
    return NextResponse.json(
      { error: "draft must carry a title and a sections array" },
      { status: 400 },
    );
  }
  // A draft that lost its sections would blank the packet and, through
  // syncRubricItems, leave the rubric describing questions that no longer
  // exist. Far more likely a client bug than an intentional edit.
  if (draft.sections.length === 0) {
    return NextResponse.json(
      { error: "Refusing to save a packet with no sections." },
      { status: 422 },
    );
  }

  const { data: existing, error: fetchError } = await supabase
    .from("nuanced_analyses")
    .select("id, owner_id, title")
    .eq("id", id)
    .maybeSingle();

  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "Packet not found" }, { status: 404 });
  // Same nullable-owner rule as DELETE below, for the same reason.
  if (existing.owner_id !== null && existing.owner_id !== profile.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const lockResult = await readPacketLock(supabase, id);
  if (!lockResult.ok) {
    return NextResponse.json({ error: lockResult.error }, { status: 500 });
  }
  if (lockResult.lock.locked) {
    return NextResponse.json(
      { error: lockResult.lock.reason, locked: true },
      { status: 409 },
    );
  }

  const { error: updateError } = await supabase
    .from("nuanced_analyses")
    .update(buildPacketContentUpdate(draft))
    .eq("id", id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Reported rather than rolled back, matching the sandbox save path: the
  // packet edit is already durable and losing it because the derived rubric
  // stumbled would be the worse outcome. The editor surfaces this.
  const rubric = await syncRubricItems(supabase, id, draft.sections);

  return NextResponse.json(
    {
      success: true,
      packetId: id,
      rubric: rubric.ok
        ? { ok: true, synced: rubric.synced, skipped: rubric.skipped }
        : { ok: false, error: rubric.error },
    },
    { status: 200 },
  );
}

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
