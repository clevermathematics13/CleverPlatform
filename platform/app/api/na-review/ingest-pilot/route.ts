import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

const SCAN_BUCKET = "exam-scans";

// POST /api/na-review/ingest-pilot
// One-time ingestion route for the A.1 pilot: takes ONE crop PNG (base64)
// at a time, plus its matching AI assessment record, uploads it to
// Storage, and writes/reuses the na_scan_batches -> na_packet_scans ->
// na_response_crops -> na_feedback chain so the review UI has real data
// to work against.
//
// This is NOT the production scan pipeline -- it exists specifically to
// bridge the local pilot run (crop_pilot.py + assess_crops.py, run
// outside the platform) into the platform's own tables. The pilot's 3
// packets have no real student identity (they were an anonymous
// validation run), so packet_scans are seeded with student_profile_id =
// null and id_status = 'needs_review', matching how a real batch would
// look before the name-matching step runs.
//
// Deliberately ONE CROP PER REQUEST rather than a batched payload: pilot
// crops run up to ~2.6MB raw (~3.5MB base64), and this platform has no
// custom Vercel body-size config, so it inherits the serverless default
// body limit -- a multi-crop payload risked silently exceeding that.
// Single-crop requests stay safely under it regardless of image size,
// and a failed request only ever loses one crop, not a whole batch.
//
// Idempotent: call once with `createBatch: true` to get a batchId back,
// then call repeatedly with that batchId + packetNum + crop data. Calling
// again with the same batchId + packetNum reuses the existing
// na_packet_scans row rather than creating a duplicate (looked up by
// batch_id + packet_seq). Calling with the same crop filename twice
// upserts the storage object but WILL create a second na_response_crops
// row -- the caller is responsible for not re-sending a crop that
// already succeeded (the runner script tracks this via response status).
export async function POST(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const body = await request.json();

  // Step 1: create a new batch (called once, first)
  if (body.createBatch) {
    const { packetVersionId } = body as { packetVersionId: string };
    if (!packetVersionId) {
      return NextResponse.json({ error: "packetVersionId is required" }, { status: 400 });
    }
    const { data: batch, error: batchErr } = await supabase
      .from("na_scan_batches")
      .insert({
        packet_version_id: packetVersionId,
        uploaded_by: user.id,
        source_filename: "pilot-ingestion",
        page_count: null,
        status: "cropped",
      })
      .select("id")
      .single();

    if (batchErr || !batch) {
      return NextResponse.json({ error: batchErr?.message ?? "Failed to create batch" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, batchId: batch.id });
  }

  // Step 2: ingest one crop
  const {
    batchId,
    packetVersionId,
    packetNum,
    qid,
    filename,
    base64,
    inkDensity,
    isBlank,
    boundaryExpanded,
    assessment,
  } = body as {
    batchId: string;
    packetVersionId: string;
    packetNum: number;
    qid: string;
    filename: string;
    base64: string;
    inkDensity: number | null;
    isBlank: boolean;
    boundaryExpanded: boolean;
    assessment: Record<string, unknown> | null;
  };

  if (!batchId || !packetVersionId || !packetNum || !qid || !filename || !base64) {
    return NextResponse.json(
      { error: "batchId, packetVersionId, packetNum, qid, filename, and base64 are required" },
      { status: 400 }
    );
  }

  const { data: anchor, error: anchorErr } = await supabase
    .from("na_anchors")
    .select("id")
    .eq("packet_version_id", packetVersionId)
    .eq("qid", qid)
    .maybeSingle();

  if (anchorErr) return NextResponse.json({ error: anchorErr.message }, { status: 500 });
  if (!anchor) {
    return NextResponse.json({ error: `No anchor found for qid ${qid}`, skipped: true }, { status: 200 });
  }

  // find-or-create the packet_scan for this batch+packetNum (idempotent
  // across repeated calls for the same packet)
  const { data: existingScan } = await supabase
    .from("na_packet_scans")
    .select("id")
    .eq("batch_id", batchId)
    .eq("packet_seq", packetNum)
    .maybeSingle();

  let packetScanId = existingScan?.id;
  if (!packetScanId) {
    const { data: newScan, error: scanErr } = await supabase
      .from("na_packet_scans")
      .insert({
        batch_id: batchId,
        packet_version_id: packetVersionId,
        packet_seq: packetNum,
        student_profile_id: null,
        id_status: "needs_review",
        status: "assessed",
      })
      .select("id")
      .single();
    if (scanErr || !newScan) {
      return NextResponse.json({ error: scanErr?.message ?? "Failed to create packet scan" }, { status: 500 });
    }
    packetScanId = newScan.id;
  }

  const storagePath = `pilot/packet-${packetNum}/${filename}`;
  const buffer = Buffer.from(base64, "base64");

  const { error: uploadErr } = await supabase.storage
    .from(SCAN_BUCKET)
    .upload(storagePath, buffer, { contentType: "image/png", upsert: true });

  if (uploadErr) {
    return NextResponse.json({ error: `Upload failed: ${uploadErr.message}` }, { status: 500 });
  }

  const { data: cropRow, error: cropErr } = await supabase
    .from("na_response_crops")
    .insert({
      packet_scan_id: packetScanId,
      anchor_id: anchor.id,
      storage_path: storagePath,
      ink_density: inkDensity,
      is_blank: isBlank,
      boundary_expanded: boundaryExpanded,
    })
    .select("id")
    .single();

  if (cropErr || !cropRow) {
    return NextResponse.json({ error: cropErr?.message ?? "Failed to insert crop row" }, { status: 500 });
  }

  let feedbackWritten = false;
  if (assessment) {
    const a = assessment;
    const { error: fbErr } = await supabase.from("na_feedback").insert({
      crop_id: cropRow.id,
      ai_attempted: a.attempted ?? null,
      ai_transcription: a.transcription ?? null,
      ai_verdict: a.verdict ?? null,
      ai_marks_awarded: a.marks_awarded ?? null,
      ai_marks_available: a.marks_available_for_crop ?? null,
      ai_misconception_tags: a.misconception_tags ?? null,
      ai_margin_comment: a.margin_comment ?? null,
      ai_next_step: a.next_step ?? null,
      ai_confidence: a.confidence ?? null,
      ai_teacher_note: a.teacher_note ?? null,
      ai_validation_error: a.validation_error ?? null,
      ai_raw_response: a,
    });
    feedbackWritten = !fbErr;
    if (fbErr) console.error(`Failed to insert feedback for ${filename}:`, fbErr);
  }

  return NextResponse.json({
    ok: true,
    batchId,
    packetScanId,
    cropId: cropRow.id,
    feedbackWritten,
  });
}
