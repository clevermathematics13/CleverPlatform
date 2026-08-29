import { PDFDocument } from "pdf-lib";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  NA_SCAN_BUCKET,
  loadInvitedRoster,
  matchSegmentsToInvitedRoster,
  scanCoverPages,
  COVER_PAGE_CHECK_MODEL,
  COVER_PAGE_CHECK_SYSTEM_PROMPT,
  buildCoverPageCheckUserPrompt,
  validateCoverPageCheck,
  type CoverPageCheck,
} from "../lib/na-scanning";

const MAX_CONSECUTIVE_API_ERRORS = 3;

export interface QueuedBatchRow {
  id: string;
  packet_version_id: string;
  course_id: string | null;
  source_storage_path: string;
}

export type SegmentAndSplitResult =
  | { outcome: "split"; packetScanId: string }
  | { outcome: "needs-review" }
  | { outcome: "failed"; message: string };

/**
 * Stages 1-2 of the NA scan pipeline, run for one bulk-queued batch. Mirrors
 * app/api/na-review/batch/route.ts's segmentation logic exactly (same
 * cover-page-only scan, same roster grounding) but against a service-role
 * client instead of a request-scoped one, and with a materially different
 * ending: a bulk upload is one PDF per student by construction, so when
 * segmentation finds exactly one confident, roster-matched, full-document
 * segment, this goes straight to "split" without the teacher-confirmation
 * step the multi-student flow requires -- there's nothing to confirm when
 * the whole document is already unambiguously one student's own packet.
 * Anything less clean (more than one segment, or low confidence) is left at
 * status 'segmented', the exact same state the manual single-upload flow
 * produces, so the teacher resolves it through the existing review UI
 * unmodified -- the worker never touches a 'segmented' row again.
 */
