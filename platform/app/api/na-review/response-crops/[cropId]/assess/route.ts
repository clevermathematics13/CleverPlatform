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

// ONE Sonnet call, ever, per request. The original design ran all ~37
// gradable crops for a student sequentially inside a single request
// (see the assess/route.ts this replaces) and hit
// FUNCTION_INVOCATION_TIMEOUT on Vercel before finishing a real student
// -- confirmed directly: 24 of 37 crops completed and saved correctly
// before the 300s ceiling killed the request. Moving to one crop per
// request removes the failure mode entirely rather than just raising the
// ceiling further, and mirrors the pattern stage 4's "Crop all" already
// uses successfully: the CLIENT loops over crops with its own sequential
// calls, each individually bounded and individually retryable, instead of
// one server-side loop racing an invocation limit.
export const maxDuration = 60;

/**
 * POST /api/na-review/response-crops/[cropId]/assess
 *
 * Stage 5 of the NA scan pipeline, one crop at a time. Marks a single
 * cropped student answer against its question's own rubric from
 * na_anchors and writes the result to na_feedback.
 *
 * Only ai_* columns are written. final_*, approved_*, and released_at are
 * deliberately never touched -- the pilot established that verdict and
 * marks must stay fully independent with no auto-derivation in either
 * direction, and nothing reaches a student unreviewed. This route
 * produces a proposal for teacher review, never a released grade, and
 * re-running assessment must not silently discard a teacher's own prior
 * decision.
 *
 * Two categories of crop are skipped WITHOUT an API call, both recorded
 * with ai_attempted=false so "chose not to mark" is distinguishable from
 * "marking failed":
 *   - is_blank: stage 4 already found no ink in the box.
 *   - genuinely ungraded anchors (no marks, no answer sketch, no open
 *     rubric) -- in A.1 that's the Desmos "noticings from the sandbox"
 *     thinking space, which has no correct answer by design.
 *
 * A response that fails schema validation is NOT discarded and NOT
 * coerced into a plausible-looking mark: it's written with
 * ai_validation_error set and the raw text preserved, so the crop
 * surfaces in review as explicitly needing a human rather than silently
 * missing.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ cropId: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { cropId } = await params;

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured on this deployment" },
      { status: 500 }
    );
  }

  const { data: crop, error: cropErr } = await supabase
    .from("na_response_crops")
    .select(
      "id, storage_path, is_blank, boundary_expanded, packet_scan_id, na_anchors(qid, base_qid, marks_available, command_term, answer_sketch, open_rubric, misconception_context)"
    )
    .eq("id", cropId)
    .maybeSingle();

  if (cropErr) return NextResponse.json({ error: cropErr.message }, { status: 500 });
  if (!crop) return NextResponse.json({ error: "Crop not found" }, { status: 404 });

  const anchor = Array.isArray(crop.na_anchors) ? crop.na_anchors[0] : crop.na_anchors;
  if (!anchor) {
    return NextResponse.json({ error: "This crop has no linked anchor" }, { status: 400 });
  }

  const ctx: AnchorContext = {
    qid: anchor.qid,
    baseQid: anchor.base_qid ?? anchor.qid,
    marksAvailable: anchor.marks_available,
    commandTerm: anchor.command_term,
    answerSketch: anchor.answer_sketch,
    openRubric: anchor.open_rubric,
    misconceptionContext: anchor.misconception_context,
    // Real, per-crop signal from stage 4's ink-density check -- see
    // buildRubricBlock and the system prompt for how this is used to
    // push back on a false "cut off" read (found on Ines Palomino's
    // Q1(d): boundary_expanded was false, meaning no ink was ever
    // detected touching the edge, yet the model reported truncation
    // anyway on content that was actually fully present).
    boundaryExpanded: crop.boundary_expanded ?? undefined,
  };

  /** Writes one na_feedback row, replacing any prior assessment for this
   *  crop. na_feedback has no UNIQUE constraint on crop_id, so re-running
   *  assessment would otherwise stack duplicate rows for the same answer;
   *  find-or-create keeps exactly one AI proposal per crop. Deliberately
   *  never touches final_*, approved_*, or released_at. */
  const upsertFeedback = async (fields: Record<string, unknown>) => {
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

  // -- Skip paths: recorded, but never sent to the model -----------------------
  if (isUngradedAnchor(ctx)) {
    await upsertFeedback({
      ai_attempted: false,
      ai_teacher_note: "Not marked: this box is an ungraded thinking space (no marks, no answer key, no rubric).",
    });
    return NextResponse.json({ cropId, qid: ctx.qid, status: "skipped", reason: "ungraded anchor" });
  }

  if (crop.is_blank) {
    await upsertFeedback({
      ai_attempted: false,
      ai_marks_available: ctx.marksAvailable,
      ai_teacher_note: "Not marked: crop detected as blank in stage 4 (no ink found in the answer box).",
    });
    return NextResponse.json({ cropId, qid: ctx.qid, status: "skipped", reason: "blank crop" });
  }

  // -- Fetch the crop image -----------------------------------------------------
  let imageBase64: string;
  try {
    const { data: file, error: dlErr } = await supabase.storage
      .from(NA_SCAN_BUCKET)
      .download(crop.storage_path);
    if (dlErr || !file) throw new Error(dlErr?.message ?? "crop image not found in storage");
    imageBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  } catch (e) {
    return NextResponse.json(
      { error: `Could not read crop image: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    );
  }

  // -- Assess --------------------------------------------------------------------
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  try {
    const message = await anthropic.messages.create({
      model: ASSESSMENT_MODEL,
      // Raised from 1024 after a real truncation: the model reasoned in
      // prose before the JSON on one crop and got cut off mid-response
      // (see na-assessment.ts's updated system prompt, which now forbids
      // that pattern at the source). This higher ceiling is a second line
      // of defense, not the primary fix -- a well-behaved JSON-only
      // response needs nowhere near 2048 tokens, but it's cheap insurance
      // against a similarly verbose response slipping through.
      max_tokens: 2048,
      system: ASSESSMENT_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: imageBase64 } },
            {
              // NOTE: no longer byte-identical across every student for a
              // given question, since it now includes this crop's own
              // boundaryExpanded value (see buildRubricBlock's docstring
              // for the caching tradeoff this accepts).
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
      await upsertFeedback({
        ai_attempted: true,
        ai_marks_available: ctx.marksAvailable,
        ai_validation_error: validated.error,
        ai_raw_response: { rawText: text.slice(0, 4000) },
      });
      return NextResponse.json(
        { cropId, qid: ctx.qid, status: "failed", reason: validated.error },
        { status: 502 }
      );
    }

    const a = validated.assessment;
    await upsertFeedback({
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
      // carried marks) are appended rather than dropped -- exactly the
      // cases worth a second look.
      ai_teacher_note: [a.teacherNote, ...validated.warnings].filter(Boolean).join(" | "),
      ai_validation_error: null,
      ai_raw_response: a as unknown as Record<string, unknown>,
    });

    return NextResponse.json({
      cropId,
      qid: ctx.qid,
      status: "assessed",
      verdict: a.verdict,
      marksAwarded: a.marksAwarded,
      marksAvailable: ctx.marksAvailable,
      warnings: validated.warnings.length ? validated.warnings : undefined,
    });
  } catch (e) {
    return NextResponse.json(
      { cropId, qid: ctx.qid, status: "failed", reason: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}
