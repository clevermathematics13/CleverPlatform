import { NextRequest, NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { getApiTeacher } from "@/lib/auth";
import { NA_SCAN_BUCKET } from "@/lib/na-scanning";

// Matches the Tests batch-grading split route's budget reasoning: this does
// only the fast part (split the PDF, create one na_packet_scans row per
// student) and returns immediately. Page-identity matching and crop
// extraction (stages 3-4) run as separate calls the client makes after this
// route returns, one per student, each within its own function budget.
export const maxDuration = 120;

interface ConfirmedSegment {
  label: string;
  pages: number[];
  invitedId: string;
}

/**
 * POST /api/na-review/batch/[batchId]/split
 * Body: { segments: { label: string, pages: number[], invitedId: string }[] }
 *
 * Stage 2 of the NA scan pipeline. Applies the teacher's CONFIRMED page-to-
 * student mapping (which may differ from the proposal stage 1 returned —
 * every segment here needs an explicit invitedId; there is no roster
 * auto-match fallback at this step) and splits the batch PDF into one PDF
 * per student via pdf-lib. Each split PDF is uploaded to storage and one
 * na_packet_scans row is created per student, with invited_student_id set
 * (student_profile_id is left null here — that gets backfilled separately
 * once/if the student registers and invited_students.profile_id is set).
 *
 * This route never calls the model and never extracts crops — see the
 * page-identity and crop-extraction stages, run per student after this.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { batchId } = await params;

  let body: { segments?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.segments) || body.segments.length === 0) {
    return NextResponse.json({ error: "segments must be a non-empty array" }, { status: 400 });
  }

  const segments: ConfirmedSegment[] = [];
  for (const raw of body.segments as Record<string, unknown>[]) {
    const label = typeof raw.label === "string" ? raw.label.trim() : "";
    const invitedId = typeof raw.invitedId === "string" ? raw.invitedId.trim() : "";
    const pages = Array.isArray(raw.pages)
      ? raw.pages.filter((p): p is number => typeof p === "number" && Number.isInteger(p) && p >= 1)
      : [];
    if (!label || !invitedId || pages.length === 0) {
      return NextResponse.json(
        { error: "Every segment needs a label, an invitedId, and at least one page" },
        { status: 400 }
      );
    }
    segments.push({ label, pages: [...new Set(pages)].sort((a, b) => a - b), invitedId });
  }

  const invitedIds = segments.map((s) => s.invitedId);
  const duplicateStudent = invitedIds.find((id, i) => invitedIds.indexOf(id) !== i);
  if (duplicateStudent) {
    return NextResponse.json(
      { error: "The same student is assigned to more than one segment — merge their pages into one segment" },
      { status: 400 }
    );
  }

  // -- Load the batch and the source PDF -------------------------------------
  const { data: batch, error: batchErr } = await supabase
    .from("na_scan_batches")
    .select("id, packet_version_id, status, source_storage_path, page_count")
    .eq("id", batchId)
    .maybeSingle();

  if (batchErr) return NextResponse.json({ error: batchErr.message }, { status: 500 });
  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  if (!batch.source_storage_path) {
    return NextResponse.json({ error: "This batch has no stored source PDF to split" }, { status: 400 });
  }
  if (batch.status === "split") {
    return NextResponse.json(
      { error: "This batch has already been split. Re-upload to grade again." },
      { status: 409 }
    );
  }

  // -- Verify every invitedId actually belongs to a real invited_students row --
  const { data: invitedRows, error: invitedErr } = await supabase
    .from("invited_students")
    .select("id, full_name")
    .in("id", invitedIds);
  if (invitedErr) return NextResponse.json({ error: invitedErr.message }, { status: 500 });
  const foundIds = new Set((invitedRows ?? []).map((r) => r.id));
  const missingIds = invitedIds.filter((id) => !foundIds.has(id));
  if (missingIds.length > 0) {
    return NextResponse.json(
      { error: `Unknown invitedId(s): ${missingIds.join(", ")}` },
      { status: 400 }
    );
  }

  const pageCount = batch.page_count ?? 0;
  const outOfRange = segments.flatMap((s) => s.pages.filter((p) => p > pageCount));
  if (outOfRange.length > 0) {
    return NextResponse.json(
      { error: `Page(s) ${[...new Set(outOfRange)].join(", ")} are beyond this batch's ${pageCount} pages` },
      { status: 400 }
    );
  }

  const { data: sourceFile, error: dlErr } = await supabase.storage
    .from(NA_SCAN_BUCKET)
    .download(batch.source_storage_path);
  if (dlErr || !sourceFile) {
    return NextResponse.json(
      { error: `Could not read the batch scan: ${dlErr?.message ?? "not found"}` },
      { status: 500 }
    );
  }
  const sourceBuffer = Buffer.from(await sourceFile.arrayBuffer());

  let sourceDoc: PDFDocument;
  try {
    sourceDoc = await PDFDocument.load(sourceBuffer, { updateMetadata: false });
  } catch (e) {
    return NextResponse.json(
      { error: `Could not open the batch PDF: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    );
  }

  const results: {
    invitedId: string;
    label: string;
    status: "split" | "failed";
    packetScanId?: string;
    error?: string;
  }[] = [];

  for (const segment of segments) {
    try {
      const splitDoc = await PDFDocument.create();
      const copiedPages = await splitDoc.copyPages(
        sourceDoc,
        segment.pages.map((p) => p - 1)
      );
      for (const page of copiedPages) splitDoc.addPage(page);
      const splitBytes = Buffer.from(await splitDoc.save());

      const splitPath = `na-scans/${batch.packet_version_id}/${segment.invitedId}/${Date.now()}-batch-${batchId}.pdf`;
      const { error: uploadErr } = await supabase.storage
        .from(NA_SCAN_BUCKET)
        .upload(splitPath, splitBytes, { contentType: "application/pdf", upsert: true });
      if (uploadErr) throw new Error(`Could not store split scan: ${uploadErr.message}`);

      // Find-or-create: if a scan for this batch+student already exists
      // (e.g. a retried split call), reuse it rather than creating a
      // duplicate row.
      const { data: existing } = await supabase
        .from("na_packet_scans")
        .select("id")
        .eq("batch_id", batchId)
        .eq("invited_student_id", segment.invitedId)
        .maybeSingle();

      let packetScanId = existing?.id;
      if (packetScanId) {
        const { error: updateErr } = await supabase
          .from("na_packet_scans")
          .update({ split_storage_path: splitPath, status: "split", updated_at: new Date().toISOString() })
          .eq("id", packetScanId);
        if (updateErr) throw new Error(`Could not update existing packet scan: ${updateErr.message}`);
      } else {
        const { data: newScan, error: insertErr } = await supabase
          .from("na_packet_scans")
          .insert({
            batch_id: batchId,
            packet_version_id: batch.packet_version_id,
            packet_seq: results.length + 1,
            invited_student_id: segment.invitedId,
            split_storage_path: splitPath,
            id_status: "confirmed",
            status: "split",
          })
          .select("id")
          .single();
        if (insertErr || !newScan) throw new Error(`Could not create packet scan: ${insertErr?.message}`);
        packetScanId = newScan.id;
      }

      results.push({ invitedId: segment.invitedId, label: segment.label, status: "split", packetScanId });
    } catch (e) {
      results.push({
        invitedId: segment.invitedId,
        label: segment.label,
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const confirmedSegments: ConfirmedSegment[] = segments;

  await supabase
    .from("na_scan_batches")
    .update({
      status: "split",
      confirmed_segments: confirmedSegments,
      split_at: new Date().toISOString(),
    })
    .eq("id", batchId);

  return NextResponse.json({
    batchId,
    results,
    splitCount: results.filter((r) => r.status === "split").length,
    failedCount: results.filter((r) => r.status === "failed").length,
  });
}