export async function runSegmentAndSplit(
  supabase: SupabaseClient,
  anthropic: Anthropic,
  batch: QueuedBatchRow
): Promise<SegmentAndSplitResult> {
  const fail = async (message: string): Promise<SegmentAndSplitResult> => {
    await supabase.from("na_scan_batches").update({ status: "failed", error_message: message }).eq("id", batch.id);
    return { outcome: "failed", message };
  };

  const { data: packetVersion, error: pvErr } = await supabase
    .from("na_packet_versions")
    .select("page_count")
    .eq("id", batch.packet_version_id)
    .maybeSingle();
  if (pvErr) return fail(`Could not load packet version: ${pvErr.message}`);
  const packetPageCount = (packetVersion?.page_count as number | null) ?? null;
  if (!packetPageCount || packetPageCount <= 0) {
    return fail("This packet version has no recorded page count -- cannot segment.");
  }

  const rosterResolution = batch.course_id
    ? await loadInvitedRoster(supabase, batch.course_id)
    : { roster: [], sourceCourseIds: [], isTrack: false };
  const rosterNames = rosterResolution.roster.map((r) => r.fullName);
  const rosterByName = new Map(rosterResolution.roster.map((r) => [r.fullName, r]));

  const { data: file, error: dlErr } = await supabase.storage
    .from(NA_SCAN_BUCKET)
    .download(batch.source_storage_path);
  if (dlErr || !file) return fail(`Could not read the uploaded scan: ${dlErr?.message ?? "not found"}`);
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.subarray(0, 5).toString("utf8") !== "%PDF-") return fail("Uploaded file is not a PDF");

  let sourceDoc: PDFDocument;
  let pageCount: number;
  try {
    sourceDoc = await PDFDocument.load(buffer, { updateMetadata: false });
    pageCount = sourceDoc.getPageCount();
  } catch (e) {
    return fail(`Could not read the PDF's page count: ${e instanceof Error ? e.message : String(e)}`);
  }

  await supabase.from("na_scan_batches").update({ page_count: pageCount }).eq("id", batch.id);

  let consecutiveApiErrors = 0;
  let aborted = false;

  const checkPage = async (page: number): Promise<CoverPageCheck> => {
    const notCover: CoverPageCheck = {
      isCoverPage: false,
      studentName: null,
      rosterMatch: null,
      confidence: "low",
      note: "",
    };
    if (aborted) return notCover;
    try {
      const singlePageDoc = await PDFDocument.create();
      const [copied] = await singlePageDoc.copyPages(sourceDoc, [page - 1]);
      singlePageDoc.addPage(copied);
      const singlePageBytes = await singlePageDoc.save();

      const message = await anthropic.messages.create({
        model: COVER_PAGE_CHECK_MODEL,
        max_tokens: 512,
        system: COVER_PAGE_CHECK_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: Buffer.from(singlePageBytes).toString("base64"),
                },
              },
              { type: "text", text: buildCoverPageCheckUserPrompt(rosterNames) },
            ],
          },
        ],
      });
      consecutiveApiErrors = 0;
      const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
      const validated = validateCoverPageCheck(text);
      return validated.ok ? validated.result : notCover;
    } catch {
      // Unlike the interactive route (which treats every failure, API or
      // otherwise, as "not a cover page" and keeps going -- fine for one
      // isolated bad page with a teacher watching), the unattended worker
      // distinguishes a genuine API failure from a normal negative result:
      // a sustained run of real errors under worker concurrency could
      // otherwise silently misplace several boundaries in a row with
      // nothing louder than a soft warning. Three in a row aborts the scan
      // outright instead of guessing through it.
      consecutiveApiErrors++;
      if (consecutiveApiErrors >= MAX_CONSECUTIVE_API_ERRORS) aborted = true;
      return notCover;
    }
  };

  let scan: Awaited<ReturnType<typeof scanCoverPages>>;
  try {
    scan = await scanCoverPages(pageCount, packetPageCount, checkPage);
  } catch (e) {
    return fail(`Cover-page scan failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (aborted) {
    return fail(
      `Cover-page scan aborted after ${MAX_CONSECUTIVE_API_ERRORS} consecutive Anthropic API errors -- likely a rate limit or outage, not a real "no cover page" result. Safe to retry.`
    );
  }
  if (scan.segments.length === 0) {
    return fail("No student packet could be identified in this scan.");
  }

  const proposedSegments = matchSegmentsToInvitedRoster(scan.segments, rosterResolution.roster).map((seg) => {
    const exact = rosterByName.get(seg.label);
    if (exact) {
      return {
        ...seg,
        matchedInvitedId: exact.invitedId,
        matchedStudentName: exact.fullName,
        matchedProfileId: exact.profileId,
      };
    }
    return seg;
  });

  const now = new Date().toISOString();

  // The clean bulk case: exactly one segment, a confident roster match, and
  // (by construction of scanCoverPages when segments.length === 1) it
  // already covers the whole document -- there is nothing left to confirm.
  const only = proposedSegments.length === 1 ? proposedSegments[0] : null;
  const isCleanSingleStudent = Boolean(only && only.matchedInvitedId && only.confidence === "high");

  if (!isCleanSingleStudent || !only) {
    const { error: updateErr } = await supabase
      .from("na_scan_batches")
      .update({
        status: "segmented",
        proposed_segments: proposedSegments,
        unassigned_pages: [],
        segmented_at: now,
      })
      .eq("id", batch.id);
    if (updateErr) return fail(`Could not save segmentation: ${updateErr.message}`);
    return { outcome: "needs-review" };
  }

  // Split is near-free here: the uploaded PDF already IS the one student's
  // whole packet (a bulk upload is one PDF per student by construction), so
  // split_storage_path can just point at the same source file instead of
  // copying/re-uploading an identical byte range under a new path -- there
  // is nothing for pdf-lib to actually cut.
  const { data: existingScan } = await supabase
    .from("na_packet_scans")
    .select("id")
    .eq("batch_id", batch.id)
    .eq("invited_student_id", only.matchedInvitedId as string)
    .maybeSingle();

  let packetScanId = existingScan?.id as string | undefined;
  if (packetScanId) {
    const { error: updateErr } = await supabase
      .from("na_packet_scans")
      .update({ split_storage_path: batch.source_storage_path, status: "split", updated_at: now })
      .eq("id", packetScanId);
    if (updateErr) return fail(`Could not update existing packet scan: ${updateErr.message}`);
  } else {
    const { data: newScan, error: insertErr } = await supabase
      .from("na_packet_scans")
      .insert({
        batch_id: batch.id,
        packet_version_id: batch.packet_version_id,
        packet_seq: 1,
        invited_student_id: only.matchedInvitedId,
        split_storage_path: batch.source_storage_path,
        id_status: "confirmed",
        status: "split",
      })
      .select("id")
      .single();
    if (insertErr || !newScan) return fail(`Could not create packet scan: ${insertErr?.message ?? "unknown error"}`);
    packetScanId = newScan.id as string;
  }

  const { error: batchUpdateErr } = await supabase
    .from("na_scan_batches")
    .update({
      status: "split",
      proposed_segments: proposedSegments,
      confirmed_segments: [{ label: only.label, pages: only.pages, invitedId: only.matchedInvitedId }],
      unassigned_pages: [],
      segmented_at: now,
      split_at: now,
    })
    .eq("id", batch.id);
  if (batchUpdateErr) return fail(`Could not finalize split: ${batchUpdateErr.message}`);

  return { outcome: "split", packetScanId: packetScanId as string };
}
