import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runSegmentAndSplit, type QueuedBatchRow } from "./segment-and-split";
import { runCrop } from "./crop";
import { submitAssessmentBatch } from "./assess-submit";

const STALE_CLAIM_MINUTES = 30;

export interface PipelineSummary {
  claimed: number;
  split: number;
  needsReview: number;
  cropped: number;
  assessSubmitted: number;
  failed: number;
}

interface ClaimedBatchRow {
  id: string;
  packet_version_id: string;
  course_id: string | null;
  source_storage_path: string;
}

async function claimNext(
  supabase: SupabaseClient,
  workerId: string,
  fromStatus: string,
  toStatus: string
): Promise<ClaimedBatchRow | null> {
  const { data, error } = await supabase.rpc("claim_next_na_scan_batch", {
    p_worker_id: workerId,
    p_from_status: fromStatus,
    p_to_status: toStatus,
  });
  if (error) throw new Error(`claim_next_na_scan_batch(${fromStatus} -> ${toStatus}) failed: ${error.message}`);
  const rows = (data ?? []) as ClaimedBatchRow[];
  return rows[0] ?? null;
}

/** Resets any row stuck in an in-flight status past a crash-recovery window
 *  back to 'failed' with an explanation, rather than leaving it claimable
 *  forever or claimable never again. A real failure should surface loudly,
 *  not silently re-queue in an infinite loop. */
async function reclaimStaleRows(supabase: SupabaseClient): Promise<void> {
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MINUTES * 60_000).toISOString();
  await supabase
    .from("na_scan_batches")
    .update({
      status: "failed",
      error_message: `Worker claim went stale (no progress for ${STALE_CLAIM_MINUTES} minutes) -- likely a worker crash mid-run. Re-upload to retry.`,
    })
    .in("status", ["segmenting", "cropping", "assessing"])
    .lt("claimed_at", staleBefore);
}

async function findPacketScanId(supabase: SupabaseClient, batchId: string): Promise<string | null> {
  const { data } = await supabase.from("na_packet_scans").select("id").eq("batch_id", batchId).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

async function processOneQueuedBatch(
  supabase: SupabaseClient,
  anthropic: Anthropic,
  workerId: string,
  summary: PipelineSummary
): Promise<void> {
  const row = await claimNext(supabase, workerId, "queued", "segmenting");
  if (!row) return;
  summary.claimed++;
  const batch: QueuedBatchRow = {
    id: row.id,
    packet_version_id: row.packet_version_id,
    course_id: row.course_id,
    source_storage_path: row.source_storage_path,
  };
  const result = await runSegmentAndSplit(supabase, anthropic, batch);
  if (result.outcome === "split") summary.split++;
  else if (result.outcome === "needs-review") summary.needsReview++;
  else summary.failed++;
}

async function processOneSplitBatch(
  supabase: SupabaseClient,
  workerId: string,
  summary: PipelineSummary
): Promise<void> {
  const row = await claimNext(supabase, workerId, "split", "cropping");
  if (!row) return;
  const packetScanId = await findPacketScanId(supabase, row.id);
  if (!packetScanId) {
    await supabase
      .from("na_scan_batches")
      .update({ status: "failed", error_message: "No packet scan found for a split batch -- inconsistent state." })
      .eq("id", row.id);
    summary.failed++;
    return;
  }
  const result = await runCrop(supabase, packetScanId);
  if (result.outcome === "cropped") {
    await supabase.from("na_scan_batches").update({ status: "cropped" }).eq("id", row.id);
    summary.cropped++;
  } else {
    summary.failed++;
  }
}

async function processOneCroppedBatch(
  supabase: SupabaseClient,
  anthropic: Anthropic,
  workerId: string,
  summary: PipelineSummary
): Promise<void> {
  const row = await claimNext(supabase, workerId, "cropped", "assessing");
  if (!row) return;
  const packetScanId = await findPacketScanId(supabase, row.id);
  if (!packetScanId) {
    await supabase
      .from("na_scan_batches")
      .update({ status: "failed", error_message: "No packet scan found for a cropped batch -- inconsistent state." })
      .eq("id", row.id);
    summary.failed++;
    return;
  }
  const result = await submitAssessmentBatch(supabase, anthropic, packetScanId);
  if (result.outcome === "submitted") {
    summary.assessSubmitted++;
  } else if (result.outcome === "nothing-to-assess") {
    // Every crop was skipped (blank/ungraded) with no real API call needed
    // -- nothing to poll for later, so this student is already done.
    await supabase.from("na_scan_batches").update({ status: "assessed" }).eq("id", row.id);
  } else {
    summary.failed++;
  }
}

/**
 * One full pass over every stage transition the worker owns
 * (queued->segmenting, split->cropping, cropped->assessing), claiming and
 * processing up to `concurrency` rows at each stage. Called repeatedly by
 * index.ts's main loop. Each claimed row's own chain (e.g. segment -> split
 * -> mark split) runs to completion sequentially; it's the NUMBER of rows
 * claimed concurrently across the whole pass that WORKER_CONCURRENCY bounds
 * -- see index.ts for why that's kept conservative by default (this
 * account's real per-minute Anthropic rate-limit tier is unverified, and
 * stage 1 is the one stage here that still makes synchronous Anthropic
 * calls at all).
 */
export async function runPipelinePass(
  supabase: SupabaseClient,
  anthropic: Anthropic,
  workerId: string,
  concurrency: number
): Promise<PipelineSummary> {
  await reclaimStaleRows(supabase);

  const summary: PipelineSummary = {
    claimed: 0,
    split: 0,
    needsReview: 0,
    cropped: 0,
    assessSubmitted: 0,
    failed: 0,
  };

  await Promise.all(
    Array.from({ length: concurrency }, () => processOneQueuedBatch(supabase, anthropic, workerId, summary))
  );
  await Promise.all(Array.from({ length: concurrency }, () => processOneSplitBatch(supabase, workerId, summary)));
  await Promise.all(
    Array.from({ length: concurrency }, () => processOneCroppedBatch(supabase, anthropic, workerId, summary))
  );

  return summary;
}
