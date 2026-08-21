import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

const SCAN_BUCKET = "exam-scans";

// POST /api/na-review/ingest-pilot
// One-time ingestion route for the A.1 pilot: takes the crop PNGs (base64)
// and their matching AI assessment records, uploads each crop to Storage,
// and writes the full na_scan_batches -> na_packet_scans ->
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
// Body: {
//   packetVersionId: string,
//   packets: [{
//     packetNum: number,
//     crops: [{
//       qid: string,
//       filename: string,
//       base64: string,
//       inkDensity: number,
//       isBlank: boolean,
//       boundaryExpanded: boolean,
//       assessment: { ... } | null   // null for un-assessed (e.g. no rubric) crops
//     }]
//   }]
// }
export async function POST(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const body = await request.json();
  const { packetVersionId, packets } = body as {
    packetVersionId: string;
    packets: {
      packetNum: number;
      crops: {
        qid: string;
        filename: string;
        base64: string;
        inkDensity: number | null;
        isBlank: boolean;
        boundaryExpanded: boolean;
        assessment: Record<string, unknown> | null;
      }[];
    }[];
  };

  if (!packetVersionId || !Array.isArray(packets)) {
    return NextResponse.json(
      { error: "packetVersionId and packets are required" },
      { status: 400 }
    );
  }

  const { data: anchors, error: anchorsErr } = await supabase
    .from("na_anchors")
    .select("id, qid")
    .eq("packet_version_id", packetVersionId);

  if (anchorsErr) return NextResponse.json({ error: anchorsErr.message }, { status: 500 });

  const anchorByQid = new Map((anchors ?? []).map((a) => [a.qid, a.id]));

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

  let totalCrops = 0;
  let totalFeedback = 0;
  const skippedQids = new Set<string>();

  for (const packet of packets) {
    const { data: packetScan, error: scanErr } = await supabase
      .from("na_packet_scans")
      .insert({
        batch_id: batch.id,
        packet_version_id: packetVersionId,
        packet_seq: packet.packetNum,
        student_profile_id: null,
        id_status: "needs_review",
        status: "assessed",
      })
      .select("id")
      .single();

    if (scanErr || !packetScan) {
      console.error("Failed to create packet scan", scanErr);
      continue;
    }

    for (const crop of packet.crops) {
      const anchorId = anchorByQid.get(crop.qid);
      if (!anchorId) {
        skippedQids.add(crop.qid);
        continue;
      }

      const storagePath = `pilot/packet-${packet.packetNum}/${crop.filename}`;
      const buffer = Buffer.from(crop.base64, "base64");

      const { error: uploadErr } = await supabase.storage
        .from(SCAN_BUCKET)
        .upload(storagePath, buffer, { contentType: "image/png", upsert: true });

      if (uploadErr) {
        console.error(`Upload failed for ${crop.filename}:`, uploadErr.message);
        continue;
      }

      const { data: cropRow, error: cropErr } = await supabase
        .from("na_response_crops")
        .insert({
          packet_scan_id: packetScan.id,
          anchor_id: anchorId,
          storage_path: storagePath,
          ink_density: crop.inkDensity,
          is_blank: crop.isBlank,
          boundary_expanded: crop.boundaryExpanded,
        })
        .select("id")
        .single();

      if (cropErr || !cropRow) {
        console.error(`Failed to insert crop row for ${crop.filename}:`, cropErr);
        continue;
      }
      totalCrops += 1;

      if (crop.assessment) {
        const a = crop.assessment as Record<string, unknown>;
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
        if (fbErr) {
          console.error(`Failed to insert feedback for ${crop.filename}:`, fbErr);
        } else {
          totalFeedback += 1;
        }
      }
    }
  }

  return NextResponse.json({
    ok: true,
    batchId: batch.id,
    totalCrops,
    totalFeedback,
    skippedQids: Array.from(skippedQids),
  });
}
