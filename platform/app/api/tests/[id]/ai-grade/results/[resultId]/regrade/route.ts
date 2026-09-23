import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getApiTeacher } from "@/lib/auth";
import { recordUsage } from "@/lib/ai-usage";
import {
  AiGradeResponseSchema,
  GRADING_MODEL,
  assembleMarkScheme,
  buildGradingSystemPrompt,
  buildRegradeItemPrompt,
  followThroughWarnings,
  gradeNeedsReview,
  isFollowThroughWarningAbout,
  unitLabel,
  validateGradeResponse,
} from "@/lib/ai-grading";

/**
 * POST /api/tests/[id]/ai-grade/results/[resultId]/regrade
 * Body: { evidence: string }
 *
 * Re-marks a single already-graded part from a teacher-corrected
 * transcription, for the case where the original automated `evidence` text
 * misread the student's handwriting (e.g. a confused digit) and the
 * resulting mark_breakdown/suggested_marks are wrong as a result -- no
 * amount of tuning the marking rules fixes a wrong transcription, since
 * every rule downstream just trusts it.
 *
 * Scoped to one part rather than re-running the whole test: cheaper, and it
 * doesn't risk re-introducing a *different* transcription error into parts
 * that were already read correctly. No PDF or image is sent to the model
 * here -- the teacher-supplied text stands in for what the model would
 * otherwise have transcribed itself from the scan.
 *
 * If the result was already accepted into Clev's Marks, this clears that
 * flag: a correction changes the basis the accept happened on, so it needs
 * fresh teacher sign-off (via the normal accept route, which is also what
 * corrects the stale student_marks row) before it counts as final again.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; resultId: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const { id: testId, resultId } = await params;

  let body: { evidence?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.evidence !== "string") {
    return NextResponse.json({ error: "evidence is required" }, { status: 400 });
  }
  const correctedEvidence = body.evidence.trim();

  const { data: result, error: resultErr } = await supabase
    .from("ai_grade_results")
    .select("id, run_id, test_item_id, evidence, accepted, suggested_marks")
    .eq("id", resultId)
    .maybeSingle();

  if (resultErr) return NextResponse.json({ error: resultErr.message }, { status: 500 });
  if (!result) return NextResponse.json({ error: "Result not found" }, { status: 404 });

  const { data: run, error: runErr } = await supabase
    .from("ai_grade_runs")
    .select("id, test_id, coverage")
    .eq("id", result.run_id)
    .maybeSingle();

  if (runErr) return NextResponse.json({ error: runErr.message }, { status: 500 });
  if (!run || run.test_id !== testId) {
    return NextResponse.json({ error: "This result does not belong to the specified assessment" }, { status: 400 });
  }

  // No-op save: nothing changed, so nothing to re-grade or spend API cost on.
  if (correctedEvidence === (result.evidence ?? "").trim()) {
    return NextResponse.json({ unchanged: true });
  }

  const { units } = await assembleMarkScheme(supabase, testId);
  const unit = units.find((u) => u.testItemId === result.test_item_id);
  if (!unit) {
    return NextResponse.json({ error: "Could not load this part's mark scheme" }, { status: 500 });
  }

  // The run's other rows. The earlier parts of this question go to the model
  // as follow-through context -- a value carried into this part from one of
  // them is judged by the method here, which the model cannot do without
  // seeing them -- and the later parts are what a changed mark leaves stale.
  const { data: runRows, error: runRowsErr } = await supabase
    .from("ai_grade_results")
    .select("test_item_id, suggested_marks, confidence, work_found, accepted, evidence")
    .eq("run_id", run.id);
  const rowByItem = new Map((runRowsErr ? [] : runRows ?? []).map((r) => [r.test_item_id, r]));
  const unitIndex = units.findIndex((u) => u.testItemId === unit.testItemId);
  const priorParts = units
    .slice(0, Math.max(0, unitIndex))
    .filter((u) => u.questionNumber === unit.questionNumber)
    .flatMap((u) => {
      const r = rowByItem.get(u.testItemId);
      return r
        ? [{ label: unitLabel(u), evidence: r.evidence ?? "", suggestedMarks: r.suggested_marks, maxMarks: u.maxMarks }]
        : [];
    });

  let updateFields: {
    evidence: string;
    work_found: boolean;
    reasoning: string;
    mark_breakdown: unknown;
    suggested_marks: number;
    confidence: string;
  };

  if (correctedEvidence === "") {
    // Clearing the text is the teacher's way of saying "there's actually no
    // work here" -- mirrors the main route's rule for a blank/absent part,
    // and needs no model call since there's nothing left to judge.
    updateFields = {
      evidence: "",
      work_found: false,
      reasoning: "No evidence provided (marked as no attempt found).",
      mark_breakdown: [],
      suggested_marks: 0,
      confidence: "high",
    };
  } else {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY is not configured on this deployment" },
        { status: 500 }
      );
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // Structured output plus one retry on a malformed/invalid response --
    // same shape as the main grading route, see the comment there.
    let validation: ReturnType<typeof validateGradeResponse> | null = null;
    let lastError = "Model returned an empty response";
    for (let attempt = 1; attempt <= 2 && !validation; attempt++) {
      let responseText: string;
      try {
        const message = await anthropic.messages.parse({
          model: GRADING_MODEL,
          max_tokens: 4096,
          temperature: 0, // same reasoning as the main grading route
          system: buildGradingSystemPrompt([unit]),
          messages: [
            { role: "user", content: buildRegradeItemPrompt(unit, correctedEvidence, priorParts) },
          ],
          output_config: { format: zodOutputFormat(AiGradeResponseSchema) },
        });
        await recordUsage(supabase, {
          pipeline: "ai_regrade",
          model: GRADING_MODEL,
          usage: message.usage,
          ref: { type: "ai_grade_result", id: resultId },
        });
        if (message.stop_reason === "max_tokens") {
          lastError = "Model response was cut off at max_tokens";
          continue;
        }
        responseText = message.parsed_output
          ? JSON.stringify(message.parsed_output)
          : message.content.map((block) => (block.type === "text" ? block.text : "")).join("\n");
      } catch (e) {
        return NextResponse.json(
          { error: `Re-grading request failed: ${e instanceof Error ? e.message : String(e)}` },
          { status: 500 }
        );
      }

      if (!responseText.trim()) {
        lastError = "Model returned an empty response";
        continue;
      }
      const attemptValidation = validateGradeResponse(responseText, [unit]);
      if (attemptValidation.ok) validation = attemptValidation;
      else lastError = attemptValidation.error;
    }
    if (!validation || !validation.ok) {
      return NextResponse.json({ error: lastError }, { status: 502 });
    }
    const grade = validation.outcome.grades[0];
    if (!grade) {
      return NextResponse.json({ error: "Model returned no gradeable result for this part" }, { status: 502 });
    }

    updateFields = {
      // The teacher's corrected text is the source of truth for what's
      // displayed, not whatever the model echoed back in its own response.
      evidence: correctedEvidence,
      work_found: grade.item.workFound,
      reasoning: grade.item.reasoning,
      mark_breakdown: grade.item.markBreakdown,
      suggested_marks: grade.clampedMarks,
      confidence: grade.confidence,
    };
  }

  const wasAccepted = result.accepted;
  const { data: updated, error: updateErr } = await supabase
    .from("ai_grade_results")
    .update({
      ...updateFields,
      ...(wasAccepted ? { accepted: false, accepted_at: null, accepted_by: null } : {}),
    })
    .eq("id", resultId)
    .select(
      "id, run_id, test_item_id, suggested_marks, max_marks, confidence, markscheme_source, work_found, reasoning, evidence, evidence_image_path, mark_breakdown, accepted, accepted_at, accepted_by"
    )
    .single();

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  // Refresh the run's coverage summary (suggestedTotal, needsReview) so the
  // roster and run header reflect the correction immediately, and when the
  // mark moved, flag the later parts of this question: they were marked, and
  // possibly accepted, against the old reading of this part, and nothing
  // else revisits them. Part counts and mark-scheme warnings are unaffected.
  if (!runRowsErr && runRows) {
    const unitById = new Map(units.map((u) => [u.testItemId, u]));
    const current = runRows.map((r) =>
      r.test_item_id === result.test_item_id
        ? { ...r, suggested_marks: updateFields.suggested_marks, confidence: updateFields.confidence, work_found: updateFields.work_found }
        : r
    );
    const suggestedTotal = current.reduce((s, r) => s + r.suggested_marks, 0);
    const needsReview = current
      .filter((r) => gradeNeedsReview({ confidence: r.confidence as "high" | "medium" | "low", item: { workFound: r.work_found } }))
      .map((r) => {
        const u = unitById.get(r.test_item_id);
        return u ? unitLabel(u) : r.test_item_id;
      });

    const existingCoverage = (run.coverage ?? {}) as Record<string, unknown>;
    const existingWarnings = Array.isArray(existingCoverage.warnings)
      ? (existingCoverage.warnings as string[])
      : [];
    let warnings = existingWarnings;
    if (updateFields.suggested_marks !== result.suggested_marks) {
      const fresh = followThroughWarnings(
        units,
        [{ testItemId: unit.testItemId, from: result.suggested_marks, to: updateFields.suggested_marks }],
        (id) => {
          const r = rowByItem.get(id);
          return r ? (r.accepted ? "accepted" : "marked") : null;
        }
      );
      // A second correction of the same part replaces what the first said.
      const earlierLabel = unitLabel(unit);
      warnings = [...existingWarnings.filter((w) => !isFollowThroughWarningAbout(w, earlierLabel)), ...fresh];
    }
    await supabase
      .from("ai_grade_runs")
      .update({ coverage: { ...existingCoverage, suggestedTotal, needsReview, warnings } })
      .eq("id", run.id);
  }

  return NextResponse.json({ result: updated });
}
