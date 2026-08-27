import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { NA_SCAN_BUCKET } from "@/lib/na-scanning";

// A full class's worth of crops (39 anchors x ~20 students, but this route
// only ever handles ONE student's crops per call -- see the split route's
// comment: stages 3-4 are separate per-student calls the client makes
// after split returns, each within its own budget) still needs headroom
// for the CV service round trip plus writing every crop back to Storage.
export const maxDuration = 60;

interface AnchorRow {
  id: string;
  qid: string;
  page_index: number;
  x0_pt: number;
  y0_pt: number;
  x1_pt: number;
  y1_pt: number;
  expand_max_x1_pt: number | null;
  expand_max_y1_pt: number | null;
}

interface CvCropResult {
  qid: string;
  pageIndex: number;
  imageBase64: string;
  expanded: boolean;
  possiblyTruncated: boolean;
  warnings: string[];
}

/**
 * POST /api/na-review/packet-scans/[packetScanId]/crop
 *
 * Stage 4 of the NA scan pipeline. For one student's already-split packet
 * PDF (na_packet_scans.split_storage_path, produced by stage 2), extracts
 * one image crop per locked anchor and stores each in Storage plus a row
 * in na_response_crops.
 *
 * Page mapping is deterministic (anchor.page_index -> the same page of the
 * student's split PDF), not AI-driven -- see cv_crop_extract.py's module
 * docstring on the CV service for the full reasoning. This route's own
 * responsibility is narrower: fetch the split PDF and the packet's locked
 * anchors from the database (the CV service has no DB access and can't do
 * this itself), call the CV service's /crop endpoint, then persist what
 * comes back.
 *
 * If the CV service reports a page-count mismatch, this route does NOT
 * silently proceed as if nothing were wrong -- it still saves whatever
 * crops came back (so partial progress isn't lost) but returns the
 * mismatch prominently so the caller can flag this student for manual
 * review rather than trusting a possibly-misaligned crop set.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ packetScanId: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { packetScanId } = await params;

  if (!process.env.GRAPH_LAB_CV_SERVICE_URL) {
    return NextResponse.json(
      {
        error:
          "GRAPH_LAB_CV_SERVICE_URL is not configured -- crop extraction requires the CV service. See platform/cv-service/DEPLOYMENT.md.",
      },
      { status: 503 }
    );
  }

  // -- Load the packet scan and its packet version's expected page count ----
  const { data: scan, error: scanErr } = await supabase
    .from("na_packet_scans")
    .select("id, packet_version_id, split_storage_path, status, na_packet_versions(page_count)")
    .eq("id", packetScanId)
    .maybeSingle();

  if (scanErr) return NextResponse.json({ error: scanErr.message }, { status: 500 });
  if (!scan) return NextResponse.json({ error: "Packet scan not found" }, { status: 404 });
  if (!scan.split_storage_path) {
    return NextResponse.json(
      { error: "This packet scan has no split PDF yet -- run stage 2 (split) first." },
      { status: 400 }
    );
  }

  const packetVersion = Array.isArray(scan.na_packet_versions)
    ? scan.na_packet_versions[0]
    : scan.na_packet_versions;
  const expectedPageCount = (packetVersion as { page_count: number | null } | null)?.page_count ?? null;
  if (!expectedPageCount) {
    return NextResponse.json(
      { error: "This packet version has no recorded page count -- cannot verify page alignment." },
      { status: 400 }
    );
  }

  // -- Load the packet's locked anchors ---------------------------------------
  const { data: anchorRows, error: anchorErr } = await supabase
    .from("na_anchors")
    .select("id, qid, page_index, x0_pt, y0_pt, x1_pt, y1_pt, expand_max_x1_pt, expand_max_y1_pt")
    .eq("packet_version_id", scan.packet_version_id)
    .order("sort_order");

  if (anchorErr) return NextResponse.json({ error: anchorErr.message }, { status: 500 });
  const anchors = (anchorRows ?? []) as AnchorRow[];
  if (anchors.length === 0) {
    return NextResponse.json(
      { error: "This packet version has no locked anchors -- run stage 0 (anchor extraction) first." },
      { status: 400 }
    );
  }

  // -- Download the student's split PDF ---------------------------------------
  const { data: pdfFile, error: dlErr } = await supabase.storage
    .from(NA_SCAN_BUCKET)
    .download(scan.split_storage_path);
  if (dlErr || !pdfFile) {
    return NextResponse.json(
      { error: `Could not read the split PDF: ${dlErr?.message ?? "not found"}` },
      { status: 404 }
    );
  }
  const pdfBase64 = Buffer.from(await pdfFile.arrayBuffer()).toString("base64");

  // -- Call the CV service's /crop endpoint ------------------------------------
  const serviceBase = process.env.GRAPH_LAB_CV_SERVICE_URL.trim().replace(/\/$/, "");
  const target = `${/^https?:\/\//i.test(serviceBase) ? serviceBase : `https://${serviceBase}`}/crop`;
  const cvSecret = process.env.CV_SERVICE_SECRET ?? "";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  let cvResponse: { pageCountMismatch: number | null; crops: CvCropResult[] };
  try {
    const upstream = await fetch(target, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(cvSecret ? { "X-CV-Secret": cvSecret } : {}),
      },
      body: JSON.stringify({
        studentPdfBase64: pdfBase64,
        expectedPageCount,
        rotationHint: 0,
        anchors: anchors.map((a) => ({
          qid: a.qid,
          pageIndex: a.page_index,
          x0Pt: a.x0_pt,
          y0Pt: a.y0_pt,
          x1Pt: a.x1_pt,
          y1Pt: a.y1_pt,
          expandMaxX1Pt: a.expand_max_x1_pt,
          expandMaxY1Pt: a.expand_max_y1_pt,
        })),
      }),
      signal: controller.signal,
    });
    const raw = await upstream.text();
    if (!upstream.ok) {
      let errMsg = `CV service returned HTTP ${upstream.status}`;
      try {
        const parsed = JSON.parse(raw);
        if (parsed.error) errMsg = parsed.error;
      } catch {
        /* raw wasn't JSON, use the generic message */
      }
      return NextResponse.json({ error: errMsg }, { status: 502 });
    }
    cvResponse = JSON.parse(raw);
  } catch (e) {
    return NextResponse.json(
      { error: `Crop extraction request failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 }
    );
  } finally {
    clearTimeout(timeout);
  }

  // -- Store each crop in Storage + na_response_crops --------------------------
  const anchorByQid = new Map(anchors.map((a) => [a.qid, a]));
  const results: {
    qid: string;
    status: "saved" | "failed";
    cropId?: string;
    expanded?: boolean;
    possiblyTruncated?: boolean;
    isBlank?: boolean;
    error?: string;
  }[] = [];

  for (const crop of cvResponse.crops) {
    const anchor = anchorByQid.get(crop.qid);
    if (!anchor) {
      results.push({ qid: crop.qid, status: "failed", error: "No matching anchor found for this qid" });
      continue;
    }
    if (!crop.imageBase64) {
      results.push({
        qid: crop.qid,
        status: "failed",
        error: crop.warnings.join("; ") || "CV service returned no image for this anchor",
      });
      continue;
    }

    try {
      const imageBytes = Buffer.from(crop.imageBase64, "base64");

      // Cheap blank-page heuristic: a crop under ~1.5KB of PNG data at
      // 200dpi is almost certainly a blank white box (PNG compresses
      // uniform regions extremely well) rather than real handwriting.
      // Not used to auto-skip anything -- na_response_crops.is_blank is
      // informational, surfaced to the teacher review UI, exactly as
      // planned in the pilot ("nothing auto-skipped... the point is to
      // LOOK at the crops, not decide policy before seeing real output").
      const isBlank = imageBytes.length < 1536;

      const storagePath = `na-crops/${scan.packet_version_id}/${packetScanId}/${anchor.id}.png`;
      const { error: uploadErr } = await supabase.storage
        .from(NA_SCAN_BUCKET)
        .upload(storagePath, imageBytes, { contentType: "image/png", upsert: true });
      if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

      // Find-or-create per (packet_scan_id, anchor_id) so re-running stage 4
      // for a student (e.g. after re-splitting) replaces the old crop
      // rather than accumulating duplicates.
      const { data: existing } = await supabase
        .from("na_response_crops")
        .select("id")
        .eq("packet_scan_id", packetScanId)
        .eq("anchor_id", anchor.id)
        .maybeSingle();

      let cropId = existing?.id;
      if (cropId) {
        const { error: updateErr } = await supabase
          .from("na_response_crops")
          .update({
            storage_path: storagePath,
            boundary_expanded: crop.expanded,
            possibly_truncated: crop.possiblyTruncated,
            is_blank: isBlank,
          })
          .eq("id", cropId);
        if (updateErr) throw new Error(`Could not update existing crop row: ${updateErr.message}`);
      } else {
        const { data: newCrop, error: insertErr } = await supabase
          .from("na_response_crops")
          .insert({
            packet_scan_id: packetScanId,
            anchor_id: anchor.id,
            storage_path: storagePath,
            boundary_expanded: crop.expanded,
            possibly_truncated: crop.possiblyTruncated,
            is_blank: isBlank,
          })
          .select("id")
          .single();
        if (insertErr || !newCrop) throw new Error(`Could not create crop row: ${insertErr?.message}`);
        cropId = newCrop.id;
      }

      results.push({
        qid: crop.qid,
        status: "saved",
        cropId,
        expanded: crop.expanded,
        possiblyTruncated: crop.possiblyTruncated,
        isBlank,
      });
    } catch (e) {
      results.push({ qid: crop.qid, status: "failed", error: e instanceof Error ? e.message : String(e) });
    }
  }

  const savedCount = results.filter((r) => r.status === "saved").length;
  const failedCount = results.filter((r) => r.status === "failed").length;

  // Only mark the scan cropped if every anchor actually saved -- a partial
  // failure should stay visibly incomplete rather than reading as done.
  if (failedCount === 0 && cvResponse.pageCountMismatch === null) {
    await supabase
      .from("na_packet_scans")
      .update({ status: "cropped", updated_at: new Date().toISOString() })
      .eq("id", packetScanId);
  }

  return NextResponse.json({
    packetScanId,
    pageCountMismatch: cvResponse.pageCountMismatch,
    results,
    savedCount,
    failedCount,
    blankCount: results.filter((r) => r.isBlank).length,
    expandedCount: results.filter((r) => r.expanded).length,
    possiblyTruncatedCount: results.filter((r) => r.possiblyTruncated).length,
  });
}
