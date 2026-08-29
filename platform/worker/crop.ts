import type { SupabaseClient } from "@supabase/supabase-js";
import { NA_SCAN_BUCKET } from "../lib/na-scanning";

// Deliberately a standalone copy of
// app/api/na-review/packet-scans/[packetScanId]/crop/route.ts's core logic,
// not an extraction shared with it. That route is a proven, live production
// path with real student data behind it and no staging environment to
// verify a refactor against; duplicating ~150 lines here carries far less
// risk than restructuring it mid-rollout. If this worker proves itself, a
// later follow-up can safely extract the shared function once there's no
// urgency forcing that change through untested.

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

export type CropResult =
  | { outcome: "cropped"; savedCount: number; totalAnchors: number }
  | { outcome: "failed"; message: string };

/**
 * Stage 4 of the NA scan pipeline, run for one student's already-split
 * packet PDF. See the crop route this mirrors for the full reasoning on the
 * CV service call shape and the find-or-create/idempotent crop-row pattern.
 */
export async function runCrop(supabase: SupabaseClient, packetScanId: string): Promise<CropResult> {
  const { data: scan, error: scanErr } = await supabase
    .from("na_packet_scans")
    .select("id, batch_id, packet_version_id, split_storage_path, na_packet_versions(page_count)")
    .eq("id", packetScanId)
    .maybeSingle();

  const fail = async (message: string): Promise<CropResult> => {
    if (scan?.batch_id) {
      await supabase.from("na_scan_batches").update({ status: "failed", error_message: message }).eq("id", scan.batch_id);
    }
    return { outcome: "failed", message };
  };

  if (!process.env.GRAPH_LAB_CV_SERVICE_URL) {
    return fail("GRAPH_LAB_CV_SERVICE_URL is not configured -- crop extraction requires the CV service.");
  }

  if (scanErr) return fail(scanErr.message);
  if (!scan) return fail("Packet scan not found");
  if (!scan.split_storage_path) return fail("This packet scan has no split PDF yet");

  const packetVersion = Array.isArray(scan.na_packet_versions) ? scan.na_packet_versions[0] : scan.na_packet_versions;
  const expectedPageCount = (packetVersion as { page_count: number | null } | null)?.page_count ?? null;
  if (!expectedPageCount) return fail("This packet version has no recorded page count");

  const { data: anchorRows, error: anchorErr } = await supabase
    .from("na_anchors")
    .select("id, qid, page_index, x0_pt, y0_pt, x1_pt, y1_pt, expand_max_x1_pt, expand_max_y1_pt")
    .eq("packet_version_id", scan.packet_version_id)
    .order("sort_order");
  if (anchorErr) return fail(anchorErr.message);
  const anchors = (anchorRows ?? []) as AnchorRow[];
  if (anchors.length === 0) return fail("This packet version has no locked anchors");

  const { data: pdfFile, error: dlErr } = await supabase.storage.from(NA_SCAN_BUCKET).download(scan.split_storage_path);
  if (dlErr || !pdfFile) return fail(`Could not read the split PDF: ${dlErr?.message ?? "not found"}`);
  const pdfBase64 = Buffer.from(await pdfFile.arrayBuffer()).toString("base64");

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
      headers: { "Content-Type": "application/json", ...(cvSecret ? { "X-CV-Secret": cvSecret } : {}) },
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
        /* raw wasn't JSON */
      }
      return fail(errMsg);
    }
    cvResponse = JSON.parse(raw);
  } catch (e) {
    return fail(`Crop extraction request failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timeout);
  }

  const anchorByQid = new Map(anchors.map((a) => [a.qid, a]));
  let savedCount = 0;

  for (const crop of cvResponse.crops) {
    const anchor = anchorByQid.get(crop.qid);
    if (!anchor || !crop.imageBase64) continue;
    try {
      const imageBytes = Buffer.from(crop.imageBase64, "base64");
      const isBlank = imageBytes.length < 1536;
      const storagePath = `na-crops/${scan.packet_version_id}/${packetScanId}/${anchor.id}.png`;
      const { error: uploadErr } = await supabase.storage
        .from(NA_SCAN_BUCKET)
        .upload(storagePath, imageBytes, { contentType: "image/png", upsert: true });
      if (uploadErr) continue;

      const { data: existing } = await supabase
        .from("na_response_crops")
        .select("id")
        .eq("packet_scan_id", packetScanId)
        .eq("anchor_id", anchor.id)
        .maybeSingle();

      if (existing?.id) {
        await supabase
          .from("na_response_crops")
          .update({
            storage_path: storagePath,
            boundary_expanded: crop.expanded,
            possibly_truncated: crop.possiblyTruncated,
            is_blank: isBlank,
          })
          .eq("id", existing.id);
      } else {
        await supabase.from("na_response_crops").insert({
          packet_scan_id: packetScanId,
          anchor_id: anchor.id,
          storage_path: storagePath,
          boundary_expanded: crop.expanded,
          possibly_truncated: crop.possiblyTruncated,
          is_blank: isBlank,
        });
      }
      savedCount++;
    } catch {
      /* one crop failing doesn't abort the rest -- matches the route's own per-crop try/catch */
    }
  }

  const allAnchorsCropped = savedCount >= anchors.length && cvResponse.pageCountMismatch === null;
  if (allAnchorsCropped) {
    await supabase.from("na_packet_scans").update({ status: "cropped", updated_at: new Date().toISOString() }).eq("id", packetScanId);
  }

  if (!allAnchorsCropped) {
    return fail(
      `Only ${savedCount}/${anchors.length} anchors cropped successfully${
        cvResponse.pageCountMismatch !== null ? ` (page count mismatch: expected ${expectedPageCount}, got ${cvResponse.pageCountMismatch})` : ""
      }.`
    );
  }

  return { outcome: "cropped", savedCount, totalAnchors: anchors.length };
}
