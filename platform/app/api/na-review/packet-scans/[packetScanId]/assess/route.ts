import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getApiTeacher } from "@/lib/auth";
import { NA_SCAN_BUCKET } from "@/lib/na-scanning";
import {
  ASSESSMENT_MODEL,
  ASSESSMENT_SYSTEM_PROMPT,
  buildAssessmentUserPrompt,
  buildRubricBlock,
  isUngradedAnchor,
  validateAssessment,
  type AnchorContext,
} from "@/lib/na-assessment";

// 39 anchors per student, one Sonnet call each, minus blanks and the
// ungraded sandbox box. Sequential within one student to keep ordering
// and error attribution simple; the client runs students one at a time
// (see the scan-test harness's "Assess all"), so this route's budget only
// ever has to cover ONE student's crops.
export const maxDuration = 300;

interface CropRow {
  id: string;
  storage_path: string;
  is_blank: boolean | null;
  anchor_id: string;
  na_anchors: {
    qid: string;
    base_qid: string | null;
    marks_available: number | null;
    command_term: string | null;
    answer_sketch: string | null;
    open_rubric: string | null;
    misconception_context: string | null;
  } | null;
}

/**
 * POST /api/na-review/packet-scans/[packetScanId]/assess
 *
 * Stage 5 of the NA scan pipeline. For one student whose crops already
 * exist (stage 4), marks each cropped answer against that question's own
 * rubric from na_anchors and writes the result to na_feedback.
 *
 * Only the ai_* columns are written here. The final_* columns are the
 * teacher's decision and are deliberately left untouched -- the pilot
 * established that verdict and marks must stay fully independent with no
 * auto-derivation in either direction, and nothing reaches a student
 * unreviewed. This route produces a proposal, never a released grade.
 *
 * Two categories of crop are skipped WITHOUT an API call:
 *   - is_blank: stage 4 already determined there's no ink to mark.
 *   - genuinely ungraded anchors (no marks, no answer sketch, no open
 *     rubric) -- in A.1 that's the Desmos "noticings from the sandbox"
 *     thinking space, which has no correct answer by design.
 * Both are recorded with ai_attempted=false so a teacher can tell "we
 * chose not to mark this" apart from "marking failed".
 *
 * A response that fails schema validation is NOT discarded and NOT
 * coerced into a plausible-looking mark: it's written with
 * ai_validation_error set and no verdict, so the crop surfaces in review
 * as explicitly needing a human rather than silently missing.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ packetScanId: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { packetScanId } = await params;

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured on this deployment" },
      { status: 500 }
    );
  }

  const { data: scan, error: scanErr } = await supabase
    .from("na_packet_scans")
    .select("id, status")
    .eq("id", packetScanId)
    .maybeSingle();
  if (scanErr) return NextResponse.json({ error: scanErr.message }, { status: 500 });
  if (!scan) return NextResponse.json({ error: "Packet scan not found" }, { status: 404 });

  // -- Load this student's crops, each with its anchor's rubric ---------------
  const { data: cropRows, error: cropsErr } = await supabase
    .from("na_response_crops")
    .select(
      "id, storage_path, is_blank, anchor_id, na_anchors(qid, base_qid, marks_available, command_term, answer_sketch, open_rubric, misconception_context)"
    )
    .eq("packet_scan_id", packetScanId);

  if (cropsErr) return NextResponse.json({ error: cropsErr.message }, { status: 500 });
  const crops = (cropRows ?? []) as unknown as CropRow[];
  if (crops.length === 0) {
    return NextResponse.json(
      { error: "This packet scan has no crops yet -- run stage 4 (crop) first." },
      { status: 400 }
    );
  }

  // Assess in the packet's own question order so progress reads naturally
  // and a partial run stops somewhere predictable rather than mid-scatter.
  crops.sort((a, b) => (a.na_anchors?.qid ?? "").localeCompare(b.na_anchors?.qid ?? "", undefined, { numeric: true }));

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const results: {
    qid: string;
    cropId: string;
    status: "assessed" | "skipped" | "failed";
    verdict?: string;
    marksAwarded?: number;
    marksAvailable?: number | null;
    reason?: string;
    warnings?: string[];
  }[] = [];

  /** Writes one na_feedback row, replacing any prior assessment for this
   *  crop. na_feedback has no UNIQUE constraint on crop_id, so re-running
   *  assessment would otherwise stack duplicate rows for the same answer;
   *  find-or-create keeps exactly one AI proposal per crop. Deliberately
   *  never touches final_*, approved_*, or released_at -- re-assessing
   *  must not silently discard a teacher's own decision. */
  const upsertFeedback = async (cropId: string, fields: Record<string, unknown>) => {
    const { data: existing } = await supabase
      .from("na_feedback")
      .select("id")
      .eq("crop_id", cropId)
      .maybeSingle();
    if (existing?.id) {
      const { error } = await supabase
        .from("na_feedback")
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (error) throw new Error(`Could not update feedback: ${error.message}`);
      return existing.id as string;
    }
    const { data: created, error } = await supabase
      .from("na_feedback")
      .insert({ crop_id: cropId, ...fields })
      .select("id")
      .single();
    if (error || !created) throw new Error(`Could not create feedback: ${error?.message}`);
    return created.id as string;
  };

  for (const crop of crops) {
    const anchor = crop.na_anchors;
    const qid = anchor?.qid ?? "(unknown)";
    if (!anchor) {
      results.push({ qid, cropId: crop.id, status: "failed", reason: "Crop has no linked anchor" });
      continue;
    }

    const ctx: AnchorContext = {
      qid: anchor.qid,
      baseQid: anchor.base_qid ?? anchor.qid,
      marksAvailable: anchor.marks_available,
      commandTerm: anchor.command_term,
      answerSketch: anchor.answer_sketch,
      openRubric: anchor.open_rubric,
      misconceptionContext: anchor.misconception_context,
    };

    // -- Skip paths: recorded, but never sent to the model ------------------
    if (isUngradedAnchor(ctx)) {
      try {
        await upsertFeedback(crop.id, {
          ai_attempted: false,
          ai_teacher_note:
            "Not marked: this box is an ungraded thinking space (no marks, no answer key, no rubric).",
        });
      } catch (e) {
        results.push({ qid, cropId: crop.id, status: "failed", reason: e instanceof Error ? e.message : String(e) });
        continue;
      }
      results.push({ qid, cropId: crop.id, status: "skipped", reason: "ungraded anchor" });
      continue;
    }

    if (crop.is_blank) {
      try {
        await upsertFeedback(crop.id, {
          ai_attempted: false,
          ai_marks_available: ctx.marksAvailable,
          ai_teacher_note: "Not marked: crop detected as blank in stage 4 (no ink found in the answer box).",
        });
      } catch (e) {
        results.push({ qid, cropId: crop.id, status: "failed", reason: e instanceof Error ? e.message : String(e) });
        continue;
      }
      results.push({ qid, cropId: crop.id, status: "skipped", reason: "blank crop" });
      continue;
    }

    // -- Fetch the crop image -----------------------------------------------
    let imageBase64: string;
    try {
      const { data: file, error: dlErr } = await supabase.storage
        .from(NA_SCAN_BUCKET)
        .download(crop.storage_path);
      if (dlErr || !file) throw new Error(dlErr?.message ?? "crop image not found in storage");
      imageBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    } catch (e) {
      results.push({
        qid,
        cropId: crop.id,
        status: "failed",
        reason: `Could not read crop image: ${e instanceof Error ? e.message : String(e)}`,
      });
      continue;
    }

    // -- Assess --------------------------------------------------------------
    try {
      const message = await anthropic.messages.create({
        model: ASSESSMENT_MODEL,
        max_tokens: 1024,
        system: ASSESSMENT_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: "image/png", data: imageBase64 },
              },
              {
                // The rubric is byte-identical for every student answering
                // this question, so it's the one part of the request worth
                // caching. Cached input is billed at a fraction of normal
                // rate, which is where most of this stage's savings come
                // from without giving up one-call-per-crop isolation.
                type: "text",
                text: buildRubricBlock(ctx),
                cache_control: { type: "ephemeral" },
              },
              { type: "text", text: buildAssessmentUserPrompt() },
            ],
          },
        ],
      });

      const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
      const validated = validateAssessment(text, ctx.marksAvailable);

      if (!validated.ok) {
        // Recorded, not discarded: the crop surfaces in review as needing
        // a human rather than silently vanishing from the student's marks.
        await upsertFeedback(crop.id, {
          ai_attempted: true,
          ai_marks_available: ctx.marksAvailable,
          ai_validation_error: validated.error,
          ai_raw_response: { rawText: text.slice(0, 4000) },
        });
        results.push({ qid, cropId: crop.id, status: "failed", reason: validated.error });
        continue;
      }

      const a = validated.assessment;
      await upsertFeedback(crop.id, {
        ai_attempted: true,
        ai_transcription: a.transcription,
        ai_verdict: a.verdict,
        ai_marks_awarded: a.marksAwarded,
        ai_marks_available: ctx.marksAvailable,
        ai_misconception_tags: a.misconceptionTags,
        ai_margin_comment: a.marginComment,
        ai_next_step: a.nextStep,
        ai_confidence: a.confidence,
        // Validation warnings (clamped marks, an "unclear" verdict that
        // carried marks) are appended to the teacher note rather than
        // dropped -- they're precisely the cases a human should look at.
        ai_teacher_note: [a.teacherNote, ...validated.warnings].filter(Boolean).join(" | "),
        ai_validation_error: null,
        ai_raw_response: a as unknown as Record<string, unknown>,
      });

      results.push({
        qid,
        cropId: crop.id,
        status: "assessed",
        verdict: a.verdict,
        marksAwarded: a.marksAwarded,
        marksAvailable: ctx.marksAvailable,
        warnings: validated.warnings.length ? validated.warnings : undefined,
      });
    } catch (e) {
      results.push({
        qid,
        cropId: crop.id,
        status: "failed",
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const assessed = results.filter((r) => r.status === "assessed");
  const failedCount = results.filter((r) => r.status === "failed").length;

  // Only advance the scan's status when every gradable crop actually got a
  // verdict -- a partial run should stay visibly incomplete rather than
  // reading as ready for review.
  if (failedCount === 0) {
    await supabase
      .from("na_packet_scans")
      .update({ status: "assessed", updated_at: new Date().toISOString() })
      .eq("id", packetScanId);
  }

  return NextResponse.json({
    packetScanId,
    results,
    assessedCount: assessed.length,
    skippedCount: results.filter((r) => r.status === "skipped").length,
    failedCount,
    unclearCount: assessed.filter((r) => r.verdict === "unclear").length,
    marksAwarded: assessed.reduce((sum, r) => sum + (r.marksAwarded ?? 0), 0),
    marksAvailable: assessed.reduce((sum, r) => sum + (r.marksAvailable ?? 0), 0),
  });
}
