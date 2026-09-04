import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NA_SCAN_BUCKET } from "../lib/na-scanning";
import {
  ASSESSMENT_MODEL,
  buildAssessmentSystemPrompt,
  AssessmentSchema,
  buildAssessmentUserPrompt,
  buildRubricBlock,
  isUngradedAnchor,
  type AnchorContext,
} from "../lib/na-assessment";

// Deliberately a standalone copy of the skip/upsert logic in
// app/api/na-review/response-crops/[cropId]/assess/route.ts, not a shared
// extraction -- see crop.ts's header comment for why. What's genuinely new
// here (not mirrored from that route) is the fan-out: instead of one
// synchronous Anthropic call per crop, every not-yet-assessed crop for a
// student is submitted as one or more Anthropic Message Batches, at half
// the token cost and with results picked up later by assess-poll.ts.
//
// Submitted in chunks of CHUNK_SIZE crops per Batch, not all of a
// student's ~40 in one call: the desirable-comfort Railway service was
// OOM-killed shortly after this worker's first real run (29 Aug 2026,
// see platform/docs/HANDOFF.md) once base64-encoded images for every crop
// were held in memory simultaneously before submission. Chunking bounds
// peak memory to one chunk's worth of images at a time regardless of how
// many anchors a packet has. assess-poll.ts's "mark this student assessed"
// check was updated to match -- it can no longer assume one batch means
// one student, so it waits for every chunk's crops to clear
// pending_assessment_batch_id, not just the first chunk that finishes.

const CHUNK_SIZE = 10;

interface CropRow {
  id: string;
  storage_path: string;
  is_blank: boolean;
  boundary_expanded: boolean | null;
  possibly_truncated: boolean | null;
  pending_assessment_batch_id: string | null;
  na_anchors:
    | {
        qid: string;
        base_qid: string | null;
        marks_available: number | null;
        command_term: string | null;
        answer_sketch: string | null;
        open_rubric: string | null;
        misconception_context: string | null;
        question_text: string | null;
        question_answer: string | null;
        question_marks: number | null;
      }
    | Array<{
        qid: string;
        base_qid: string | null;
        marks_available: number | null;
        command_term: string | null;
        answer_sketch: string | null;
        open_rubric: string | null;
        misconception_context: string | null;
        question_text: string | null;
        question_answer: string | null;
        question_marks: number | null;
      }>
    | null;
}

export type AssessSubmitResult =
  | { outcome: "submitted"; batchCount: number; requestCount: number }
  | { outcome: "nothing-to-assess" }
  | { outcome: "failed"; message: string };

