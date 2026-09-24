import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getApiTeacher } from "@/lib/auth";
import { recordUsage } from "@/lib/ai-usage";
import { loadBoundaryPageData } from "@/lib/boundary-data";
import { levelCounts, scoreSummary } from "@/lib/boundary-scores";
import { CUTOFF_GRADES, type CutoffGrade, type Cutoffs } from "@/lib/grade-bands";
import {
  BOUNDARY_SUGGESTION_MODEL,
  BoundarySuggestionSchema,
  anonymiseScores,
  buildBoundarySystemPrompt,
  buildBoundaryUserPrompt,
  checkSuggestion,
  orderGuidance,
  type BoundarySuggestion,
  type SuggestionInput,
} from "@/lib/boundary-suggestion";

// Opus 5 at high effort with adaptive thinking can run past two minutes on a
// full class; the standards import allows 180s for a smaller job.
export const runtime = "nodejs";
export const maxDuration = 300;

const SOURCE_WORDS: Record<string, string> = {
  preset: "started from a preset",
  ai_suggestion: "adopted an AI suggestion",
  teacher: "set by the teacher",
  kept: "kept the lines in force",
};

/**
 * POST /api/tests/[id]/boundaries/suggest
 *
 * Asks the model for this assessment's grade boundaries (lib/boundary-suggestion.ts)
 * from every student's current total -- Clev's Marks where accepted, the
 * marker's suggestions otherwise -- and the teacher's guidance. Stores the
 * suggestion and returns it. Changes no level: only a decision does.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;
  const { id: testId } = await params;

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not configured on this deployment" }, { status: 500 });
  }

  const load = await loadBoundaryPageData(supabase, testId);
  if (!load.ok) return NextResponse.json({ error: load.error }, { status: load.status });
  const data = load.data;
  const total = data.test.totalMarks;
  if (data.test.isActivity) {
    return NextResponse.json({ error: "Activities are reported by learning target, not 1-7 levels" }, { status: 409 });
  }
  if (!total) {
    return NextResponse.json({ error: "Set the total marks on this assessment first" }, { status: 409 });
  }
  const summary = scoreSummary(data.scores);
  if (summary.scored === 0) {
    return NextResponse.json({ error: "Nobody has a mark on this assessment yet" }, { status: 409 });
  }

  const guidance = orderGuidance(data.guidance);
  const latestDecision = data.decisions[0] ?? null;
  const input: SuggestionInput = {
    assessment: {
      name: data.test.name,
      course: data.test.courseName ?? "unknown course",
      kind: data.test.kind,
      totalMarks: total,
      standardsPaper: data.test.isStandards,
      sections: data.sections,
    },
    current: {
      label:
        data.current.kind === "none"
          ? "No boundaries"
          : data.current.kind === "preset"
          ? `The shared ${data.current.label} preset (not decided for this assessment yet)`
          : `This assessment's ${data.current.label}`,
      cutoffs: data.current.cutoffs,
      decided: latestDecision
        ? {
            at: latestDecision.decidedAt.slice(0, 10),
            source: SOURCE_WORDS[latestDecision.source] ?? latestDecision.source,
            statement: latestDecision.statement,
          }
        : null,
    },
    presets: data.presets
      .filter((p) => p.cutoffs !== null)
      .map((p) => ({ name: p.name, description: p.description, cutoffs: p.cutoffs! })),
    otherAssessments: data.otherAssessments
      .filter((o) => o.boundaries && o.boundaries.length > 0)
      .map((o) => ({
        name: o.name,
        totalMarks: o.totalMarks,
        decided: o.decided,
        percentLines: Object.fromEntries(
          CUTOFF_GRADES.map((g) => {
            const p = o.boundaries?.find((b) => b.grade === g)?.min_proportion ?? 0;
            return [g, Math.round(Number(p) * 1000) / 10];
          })
        ) as Record<CutoffGrade, number>,
      })),
    scores: { summary, students: anonymiseScores(data.scores) },
    guidance,
  };

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const system = buildBoundarySystemPrompt();
  const userPrompt = buildBoundaryUserPrompt(input);
  const guidanceIds = guidance.map((g) => g.id);

  let accepted: { out: BoundarySuggestion; cutoffs: Cutoffs } | null = null;
  let lastError = "The model returned an empty response";
  for (let attempt = 1; attempt <= 2 && !accepted; attempt++) {
    try {
      const message = await anthropic.messages.parse({
        model: BOUNDARY_SUGGESTION_MODEL,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        output_config: { effort: "high", format: zodOutputFormat(BoundarySuggestionSchema) },
        // The policy and fixed rules are byte-identical on every call, so the
        // system block caches; the class's data is in the user turn.
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userPrompt }],
      });
      await recordUsage(supabase, {
        pipeline: "boundary_suggest",
        model: BOUNDARY_SUGGESTION_MODEL,
        usage: message.usage,
        ref: { type: "test", id: testId },
      });
      if (message.stop_reason === "max_tokens") {
        lastError = "The model's answer was cut off; try again";
        continue;
      }
      if (message.stop_reason === "refusal") {
        lastError = "The model declined this request";
        break;
      }
      if (!message.parsed_output) {
        lastError = "The model returned no structured answer";
        continue;
      }
      const out = BoundarySuggestionSchema.parse(message.parsed_output);
      const check = checkSuggestion(out, total, guidanceIds);
      if (check.ok) {
        accepted = { out, cutoffs: check.cutoffs };
      } else {
        lastError = `The suggestion did not hold together: ${check.problems.join(" ")}`;
      }
    } catch (e) {
      return NextResponse.json(
        { error: `Suggestion request failed: ${e instanceof Error ? e.message : String(e)}` },
        { status: 500 }
      );
    }
  }
  if (!accepted) return NextResponse.json({ error: lastError }, { status: 502 });

  const cutoffs = accepted.cutoffs;
  const { data: row, error: insertError } = await supabase
    .from("boundary_suggestions")
    .insert({
      test_id: testId,
      model: BOUNDARY_SUGGESTION_MODEL,
      total_marks: total,
      guidance,
      input,
      output: accepted.out,
      created_by: user.id,
    })
    .select("id, created_at")
    .single();
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  return NextResponse.json({
    suggestion: {
      id: row.id,
      createdAt: row.created_at,
      model: BOUNDARY_SUGGESTION_MODEL,
      totalMarks: total,
      output: accepted.out,
      cutoffs,
    },
    levels: {
      all: levelCounts(data.scores, total, cutoffs, "all").counts,
      complete: levelCounts(data.scores, total, cutoffs, "complete").counts,
    },
  });
}
