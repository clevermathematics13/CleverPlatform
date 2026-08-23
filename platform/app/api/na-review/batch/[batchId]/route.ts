import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

/**
 * GET /api/na-review/batch/[batchId]
 *
 * Reloads one batch's full state so the scan-test harness (or any future
 * real review UI) can restore itself after a page refresh or a fresh
 * visit, instead of losing its place. The harness previously held
 * everything in plain React state with no way to come back to an
 * in-progress batch -- the underlying data (the batch row, its segments,
 * the split PDFs) was always durable in Supabase; only the UI's view into
 * it wasn't. This route is that view.
 *
 * Returns the batch row (proposed_segments, confirmed_segments, status,
 * etc. -- the same fields GET /api/na-review/batch already lists) PLUS,
 * for batches that have been split, each student's na_packet_scans.id --
 * the one piece GET /api/na-review/batch's list view doesn't carry, and
 * exactly what a client needs to call the stage 4 crop route
 * (POST .../packet-scans/[packetScanId]/crop) without re-splitting.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { batchId } = await params;

  const { data: batch, error: batchErr } = await supabase
    .from("na_scan_batches")
    .select(
      "id, packet_version_id, course_id, status, source_filename, page_count, proposed_segments, confirmed_segments, unassigned_pages, error_message, created_at, segmented_at, split_at, parent_batch_id, chunk_index, chunk_count"
    )
    .eq("id", batchId)
    .maybeSingle();

  if (batchErr) return NextResponse.json({ error: batchErr.message }, { status: 500 });
  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });

  // Packet scans only exist once stage 2 (split) has actually run for this
  // batch -- for a batch still at "segmented" or earlier, this is
  // correctly empty and the client should reconstruct its review table
  // from proposed_segments instead.
  const { data: packetScans, error: scansErr } = await supabase
    .from("na_packet_scans")
    .select("id, invited_student_id, status")
    .eq("batch_id", batchId);

  if (scansErr) return NextResponse.json({ error: scansErr.message }, { status: 500 });

  // Any batch chunked from the same parent upload, so the client can
  // rebuild the full chunked-upload view rather than just this one chunk.
  let siblingChunks: { id: string; chunk_index: number | null; chunk_count: number | null; status: string }[] = [];
  if (batch.parent_batch_id) {
    const { data: siblings, error: siblingsErr } = await supabase
      .from("na_scan_batches")
      .select("id, chunk_index, chunk_count, status")
      .eq("parent_batch_id", batch.parent_batch_id)
      .order("chunk_index");
    if (siblingsErr) return NextResponse.json({ error: siblingsErr.message }, { status: 500 });
    siblingChunks = siblings ?? [];
  }

  return NextResponse.json({
    batch,
    packetScansByInvitedId: Object.fromEntries(
      (packetScans ?? []).map((ps) => [ps.invited_student_id, { packetScanId: ps.id, status: ps.status }])
    ),
    siblingChunks,
  });
}
