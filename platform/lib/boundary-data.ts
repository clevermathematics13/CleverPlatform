import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cutoffsFromBoundaries,
  sameCutoffs,
  type Cutoffs,
  type GradeBoundary,
} from "./grade-bands";
import { mergeSubjectScores, type ScoreItem, type SubjectScore } from "./boundary-scores";
import { paperSections, type PaperSection } from "./test-sections";
import { parseStandardsRubric } from "./standards-rubric";
import { paperQuestionPrefixes } from "./paper-labels";
import { loadReportRoster } from "./report-roster";
import { fetchAllRows } from "./na-scanning";
import { latestRunPerSubject } from "./ai-grade-review";
import { formatGradingSubject } from "./grading-subject";
import { loadTrackLinks, trackFamilyCourseIds } from "./track-courses";
import { BoundarySuggestionSchema, suggestionCutoffs, type BoundarySuggestion } from "./boundary-suggestion";

/**
 * Everything the grade-boundaries page, the AI suggestion and a decision need
 * about one assessment, loaded once so the three never disagree.
 *
 * The roster and accepted marks are lib/report-roster.ts's (hidden students
 * left out, whatever the teacher's view preference, so a decision's snapshot
 * always means the same thing); the suggested marks are each student's newest
 * complete run (lib/ai-grade-review.ts latestRunPerSubject), paged past
 * PostgREST's silent 1000-row cap.
 */

export type BoundaryKind = "own" | "preset" | "none";

export interface CurrentBoundaries {
  kind: BoundaryKind;
  setId: string | null;
  /** "Grade 9", "own copy of Grade 9", "own boundaries" or "none". */
  label: string;
  /** The preset in force (kind "preset") or the one an own set descends from. */
  preset: { id: string; name: string } | null;
  boundaries: GradeBoundary[] | null;
  cutoffs: Cutoffs | null;
}

export interface DecisionRow {
  id: string;
  decidedAt: string;
  decidedBy: string | null;
  source: "preset" | "ai_suggestion" | "teacher" | "kept";
  statement: string;
  totalMarks: number | null;
  cutoffs: Cutoffs | null;
  suggestionId: string | null;
}

export interface SuggestionRow {
  id: string;
  createdAt: string;
  model: string;
  totalMarks: number;
  output: BoundarySuggestion;
  cutoffs: Cutoffs;
}

export interface PresetRow {
  id: string;
  name: string;
  description: string | null;
  boundaries: GradeBoundary[];
  cutoffs: Cutoffs | null;
}

export interface GuidanceRow {
  id: string;
  scope: "all" | "test";
  note: string;
  createdAt: string;
}

export interface OtherAssessment {
  id: string;
  name: string;
  totalMarks: number;
  boundaries: GradeBoundary[] | null;
  decided: boolean;
}

export interface BoundaryPageData {
  test: {
    id: string;
    name: string;
    courseId: string | null;
    courseName: string | null;
    totalMarks: number | null;
    kind: string;
    testDate: string | null;
    isActivity: boolean;
    isStandards: boolean;
  };
  items: ScoreItem[];
  sections: PaperSection[];
  scores: SubjectScore[];
  current: CurrentBoundaries;
  decisions: DecisionRow[];
  latestSuggestion: SuggestionRow | null;
  presets: PresetRow[];
  guidance: GuidanceRow[];
  otherAssessments: OtherAssessment[];
}

export type BoundaryPageLoad =
  | { ok: true; data: BoundaryPageData }
  | { ok: false; status: 404 | 500; error: string };

type BandRow = { set_id: string; grade: number; min_proportion: number | string };

async function loadBands(supabase: SupabaseClient, setIds: string[]): Promise<Map<string, GradeBoundary[]>> {
  const out = new Map<string, GradeBoundary[]>();
  const ids = [...new Set(setIds.filter(Boolean))];
  if (ids.length === 0) return out;
  const { data, error } = await supabase
    .from("grade_boundaries")
    .select("set_id, grade, min_proportion")
    .in("set_id", ids)
    .order("grade", { ascending: true });
  if (error) throw new Error(`Could not load grade boundaries: ${error.message}`);
  for (const b of (data ?? []) as BandRow[]) {
    const list = out.get(b.set_id) ?? [];
    list.push({ grade: b.grade, min_proportion: Number(b.min_proportion) });
    out.set(b.set_id, list);
  }
  return out;
}