export async function submitAssessmentBatch(
  supabase: SupabaseClient,
  anthropic: Anthropic,
  packetScanId: string
): Promise<AssessSubmitResult> {
  const fail = async (message: string): Promise<AssessSubmitResult> => {
    const { data: scan } = await supabase.from("na_packet_scans").select("batch_id").eq("id", packetScanId).maybeSingle();
    if (scan?.batch_id) {
      await supabase.from("na_scan_batches").update({ status: "failed", error_message: message }).eq("id", scan.batch_id);
    }
    return { outcome: "failed", message };
  };

  const { data: cropRows, error: cropErr } = await supabase
    .from("na_response_crops")
    .select(
      "id, storage_path, is_blank, boundary_expanded, possibly_truncated, pending_assessment_batch_id, na_anchors(qid, base_qid, marks_available, command_term, answer_sketch, open_rubric, misconception_context, question_text, question_answer, question_marks)"
    )
    .eq("packet_scan_id", packetScanId);
  if (cropErr) return fail(cropErr.message);
  const crops = (cropRows ?? []) as CropRow[];
  if (crops.length === 0) return fail("No crops found for this packet scan -- run stage 4 (crop) first.");

  const cropIds = crops.map((c) => c.id);
  const { data: existingFeedback, error: fbErr } = await supabase
    .from("na_feedback")
    .select("crop_id, ai_attempted, ai_validation_error")
    .in("crop_id", cropIds);
  if (fbErr) return fail(fbErr.message);
  const feedbackByCrop = new Map((existingFeedback ?? []).map((f) => [f.crop_id as string, f]));

  /** Updates by crop_id rather than looking the row up first. The
   *  find-or-create this replaces used `.maybeSingle()`, which ERRORS when a
   *  crop already has more than one row, and the error was destructured away
   *  -- so it fell through to INSERT and added yet another duplicate,
   *  compounding on every run. 60 such rows had accumulated across 28 crops
   *  before this was found; na_feedback now has a UNIQUE constraint on
   *  crop_id so it cannot happen again, and updating by crop_id means this
   *  never attempts the insert that would trip it.
   *
   *  Write errors are logged rather than swallowed: a silently failed write
   *  leaves a crop marked processed with no feedback behind it. */
  const upsertFeedback = async (cropId: string, fields: Record<string, unknown>) => {
    const { data: updated, error: updateErr } = await supabase
      .from("na_feedback")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("crop_id", cropId)
      .select("id");
    if (updateErr) {
      console.error(`[assess-submit] could not update feedback for crop ${cropId}:`, updateErr.message);
      return;
    }
    if (updated && updated.length > 0) return;
    const { error: insertErr } = await supabase.from("na_feedback").insert({ crop_id: cropId, ...fields });
    if (insertErr) {
      console.error(`[assess-submit] could not create feedback for crop ${cropId}:`, insertErr.message);
    }
  };

  // First pass: decide which crops actually need an Anthropic call, writing
  // feedback directly (no API call) for anything skippable. Deliberately
  // does NOT touch crop images yet -- that happens per-chunk below, so at
  // most CHUNK_SIZE images are ever held in memory at once instead of every
  // crop in the packet.
  const pending: { crop: CropRow; ctx: AnchorContext }[] = [];
  for (const crop of crops) {
    if (crop.pending_assessment_batch_id) continue; // already in flight in another batch

    const anchor = Array.isArray(crop.na_anchors) ? crop.na_anchors[0] : crop.na_anchors;
    if (!anchor) continue;

    const ctx: AnchorContext = {
      qid: anchor.qid,
      baseQid: anchor.base_qid ?? anchor.qid,
      marksAvailable: anchor.marks_available,
      commandTerm: anchor.command_term,
      answerSketch: anchor.answer_sketch,
      openRubric: anchor.open_rubric,
      misconceptionContext: anchor.misconception_context,
      questionText: anchor.question_text,
      questionAnswer: anchor.question_answer,
      questionMarks: anchor.question_marks,
      boundaryExpanded: crop.boundary_expanded ?? undefined,
      possiblyTruncated: crop.possibly_truncated ?? undefined,
    };

    if (isUngradedAnchor(ctx)) {
      await upsertFeedback(crop.id, {
        ai_attempted: false,
        ai_teacher_note: "Not marked: this box is an ungraded thinking space (no marks, no answer key, no rubric).",
      });
      continue;
    }
    if (crop.is_blank) {
      await upsertFeedback(crop.id, {
        ai_attempted: false,
        ai_marks_available: ctx.marksAvailable,
        ai_teacher_note: "Not marked: crop detected as blank in stage 4 (no ink found in the answer box).",
      });
      continue;
    }

    const existing = feedbackByCrop.get(crop.id);
    if (existing?.ai_attempted && !existing.ai_validation_error) continue; // already assessed cleanly

    pending.push({ crop, ctx });
  }

  if (pending.length === 0) return { outcome: "nothing-to-assess" };

  // Second pass: submit CHUNK_SIZE crops at a time, each chunk its own
  // Anthropic Batch and its own na_assessment_batches row -- see this
  // file's header comment for why (the 29 Aug 2026 OOM incident).
  let totalSubmitted = 0;
  let batchesCreated = 0;

  for (let start = 0; start < pending.length; start += CHUNK_SIZE) {
    const chunk = pending.slice(start, start + CHUNK_SIZE);
    const requests: Anthropic.Messages.Batches.BatchCreateParams.Request[] = [];
    const includedCropIds: string[] = [];

    for (const { crop, ctx } of chunk) {
      let imageBase64: string;
      try {
        const { data: file, error: dlErr } = await supabase.storage.from(NA_SCAN_BUCKET).download(crop.storage_path);
        if (dlErr || !file) throw new Error(dlErr?.message ?? "crop image not found in storage");
        imageBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");
      } catch (e) {
        // One unreadable crop shouldn't abort the whole chunk -- record it
        // the same way a synchronous failure would and move on.
        await upsertFeedback(crop.id, {
          ai_attempted: true,
          ai_marks_available: ctx.marksAvailable,
          ai_validation_error: `Could not read crop image: ${e instanceof Error ? e.message : String(e)}`,
        });
        continue;
      }

      requests.push({
        custom_id: crop.id, // na_response_crops.id doubles as the Batch API mapping key -- no separate table needed
        params: {
          model: ASSESSMENT_MODEL,
          max_tokens: 2048,
          temperature: 0, // same as the synchronous assess route: marking, not creative writing
          // Well-formed JSON by construction; assess-poll.ts still runs
          // validateAssessment on the text for its own checks.
          output_config: { format: zodOutputFormat(AssessmentSchema) },
          system: buildAssessmentSystemPrompt("crop"),
          messages: [
            {
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type: "image/png", data: imageBase64 } },
                // No cache_control here, unlike the synchronous assess route:
                // the 5-minute ephemeral prompt-cache TTL isn't reliably hit
                // across requests Anthropic may schedule non-adjacently
                // within a Batch, so a cache breakpoint would mostly just add
                // cache-write overhead for reads that never land. The 50%
                // Batch discount applies to every token regardless and should
                // still net out cheaper than synchronous+cache for this shape
                // of workload.
                { type: "text", text: buildRubricBlock(ctx) },
                { type: "text", text: buildAssessmentUserPrompt() },
              ],
            },
          ],
        },
      });
      includedCropIds.push(crop.id);
    }

    if (requests.length === 0) continue; // every image in this chunk failed to read

    let batch: Anthropic.Messages.Batches.MessageBatch;
    try {
      batch = await anthropic.messages.batches.create({ requests });
    } catch (e) {
      return fail(
        `Could not submit assessment batch (crops ${start + 1}-${start + chunk.length} of ${pending.length}): ${e instanceof Error ? e.message : String(e)}`
      );
    }

    const { data: batchRow, error: insertErr } = await supabase
      .from("na_assessment_batches")
      .insert({
        anthropic_batch_id: batch.id,
        packet_scan_id: packetScanId,
        status: "submitted",
        request_count: requests.length,
      })
      .select("id")
      .single();
    if (insertErr || !batchRow) return fail(`Could not record assessment batch: ${insertErr?.message ?? "unknown error"}`);

    await supabase.from("na_response_crops").update({ pending_assessment_batch_id: batchRow.id }).in("id", includedCropIds);

    totalSubmitted += requests.length;
    batchesCreated++;
  }

  if (totalSubmitted === 0) return { outcome: "nothing-to-assess" }; // every crop's image failed to read

  const { data: scan } = await supabase.from("na_packet_scans").select("batch_id").eq("id", packetScanId).maybeSingle();
  if (scan?.batch_id) {
    await supabase.from("na_scan_batches").update({ status: "assessing" }).eq("id", scan.batch_id);
  }

  return { outcome: "submitted", batchCount: batchesCreated, requestCount: totalSubmitted };
}
