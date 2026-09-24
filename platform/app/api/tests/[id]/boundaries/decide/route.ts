import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { loadBoundaryPageData } from "@/lib/boundary-data";
import { distributionSnapshot } from "@/lib/boundary-scores";
import {
  CUTOFF_GRADES,
  boundariesFromCutoffs,
  sameCutoffs,
  validateCutoffs,
  type CutoffGrade,
  type Cutoffs,
} from "@/lib/grade-bands";

/**
 * POST /api/tests/[id]/boundaries/decide
 * Body: {
 *   mode: "adopt" | "keep",
 *   cutoffs?: { "7": n, "6": n, ..., "2": n }   (adopt only; minimum marks)
 *   statement: string,                           (why -- required, shown to the teacher)
 *   startedFrom?: { kind: "suggestion" | "preset" | "current" | "manual", id?: string },
 *   expectedDecisionId: string | null            (the newest decision the page showed)
 * }
 *
 * Records the teacher's decision on this assessment's grade boundaries. The
 * source ("ai_suggestion", "preset", "teacher", "kept") is worked out here,
 * never taken from the client: a suggestion counts as adopted only if the
 * lines are exactly the suggestion's. The write itself is one transaction in
 * decide_test_boundaries(), which also marks the PowerSchool files stale when
 * the lines moved.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { id: testId } = await params;

  let body: {
    mode?: unknown;
    cutoffs?: unknown;
    statement?: unknown;
    startedFrom?: { kind?: unknown; id?: unknown } | null;
    expectedDecisionId?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const mode = body.mode === "adopt" || body.mode === "keep" ? body.mode : null;
  if (!mode) return NextResponse.json({ error: "mode must be adopt or keep" }, { status: 400 });
  const statement = typeof body.statement === "string" ? body.statement.trim() : "";
  if (!statement) return NextResponse.json({ error: "Say why: a decision needs a statement" }, { status: 400 });
  if (statement.length > 4000) {
    return NextResponse.json({ error: "The statement must be 4000 characters or fewer" }, { status: 400 });
  }
  const expectedDecisionId =
    typeof body.expectedDecisionId === "string" && body.expectedDecisionId ? body.expectedDecisionId : null;
  const startedKind = typeof body.startedFrom?.kind === "string" ? body.startedFrom.kind : "manual";
  const startedId = typeof body.startedFrom?.id === "string" ? body.startedFrom.id : null;

  const load = await loadBoundaryPageData(supabase, testId);
  if (!load.ok) return NextResponse.json({ error: load.error }, { status: load.status });
  const data = load.data;
  const total = data.test.totalMarks;
  if (data.test.isActivity) {
    return NextResponse.json({ error: "Activities are reported by learning target, not 1-7 levels" }, { status: 409 });
  }
  if (!total) return NextResponse.json({ error: "Set the total marks on this assessment first" }, { status: 409 });

  let cutoffs: Cutoffs;
  let source: "preset" | "ai_suggestion" | "teacher" | "kept";
  let suggestionId: string | null = null;
  let originSetId: string | null = null;
  let bands: { grade: number; min_proportion: number }[] | null = null;

  if (mode === "keep") {
    if (!data.current.cutoffs || !data.current.boundaries) {
      return NextResponse.json({ error: "This assessment has no boundaries to keep yet" }, { status: 409 });
    }
    cutoffs = data.current.cutoffs;
    source = "kept";
  } else {
    const raw = (body.cutoffs ?? {}) as Record<string, unknown>;
    const candidate = Object.fromEntries(CUTOFF_GRADES.map((g) => [g, raw[String(g)]])) as Partial<Record<CutoffGrade, unknown>>;
    const problems = validateCutoffs(candidate, total);
    if (problems.length > 0) return NextResponse.json({ error: problems.join(" ") }, { status: 400 });
    cutoffs = candidate as Cutoffs;

    const startedPreset = startedKind === "preset" ? data.presets.find((p) => p.id === startedId) ?? null : null;
    const originPreset = data.current.preset ? data.presets.find((p) => p.id === data.current.preset?.id) ?? null : null;

    if (startedKind === "suggestion" && startedId) {
      const { data: suggestion } = await supabase
        .from("boundary_suggestions")
        .select("id, output")
        .eq("id", startedId)
        .eq("test_id", testId)
        .maybeSingle();
      if (!suggestion) return NextResponse.json({ error: "That suggestion is not for this assessment" }, { status: 400 });
      suggestionId = suggestion.id as string;
      const c = (suggestion.output as { cutoffs?: Record<string, number> } | null)?.cutoffs;
      const suggested = c
        ? ({ 7: c.grade7, 6: c.grade6, 5: c.grade5, 4: c.grade4, 3: c.grade3, 2: c.grade2 } as Cutoffs)
        : null;
      source = sameCutoffs(suggested, cutoffs) ? "ai_suggestion" : "teacher";
    } else if (startedPreset) {
      originSetId = startedPreset.id;
      source = sameCutoffs(startedPreset.cutoffs, cutoffs) ? "preset" : "teacher";
    } else {
      source = "teacher";
    }

    // Keep an existing proportion wherever it lands on the same mark, so an
    // unmoved preset line stays the preset's value (lib/grade-bands.ts).
    bands = boundariesFromCutoffs(cutoffs, total, [
      data.current.boundaries,
      startedPreset?.boundaries,
      originPreset?.boundaries,
    ]);
  }

  // What the decision row shows later: the marks at this total, and the
  // proportion behind each (for keep, the lines already in force).
  const recordBands = bands ?? data.current.boundaries ?? [];
  const cutoffRecord = CUTOFF_GRADES.map((g) => ({
    grade: g,
    min_marks: cutoffs[g],
    min_proportion: recordBands.find((b) => b.grade === g)?.min_proportion ?? null,
  }));

  const { data: decisionId, error } = await supabase.rpc("decide_test_boundaries", {
    p_test_id: testId,
    p_mode: mode,
    p_bands: bands,
    p_cutoffs: cutoffRecord,
    p_source: source,
    p_statement: statement,
    p_suggestion_id: suggestionId,
    p_origin_set_id: originSetId,
    p_distribution: distributionSnapshot(data.scores, total, cutoffs),
    p_expected_decision_id: expectedDecisionId,
  });
  if (error) {
    if (error.code === "PT409") return NextResponse.json({ error: error.message }, { status: 409 });
    if (/Unauthorized/.test(error.message)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ decisionId, source });
}
