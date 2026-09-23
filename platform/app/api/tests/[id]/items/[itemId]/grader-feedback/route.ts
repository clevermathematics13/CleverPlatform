import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getApiTeacher } from "@/lib/auth";
import { recordUsage } from "@/lib/ai-usage";
import { assembleMarkScheme, unitLabel } from "@/lib/ai-grading";
import {
  GRADER_FEEDBACK_MODEL,
  GraderFeedbackResponseSchema,
  buildGraderFeedbackSystemBlocks,
  buildGraderFeedbackUserPrompt,
  type GraderFeedbackCase,
} from "@/lib/grader-feedback";

/**
 * POST /api/tests/[id]/items/[itemId]/grader-feedback
 * Body: { feedback: string, resultId?: string }
 *
 * Turns a teacher's feedback on one part into a draft of that part's marking
 * notes (see lib/grader-feedback.ts). Records the round in grader_feedback
 * and returns the draft; the teacher reviews it and saves it through
 * PUT .../marking-notes, which is the only write to what the marker reads.
 * Nothing is marked or re-marked here.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;
  const { id: testId, itemId } = await params;

  let body: { feedback?: unknown; resultId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const feedback = typeof body.feedback === "string" ? body.feedback.trim() : "";
  if (!feedback) return NextResponse.json({ error: "feedback is required" }, { status: 400 });
  if (feedback.length > 4000) {
    return NextResponse.json({ error: "feedback must be 4000 characters or fewer" }, { status: 400 });
  }
  const resultId = typeof body.resultId === "string" && body.resultId.trim() ? body.resultId.trim() : null;

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not configured on this deployment" }, { status: 500 });
  }

  const { data: item, error: itemErr } = await supabase
    .from("test_items")
    .select("id, test_id, marking_notes")
    .eq("id", itemId)
    .maybeSingle();
  if (itemErr) return NextResponse.json({ error: itemErr.message }, { status: 500 });
  if (!item || item.test_id !== testId) {
    return NextResponse.json({ error: "This part does not belong to the specified assessment" }, { status: 404 });
  }

  const { units } = await assembleMarkScheme(supabase, testId);
  const unit = units.find((u) => u.testItemId === itemId);
  if (!unit) return NextResponse.json({ error: "Could not load this part's mark scheme" }, { status: 500 });

  let graded: GraderFeedbackCase | null = null;
  if (resultId) {
    const { data: result } = await supabase
      .from("ai_grade_results")
      .select("id, test_item_id, suggested_marks, max_marks, confidence, evidence, reasoning, mark_breakdown, ai_grade_runs!inner(test_id)")
      .eq("id", resultId)
      .maybeSingle();
    const run = result?.ai_grade_runs as unknown as { test_id: string } | undefined;
    if (result && result.test_item_id === itemId && run?.test_id === testId) {
      graded = {
        studentLabel: `${unitLabel(unit)}, the student under review`,
        evidence: result.evidence ?? "",
        reasoning: result.reasoning ?? "",
        markBreakdown: Array.isArray(result.mark_breakdown) ? (result.mark_breakdown as GraderFeedbackCase["markBreakdown"]) : [],
        suggestedMarks: result.suggested_marks,
        maxMarks: result.max_marks,
        confidence: result.confidence,
      };
    }
  }

  const currentNotes: string | null = item.marking_notes?.trim() || null;
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const systemBlocks = buildGraderFeedbackSystemBlocks(unit);

  let parsed: ReturnType<typeof GraderFeedbackResponseSchema.parse> | null = null;
  let lastError = "Model returned an empty response";
  for (let attempt = 1; attempt <= 2 && !parsed; attempt++) {
    try {
      const message = await anthropic.messages.parse({
        model: GRADER_FEEDBACK_MODEL,
        max_tokens: 16000,
        // Adaptive thinking at high effort: the draft has to reconcile a
        // sentence of feedback with the scheme and the policy, and a wrong
        // ruling is read on every later script.
        thinking: { type: "adaptive" },
        output_config: { effort: "high", format: zodOutputFormat(GraderFeedbackResponseSchema) },
        // Two blocks with the breakpoint on the first: the grader's own prompt
        // for this paper, which a marking call may have cached minutes ago
        // (1h TTL on the interactive route), then this call's task block.
        system: [
          { type: "text", text: systemBlocks.grading, cache_control: { type: "ephemeral", ttl: "1h" } },
          { type: "text", text: systemBlocks.task },
        ],
        messages: [{ role: "user", content: buildGraderFeedbackUserPrompt({ unit, feedback, currentNotes, graded }) }],
      });
      await recordUsage(supabase, {
        pipeline: "grader_feedback",
        model: GRADER_FEEDBACK_MODEL,
        usage: message.usage,
        ref: resultId ? { type: "ai_grade_result", id: resultId } : undefined,
      });
      if (message.stop_reason === "max_tokens") {
        lastError = "Model response was cut off at max_tokens";
        continue;
      }
      if (message.stop_reason === "refusal") {
        lastError = "The model declined this request";
        break;
      }
      if (message.parsed_output) {
        parsed = GraderFeedbackResponseSchema.parse(message.parsed_output);
      } else {
        lastError = "Model returned no structured output";
      }
    } catch (e) {
      return NextResponse.json(
        { error: `Drafting request failed: ${e instanceof Error ? e.message : String(e)}` },
        { status: 500 }
      );
    }
  }
  if (!parsed) return NextResponse.json({ error: lastError }, { status: 502 });

  const proposedNotes = parsed.cannotApply ? null : parsed.markingNotes.trim() || null;
  const { data: row, error: insertErr } = await supabase
    .from("grader_feedback")
    .insert({
      test_id: testId,
      test_item_id: itemId,
      result_id: graded ? resultId : null,
      feedback,
      previous_notes: currentNotes,
      proposed_notes: proposedNotes,
      summary: parsed.cannotApply ?? parsed.summary,
      model: GRADER_FEEDBACK_MODEL,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  return NextResponse.json({
    feedbackId: row.id,
    proposal: {
      markingNotes: proposedNotes,
      summary: parsed.summary,
      caseMarks: parsed.caseMarks,
      cannotApply: parsed.cannotApply,
    },
  });
}
