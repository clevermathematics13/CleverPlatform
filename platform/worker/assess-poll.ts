import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { validateAssessment } from "../lib/na-assessment";

export interface PollSummary {
  checked: number;
  ended: number;
  resultsWritten: number;
  failed: number;
}

/**
 * The other half of the Batch API flow (see assess-submit.ts for the
 * submit side): checks every open na_assessment_batches row, and once
 * Anthropic reports a batch as ended, streams its .jsonl results and writes
 * each one to na_feedback exactly as the synchronous assess route would --
 * same validateAssessment call, same field mapping, same
 * ai_validation_error-on-failure behavior, just reading from a batch result
 * instead of a live API response. Run on an interval from index.ts;
 * idempotent to re-run (a batch already at 'results_written' is filtered
 * out by the status query up front).
 */
export async function pollAssessmentBatches(supabase: SupabaseClient, anthropic: Anthropic): Promise<PollSummary> {
  const summary: PollSummary = { checked: 0, ended: 0, resultsWritten: 0, failed: 0 };

  const { data: openBatches, error } = await supabase
    .from("na_assessment_batches")
    .select("id, anthropic_batch_id, packet_scan_id, status")
    .in("status", ["submitted", "in_progress"]);
  if (error || !openBatches) return summary;

  for (const row of openBatches) {
    summary.checked++;

    let batch: Anthropic.Messages.Batches.MessageBatch;
    try {
      batch = await anthropic.messages.batches.retrieve(row.anthropic_batch_id);
    } catch {
      continue; // transient retrieve failure -- picked up again next poll
    }

    if (batch.processing_status !== "ended") {
      if (row.status !== "in_progress") {
        await supabase.from("na_assessment_batches").update({ status: "in_progress" }).eq("id", row.id);
      }
      continue;
    }

    summary.ended++;
    await supabase
      .from("na_assessment_batches")
      .update({ status: "ended", ended_at: batch.ended_at ?? new Date().toISOString() })
      .eq("id", row.id);

    try {
      await writeResultsForBatch(supabase, anthropic, row.anthropic_batch_id, row.packet_scan_id);
      await supabase
        .from("na_assessment_batches")
        .update({ status: "results_written", results_written_at: new Date().toISOString() })
        .eq("id", row.id);
      summary.resultsWritten++;

      // A na_scan_batches row can hold several students (any number of
      // clean segments auto-splits, not just one -- see segment-and-split.ts),
      // and each student's own crops can be split across several chunked
      // Batches (see assess-submit.ts's CHUNK_SIZE). So "is the batch done"
      // means checking every OTHER student under the same batch_id too, not
      // just this one Anthropic Batch's own packet scan -- a crop still has
      // pending_assessment_batch_id set for as long as ANY chunk for ANY
      // student in the batch hasn't had its results written yet.
      const { data: scan } = await supabase
        .from("na_packet_scans")
        .select("batch_id")
        .eq("id", row.packet_scan_id)
        .maybeSingle();

      if (scan?.batch_id) {
        const { data: siblingScans } = await supabase
          .from("na_packet_scans")
          .select("id")
          .eq("batch_id", scan.batch_id);
        const siblingIds = (siblingScans ?? []).map((s) => s.id as string);

        const { count: stillPending } = await supabase
          .from("na_response_crops")
          .select("id", { count: "exact", head: true })
          .in("packet_scan_id", siblingIds)
          .not("pending_assessment_batch_id", "is", null);

        if (!stillPending) {
          await supabase.from("na_scan_batches").update({ status: "assessed" }).eq("id", scan.batch_id);
        }
      }
    } catch (e) {
      summary.failed++;
      await supabase
        .from("na_assessment_batches")
        .update({ status: "failed", error_message: e instanceof Error ? e.message : String(e) })
        .eq("id", row.id);
    }
  }

  return summary;
}

interface CropMarksRow {
  id: string;
  na_anchors: { marks_available: number | null } | { marks_available: number | null }[] | null;
}

async function writeResultsForBatch(
  supabase: SupabaseClient,
  anthropic: Anthropic,
  anthropicBatchId: string,
  packetScanId: string
) {
  // marksAvailable is needed to validate/clamp each result -- load once for
  // every crop this batch could have touched, keyed by crop id (which
  // doubles as the Batch API's custom_id -- see assess-submit.ts).
  const { data: cropRows } = await supabase
    .from("na_response_crops")
    .select("id, na_anchors(marks_available)")
    .eq("packet_scan_id", packetScanId);
  const marksAvailableByCrop = new Map(
    ((cropRows ?? []) as CropMarksRow[]).map((c) => {
      const anchor = Array.isArray(c.na_anchors) ? c.na_anchors[0] : c.na_anchors;
      return [c.id, anchor?.marks_available ?? null];
    })
  );

  const upsertFeedback = async (cropId: string, fields: Record<string, unknown>) => {
    const { data: existing } = await supabase.from("na_feedback").select("id").eq("crop_id", cropId).maybeSingle();
    if (existing?.id) {
      await supabase
        .from("na_feedback")
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
    } else {
      await supabase.from("na_feedback").insert({ crop_id: cropId, ...fields });
    }
  };

  const results = await anthropic.messages.batches.results(anthropicBatchId);
  for await (const line of results) {
    const cropId = line.custom_id;
    const marksAvailable = marksAvailableByCrop.get(cropId) ?? null;

    if (line.result.type === "succeeded") {
      const text = line.result.message.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
      const validated = validateAssessment(text, marksAvailable);
      if (!validated.ok) {
        await upsertFeedback(cropId, {
          ai_attempted: true,
          ai_marks_available: marksAvailable,
          ai_validation_error: validated.error,
          ai_raw_response: { rawText: text.slice(0, 4000) },
        });
      } else {
        const a = validated.assessment;
        await upsertFeedback(cropId, {
          ai_attempted: true,
          ai_transcription: a.transcription,
          ai_verdict: a.verdict,
          ai_marks_awarded: a.marksAwarded,
          ai_marks_available: marksAvailable,
          ai_misconception_tags: a.misconceptionTags,
          ai_margin_comment: a.marginComment,
          ai_next_step: a.nextStep,
          ai_confidence: a.confidence,
          ai_teacher_note: [a.teacherNote, ...validated.warnings].filter(Boolean).join(" | "),
          ai_validation_error: null,
          ai_raw_response: a as unknown as Record<string, unknown>,
        });
      }
    } else {
      const reason = line.result.type === "errored" ? line.result.error.error.message : line.result.type;
      await upsertFeedback(cropId, {
        ai_attempted: true,
        ai_marks_available: marksAvailable,
        ai_validation_error: `Batch request ${line.result.type}: ${reason}`,
      });
    }

    await supabase.from("na_response_crops").update({ pending_assessment_batch_id: null }).eq("id", cropId);
  }
}