/** "4.4(b)" on a creator paper, "Q7(a)" elsewhere: the label the teacher knows a part by. */
function partLabel(prefix: string | undefined, questionNumber: number, part: string | null): string {
  const letter = part ? `(${part})` : "";
  return prefix ? `${prefix}${letter}` : `Q${questionNumber}${letter}`;
}

export async function loadBoundaryPageData(supabase: SupabaseClient, testId: string): Promise<BoundaryPageLoad> {
  try {
    return await load(supabase, testId);
  } catch (e) {
    return { ok: false, status: 500, error: e instanceof Error ? e.message : String(e) };
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load(supabase: SupabaseClient, testId: string): Promise<BoundaryPageLoad> {
  // The id goes into a PostgREST or() filter below, so it has to be exactly a uuid.
  if (!UUID_RE.test(testId)) return { ok: false, status: 404, error: "Test not found" };
  const { data: test, error: testError } = await supabase
    .from("tests")
    .select(
      "id, name, course_id, total_marks, assessment_kind, test_date, boundary_set_id, custom_content, standards_rubric, activity_rubric"
    )
    .eq("id", testId)
    .maybeSingle();
  if (testError) return { ok: false, status: 500, error: testError.message };
  if (!test) return { ok: false, status: 404, error: "Test not found" };

  const courseId = (test.course_id as string | null) ?? null;
  const totalMarks = typeof test.total_marks === "number" && test.total_marks > 0 ? test.total_marks : null;
  const parsedRubric = parseStandardsRubric(test.standards_rubric);
  const rubric = parsedRubric.ok ? parsedRubric.rubric : null;

  const [courseRes, itemsRes] = await Promise.all([
    courseId ? supabase.from("courses").select("name").eq("id", courseId).maybeSingle() : Promise.resolve({ data: null }),
    supabase
      .from("test_items")
      .select("id, question_number, part_label, max_marks, sort_order")
      .eq("test_id", testId)
      .order("sort_order", { ascending: true }),
  ]);
  if ("error" in itemsRes && itemsRes.error) return { ok: false, status: 500, error: itemsRes.error.message };
  const rawItems = (itemsRes.data ?? []) as {
    id: string;
    question_number: number;
    part_label: string | null;
    max_marks: number;
    sort_order: number;
  }[];

  const { sections, sectionIndexByItemId } = paperSections({
    customContent: test.custom_content,
    standardsRubric: rubric,
    items: rawItems,
  });
  const prefixes = paperQuestionPrefixes(test.custom_content);
  const items: ScoreItem[] = rawItems.map((it) => ({
    id: it.id,
    maxMarks: it.max_marks,
    sectionIndex: sectionIndexByItemId.get(it.id) ?? 0,
    label: partLabel(prefixes.get(it.sort_order), it.question_number, it.part_label),
  }));

  // ---- Who, and their accepted marks ----------------------------------------
  const roster = await loadReportRoster(supabase, {
    testId,
    courseId,
    itemIds: items.map((i) => i.id),
    showHidden: false,
    includeMarkedOutsideRoster: true,
  });
  if (!roster.ok) return { ok: false, status: 500, error: roster.error };

  // ---- Their newest complete run's suggestions --------------------------------
  const runs = await fetchAllRows<{ id: string; student_id: string | null; invited_student_id: string | null; created_at: string }>(
    (from, to) =>
      supabase
        .from("ai_grade_runs")
        .select("id, student_id, invited_student_id, created_at")
        .eq("test_id", testId)
        .eq("status", "complete")
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to)
  );
  const latest = latestRunPerSubject(runs);
  const runSubject = new Map<string, string>();
  for (const run of latest) {
    const subject = formatGradingSubject(run);
    if (subject) runSubject.set(run.id, subject);
  }
  const suggestedBySubject = new Map<string, Map<string, number>>();
  const runIds = [...runSubject.keys()];
  if (runIds.length > 0) {
    const results = await fetchAllRows<{ id: string; run_id: string; test_item_id: string; suggested_marks: number }>((from, to) =>
      supabase
        .from("ai_grade_results")
        .select("id, run_id, test_item_id, suggested_marks")
        .in("run_id", runIds)
        .order("id", { ascending: true })
        .range(from, to)
    );
    for (const r of results) {
      const subject = runSubject.get(r.run_id);
      if (!subject) continue;
      let map = suggestedBySubject.get(subject);
      if (!map) {
        map = new Map();
        suggestedBySubject.set(subject, map);
      }
      map.set(r.test_item_id, r.suggested_marks);
    }
  }

  const scores = mergeSubjectScores(
    items,
    sections.length,
    roster.data.subjects.map((s) => ({
      subjectId: s.subjectId,
      name: s.name,
      className: s.className,
      absent: s.absent,
      accepted: s.marks,
      suggested: suggestedBySubject.get(s.subjectId) ?? null,
    }))
  );

  // ---- Boundaries: in force, presets, history, suggestion, guidance -----------
  const [presetRes, decisionsRes, suggestionRes, guidanceRes] = await Promise.all([
    supabase.from("grade_boundary_sets").select("id, name, description").is("test_id", null).order("name"),
    supabase
      .from("test_boundary_decisions")
      .select("id, decided_at, decided_by, source, statement, total_marks, boundaries, suggestion_id")
      .eq("test_id", testId)
      .order("decided_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(50),
    supabase
      .from("boundary_suggestions")
      .select("id, created_at, model, total_marks, output")
      .eq("test_id", testId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("boundary_guidance")
      .select("id, test_id, note, created_at")
      .is("archived_at", null)
      .or(`test_id.eq.${testId},test_id.is.null`)
      .order("created_at", { ascending: true }),
  ]);
  if (presetRes.error) return { ok: false, status: 500, error: presetRes.error.message };
  if (decisionsRes.error) return { ok: false, status: 500, error: decisionsRes.error.message };
  if (suggestionRes.error) return { ok: false, status: 500, error: suggestionRes.error.message };
  if (guidanceRes.error) return { ok: false, status: 500, error: guidanceRes.error.message };

  const setId = (test.boundary_set_id as string | null) ?? null;
  let currentSet: { id: string; name: string; test_id: string | null; origin_set_id: string | null } | null = null;
  if (setId) {
    const { data, error } = await supabase
      .from("grade_boundary_sets")
      .select("id, name, test_id, origin_set_id")
      .eq("id", setId)
      .maybeSingle();
    if (error) return { ok: false, status: 500, error: error.message };
    currentSet = data;
  }

  const presetRows = (presetRes.data ?? []) as { id: string; name: string; description: string | null }[];
  const bands = await loadBands(supabase, [...presetRows.map((p) => p.id), setId ?? ""]);
  const total = totalMarks ?? 0;
  const presets: PresetRow[] = presetRows.map((p) => {
    const b = bands.get(p.id) ?? [];
    return { id: p.id, name: p.name, description: p.description, boundaries: b, cutoffs: cutoffsFromBoundaries(b, total) };
  });

  const currentBoundaries = setId ? bands.get(setId) ?? null : null;
  const currentCutoffs = cutoffsFromBoundaries(currentBoundaries, total);
  let current: CurrentBoundaries;
  if (!currentSet) {
    current = { kind: "none", setId: null, label: "none", preset: null, boundaries: null, cutoffs: null };
  } else if (currentSet.test_id === null) {
    current = {
      kind: "preset",
      setId: currentSet.id,
      label: currentSet.name,
      preset: { id: currentSet.id, name: currentSet.name },
      boundaries: currentBoundaries,
      cutoffs: currentCutoffs,
    };
  } else {
    const origin = presets.find((p) => p.id === currentSet?.origin_set_id) ?? null;
    const unchanged = !!origin && sameCutoffs(origin.cutoffs, currentCutoffs);
    current = {
      kind: "own",
      setId: currentSet.id,
      label: unchanged && origin ? `own copy of ${origin.name}` : "own boundaries",
      preset: origin ? { id: origin.id, name: origin.name } : null,
      boundaries: currentBoundaries,
      cutoffs: currentCutoffs,
    };
  }

  // Who decided: one query for the names.
  const decisionRaw = (decisionsRes.data ?? []) as {
    id: string;
    decided_at: string;
    decided_by: string | null;
    source: DecisionRow["source"];
    statement: string;
    total_marks: number | null;
    boundaries: { cutoffs?: { grade: number; min_marks: number }[]; bands?: Record<string, number> } | null;
    suggestion_id: string | null;
  }[];
  const deciderIds = [...new Set(decisionRaw.map((d) => d.decided_by).filter((x): x is string => !!x))];
  const deciderNames = new Map<string, string>();
  if (deciderIds.length > 0) {
    const { data } = await supabase.from("profiles").select("id, display_name").in("id", deciderIds);
    for (const p of data ?? []) deciderNames.set(p.id as string, (p.display_name as string | null) ?? "a teacher");
  }
  const decisions: DecisionRow[] = decisionRaw.map((d) => {
    let cutoffs: Cutoffs | null = null;
    const stored = d.boundaries?.cutoffs;
    if (Array.isArray(stored) && stored.length === 6) {
      cutoffs = Object.fromEntries(stored.map((c) => [c.grade, c.min_marks])) as unknown as Cutoffs;
    } else if (d.boundaries?.bands && d.total_marks) {
      const asBoundaries = Object.entries(d.boundaries.bands).map(([g, p]) => ({ grade: Number(g), min_proportion: Number(p) }));
      cutoffs = cutoffsFromBoundaries(asBoundaries, d.total_marks);
    }
    return {
      id: d.id,
      decidedAt: d.decided_at,
      decidedBy: d.decided_by ? deciderNames.get(d.decided_by) ?? null : null,
      source: d.source,
      statement: d.statement,
      totalMarks: d.total_marks,
      cutoffs,
      suggestionId: d.suggestion_id,
    };
  });

  let latestSuggestion: SuggestionRow | null = null;
  if (suggestionRes.data) {
    const parsed = BoundarySuggestionSchema.safeParse(suggestionRes.data.output);
    if (parsed.success) {
      latestSuggestion = {
        id: suggestionRes.data.id as string,
        createdAt: suggestionRes.data.created_at as string,
        model: suggestionRes.data.model as string,
        totalMarks: suggestionRes.data.total_marks as number,
        output: parsed.data,
        cutoffs: suggestionCutoffs(parsed.data),
      };
    }
  }

  const guidance: GuidanceRow[] = ((guidanceRes.data ?? []) as { id: string; test_id: string | null; note: string; created_at: string }[]).map(
    (g) => ({ id: g.id, scope: g.test_id ? "test" : "all", note: g.note, createdAt: g.created_at })
  );

  // ---- The rest of the course, for consistency -----------------------------------
  let otherAssessments: OtherAssessment[] = [];
  if (courseId) {
    const familyIds = trackFamilyCourseIds(courseId, await loadTrackLinks(supabase, courseId));
    const { data: others, error: othersError } = await supabase
      .from("tests")
      .select("id, name, total_marks, boundary_set_id, activity_rubric")
      .in("course_id", familyIds)
      .neq("id", testId)
      .order("test_date", { ascending: true });
    if (othersError) return { ok: false, status: 500, error: othersError.message };
    const usable = (others ?? []).filter(
      (o) => o.activity_rubric === null && typeof o.total_marks === "number" && o.total_marks > 0
    ) as { id: string; name: string; total_marks: number; boundary_set_id: string | null }[];
    const otherBands = await loadBands(supabase, usable.map((o) => o.boundary_set_id ?? ""));
    const decidedIds = new Set<string>();
    if (usable.length > 0) {
      const decided = await fetchAllRows<{ id: string; test_id: string }>((from, to) =>
        supabase
          .from("test_boundary_decisions")
          .select("id, test_id")
          .in("test_id", usable.map((o) => o.id))
          .order("id", { ascending: true })
          .range(from, to)
      );
      for (const d of decided) decidedIds.add(d.test_id);
    }
    otherAssessments = usable.map((o) => ({
      id: o.id,
      name: o.name,
      totalMarks: o.total_marks,
      boundaries: o.boundary_set_id ? otherBands.get(o.boundary_set_id) ?? null : null,
      decided: decidedIds.has(o.id),
    }));
  }

  return {
    ok: true,
    data: {
      test: {
        id: test.id as string,
        name: test.name as string,
        courseId,
        courseName: ((courseRes as { data: { name?: string } | null }).data?.name as string | undefined) ?? null,
        totalMarks,
        kind: (test.assessment_kind as string | null) ?? "formative",
        testDate: (test.test_date as string | null) ?? null,
        isActivity: test.activity_rubric !== null,
        isStandards: rubric !== null,
      },
      items,
      sections,
      scores,
      current,
      decisions,
      latestSuggestion,
      presets,
      guidance,
      otherAssessments,
    },
  };
}
