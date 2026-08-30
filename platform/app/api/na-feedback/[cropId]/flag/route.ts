import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth";

/**
 * POST /api/na-feedback/[cropId]/flag
 * Body: { flagged: boolean, note?: string }
 *
 * Student-only "flag a mark" (e.g. "I think this was misread"). Writes
 * exactly student_flagged_misread/student_flag_note and nothing else --
 * the request body is never spread into the update payload, only these
 * two literal fields are ever set, since the RLS policy backing this
 * write ("students update own feedback flag") has an unrestricted WITH
 * CHECK (true) and relies entirely on the app layer to whitelist columns.
 *
 * anchor-review-client.tsx already renders student_flagged_misread/
 * student_flag_note for the teacher -- this route is the only piece that
 * was missing; no teacher-side UI work needed.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ cropId: string }> }) {
  const auth = await getApiUser();
  if (!auth.ok) return auth.response;
  const { supabase, profile } = auth;
  if (profile.role !== "student") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { cropId } = await params;

  const body = (await request.json().catch(() => null)) as { flagged?: unknown; note?: unknown } | null;
  if (!body || typeof body.flagged !== "boolean") {
    return NextResponse.json({ error: "flagged (boolean) is required" }, { status: 400 });
  }
  const note = typeof body.note === "string" ? body.note.slice(0, 1000).trim() : null;

  // RLS ("students update own feedback flag") already requires
  // released_at IS NOT NULL and ownership through na_packet_scans -- an
  // update that matches no row (wrong crop, not released, someone else's)
  // silently updates zero rows rather than erroring, so check the result
  // explicitly instead of assuming success.
  const { data, error } = await supabase
    .from("na_feedback")
    .update({
      student_flagged_misread: body.flagged,
      student_flag_note: body.flagged ? note : null,
    })
    .eq("crop_id", cropId)
    .select("id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    return NextResponse.json(
      { error: "Feedback not found, not released, or not yours to flag." },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true });
}
