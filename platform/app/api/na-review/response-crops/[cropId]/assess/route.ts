import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getApiTeacher } from "@/lib/auth";
import { recordUsage } from "@/lib/ai-usage";
import { NA_SCAN_BUCKET } from "@/lib/na-scanning";
import {
  ASSESSMENT_MODEL,
  buildAssessmentSystemPrompt,
  AssessmentSchema,
  buildAssessmentUserPrompt,
  buildWideContextUserPrompt,
  buildRubricBlock,
  isUngradedAnchor,
  validateAssessment,
  type AnchorContext,
} from "@/lib/na-assessment";

// ONE Sonnet call, ever, per request -- except the rare arrow-across-the-
// box-boundary case (see resolveRedirect below), which adds one more
// call plus a CV service round trip for that single crop only. The
// original design ran all ~37 gradable crops for a student sequentially
// inside a single request (see the assess/route.ts this replaces) and hit
// FUNCTION_INVOCATION_TIMEOUT on Vercel before finishing a real student
// -- confirmed directly: 24 of 37 crops completed and saved correctly
// before the 300s ceiling killed the request. Moving to one crop per
// request removes the failure mode entirely rather than just raising the
// ceiling further, and mirrors the pattern stage 4's "Crop all" already
// uses successfully: the CLIENT loops over crops with its own sequential
// calls, each individually bounded and individually retryable, instead of
// one server-side loop racing an invocation limit.
export const maxDuration = 90;

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
 *   - genuinely ungraded anchors (no marks and no key of any kind) --
 *     in A.1 that's the Desmos "noticings from the sandbox" thinking
 *     space, which has no correct answer by design.
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
      "id, storage_path, is_blank, boundary_expanded, possibly_truncated, packet_scan_id, na_anchors(qid, base_qid, marks_available, command_term, answer_sketch, open_rubric, misconception_context, question_text, question_answer, question_marks, page_index, x0_pt, y0_pt, x1_pt, y1_pt)"
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
    // The question the student was actually asked, and the richer
    // authored answer key. Both were absent from this prompt until a
    // real mismark exposed the gap -- see na-assessment.ts's
    // AnchorContext docs for the specific case (A.1 Q1(e)).
    questionText: anchor.question_text,
    questionAnswer: anchor.question_answer,
    questionMarks: anchor.question_marks,
    // Real, per-crop signal from stage 4's ink-density check -- see
    // buildRubricBlock and the system prompt for how this is used to
    // push back on a false "cut off" read (found on Ines Palomino's
    // Q1(d): boundary_expanded was false, meaning no ink was ever
    // detected touching the edge, yet the model reported truncation
    // anyway on content that was actually fully present).
    boundaryExpanded: crop.boundary_expanded ?? undefined,
    possiblyTruncated: crop.possibly_truncated ?? undefined,
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

  /** Second pass for a crop whose first-pass result set redirectedElsewhere
   *  (an arrow crossing the box boundary in either direction -- leaving it
   *  beside crossed-out work, or pointing into it from work written
   *  outside): renders the FULL page via the CV service with this anchor's
   *  own box outlined in red, then re-assesses from that wider image so the
   *  model can follow the arrow to whichever end holds the student's real
   *  work and grade that instead. Returns
   *  null on any failure (CV service unconfigured, page render failed,
   *  second pass didn't validate) so the caller can fall back to the
   *  first pass's own result rather than losing the assessment. */
  const resolveRedirect = async () => {
    if (!process.env.GRAPH_LAB_CV_SERVICE_URL) return null;
    if (anchor.page_index == null || anchor.x0_pt == null || anchor.y0_pt == null || anchor.x1_pt == null || anchor.y1_pt == null) {
      return null;
    }

    const { data: scan } = await supabase
      .from("na_packet_scans")
      .select("split_storage_path")
      .eq("id", crop.packet_scan_id)
      .maybeSingle();
    if (!scan?.split_storage_path) return null;

    const { data: pdfFile, error: dlErr } = await supabase.storage
      .from(NA_SCAN_BUCKET)
      .download(scan.split_storage_path);
    if (dlErr || !pdfFile) return null;
    const pdfBase64 = Buffer.from(await pdfFile.arrayBuffer()).toString("base64");

    const serviceBase = process.env.GRAPH_LAB_CV_SERVICE_URL.trim().replace(/\/$/, "");
    const target = `${/^https?:\/\//i.test(serviceBase) ? serviceBase : `https://${serviceBase}`}/page-image`;
    const cvSecret = process.env.CV_SERVICE_SECRET ?? "";

    let pageImageBase64: string;
    try {
      const res = await fetch(target, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json", ...(cvSecret ? { "X-CV-Secret": cvSecret } : {}) },
        body: JSON.stringify({
          studentPdfBase64: pdfBase64,
          pageIndex: anchor.page_index,
          rotationHint: 0,
          highlightBox: { x0Pt: anchor.x0_pt, y0Pt: anchor.y0_pt, x1Pt: anchor.x1_pt, y1Pt: anchor.y1_pt },
        }),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { imageBase64?: string };
      if (!body.imageBase64) return null;
      pageImageBase64 = body.imageBase64;
    } catch {
      return null;
    }

    try {
      const message = await anthropic.messages.parse({
        model: ASSESSMENT_MODEL,
        max_tokens: 2048,
        temperature: 0,
        output_config: { format: zodOutputFormat(AssessmentSchema) },
        // Breakpoint on the static system prompt, never after the image --
        // same reasoning as the first-pass call below.
        system: [{ type: "text", text: buildAssessmentSystemPrompt("wide_context"), cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/png", data: pageImageBase64 } },
              { type: "text", text: buildRubricBlock(ctx) },
              { type: "text", text: buildWideContextUserPrompt() },
            ],
          },
        ],
      });
      await recordUsage(supabase, {
        pipeline: "na_assess_wide",
        model: ASSESSMENT_MODEL,
        usage: message.usage,
        ref: { type: "na_crop", id: cropId },
      });
      const text = message.parsed_output
      ? JSON.stringify(message.parsed_output)
      : message.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
      const validated = validateAssessment(text, ctx.marksAvailable);
      if (!validated.ok) return null;
      return validated;
    } catch {
      return null;
    }
  };

  try {
    const message = await anthropic.messages.parse({
      model: ASSESSMENT_MODEL,
      // Structured output from the same zod schema validateAssessment uses:
      // the JSON is well-formed by construction, so the "reasoned in prose
      // and got cut off before the JSON" failure below cannot recur in that
      // form. validateAssessment still runs on the result for its own checks
      // (marks clamping, backtracking-language detection).
      output_config: { format: zodOutputFormat(AssessmentSchema) },
      // Raised from 1024 after a real truncation: the model reasoned in
      // prose before the JSON on one crop and got cut off mid-response
      // (see na-assessment.ts's updated system prompt, which now forbids
      // that pattern at the source). This higher ceiling is a second line
      // of defense, not the primary fix -- a well-behaved JSON-only
      // response needs nowhere near 2048 tokens, but it's cheap insurance
      // against a similarly verbose response slipping through.
      max_tokens: 2048,
      // Marking should be as repeatable as the model allows; the default
      // temperature (1.0) adds sampling noise unrelated to the work. See the
      // AI-grade route for the measured run-to-run drift that motivated this.
      temperature: 0,
      // The cache breakpoint sits on the system prompt, which is the only
      // part of this request that is byte-identical from one crop to the
      // next. It used to sit on the rubric block below, AFTER the image.
      // The API still served the system prompt as a partial-prefix hit
      // under that layout (measured: ~2.8K tokens read on the next crop),
      // but every call also wrote its own image+rubric (~1.8K tokens) to
      // the cache at the 1.25x write rate, and nothing could ever read
      // that back because the next crop's image differs. With the
      // breakpoint here those tokens are plain input instead: about 11%
      // off the per-call cost, measured cold on two consecutive different
      // crops (the numbers are in the PR that made this change). Do not
      // put a breakpoint after the image again.
      system: [{ type: "text", text: buildAssessmentSystemPrompt("crop"), cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: imageBase64 } },
            { type: "text", text: buildRubricBlock(ctx) },
            { type: "text", text: buildAssessmentUserPrompt() },
          ],
        },
      ],
    });

    await recordUsage(supabase, {
      pipeline: "na_assess",
      model: ASSESSMENT_MODEL,
      usage: message.usage,
      ref: { type: "na_crop", id: cropId },
    });
    const text = message.parsed_output
      ? JSON.stringify(message.parsed_output)
      : message.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
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

    let a = validated.assessment;
    let warnings = validated.warnings;
    let usedWiderContext = false;

    // An arrow crossed this crop's boundary -- the work at its other end
    // is by definition outside what this crop can show, so re-assess with
    // the full page in view instead of trusting a mark against content the
    // student either rejected or never meant as their answer.
    // Best-effort: any failure here (CV service unconfigured, page
    // render failed, second pass didn't validate) falls back to the
    // first pass's own result rather than losing the assessment
    // entirely -- a human reviewing this crop will still see the
    // redirect flagged in teacherNote either way.
    if (a.redirectedElsewhere) {
      const resolved = await resolveRedirect();
      if (resolved) {
        a = resolved.assessment;
        warnings = resolved.warnings;
        usedWiderContext = true;
      } else {
        warnings = [...warnings, "An arrow crossing this answer box was detected, meaning the student's real work for this question is elsewhere on the page, but the wider-page re-check could not resolve it -- a teacher should check the original page for where that work was written."];
      }
    }

    await upsertFeedback({
      ai_attempted: true,
      ai_student_attempted: a.studentAttempted,
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
      ai_teacher_note: [a.teacherNote, ...warnings].filter(Boolean).join(" | "),
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
      usedWiderContext: usedWiderContext || undefined,
      warnings: warnings.length ? warnings : undefined,
    });
  } catch (e) {
    return NextResponse.json(
      { cropId, qid: ctx.qid, status: "failed", reason: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}
