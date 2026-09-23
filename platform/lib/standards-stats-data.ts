import type { SupabaseClient } from "@supabase/supabase-js";
import { loadReportRoster } from "./report-roster";
import { parseStandardsRubric, type RubricItem, type StandardsRubric } from "./standards-rubric";
import {
  buildStandardsStats,
  statsHighlights,
  type StandardsStats,
  type StatsHighlights,
  type StatsSubject,
} from "./standards-stats";

/**
 * The class statistics for one paper, at a chosen scope. Works for any test
 * with items -- a standards rubric adds the strand/level breakdown but is
 * not required (see the "not required" note below).
 *
 * Shared by the stats page and its CSV route so the two cannot disagree,
 * exactly as lib/standards-report-data.ts is shared by the report and its
 * CSV. The roster and the accepted marks come from lib/report-roster.ts --
 * the AI grader's rule -- with one addition the per-student report does not
 * make: `includeMarkedOutsideRoster`, so a paper marked for a student from a
 * class the test's track does not reach still counts here. The general
 * ("All classes") scope exists for exactly those students, and a marked
 * paper missing from the averages would be worse than a stranger's name on a
 * list.
 *
 * SCOPE is one of:
 *   "all"       every class that sat the paper -- the general view
 *   <courseId>  one class, which is how the teacher reads a single class on its own
 *   "unknown"   marked students whose class could not be resolved at all
 *
 * Absentees are dropped before any arithmetic: they did not sit it, so they
 * are neither a zero nor a thin n.
 */

/** The general scope's key in a URL, and in the scope option list. */
export const ALL_CLASSES_SCOPE = "all";
/**
 * Generic on purpose: this page and its scope switcher are not restricted to
 * Standard Level papers (see the "Deliberately not done" note in
 * platform/docs/HANDOFF.md #25), so a label naming that track would be wrong
 * on an Extended or formative paper that reaches the same code path.
 */
export const ALL_CLASSES_LABEL = "All classes";
/** A marked student with no resolvable class. Rare, and never silently dropped. */
export const UNKNOWN_CLASS_SCOPE = "unknown";

export interface StatsScopeOption {
  /** "all", "unknown", or a course id. */
  key: string;
  label: string;
  /** Students on the roster at this scope, absentees included. */
  students: number;
  /** How many of them have at least one accepted mark. */
  marked: number;
}

export interface StandardsStatsData {
  test: { id: string; name: string; courseId: string | null; testDate: string | null };
  rubric: StandardsRubric | null;
  items: RubricItem[];
  stats: StandardsStats;
  highlights: StatsHighlights;
  scope: StatsScopeOption;
  /** "All classes" first, then one per class with students on the roster. */
  scopeOptions: StatsScopeOption[];
  /** Counted at the chosen scope. */
  roster: { total: number; absent: number; marked: number; complete: number };
}

export type StandardsStatsLoad =
  | { ok: true; data: StandardsStatsData }
  | { ok: false; status: 404 | 400 | 500; error: string };

export async function loadStandardsStatsData(
  supabase: SupabaseClient,
  testId: string,
  options: { showHidden: boolean; scope?: string | null }
): Promise<StandardsStatsLoad> {
  const { data: test, error: testError } = await supabase
    .from("tests")
    .select("id, name, course_id, test_date, standards_rubric")
    .eq("id", testId)
    .maybeSingle();
  if (testError) return { ok: false, status: 500, error: testError.message };
  if (!test) return { ok: false, status: 404, error: "Test not found" };

  const parsed = parseStandardsRubric(test.standards_rubric);
  if (!parsed.ok) {
    return { ok: false, status: 400, error: `This test's standards rubric is not valid: ${parsed.error}` };
  }
  // A rubric is not required here: without one there are no strands and no
  // levels, but the question and part averages -- the point of this page --
  // are just as true. The page says so rather than refusing.
  const rubric = parsed.rubric;

  const { data: itemRows, error: itemsError } = await supabase
    .from("test_items")
    .select("id, question_number, part_label, max_marks")
    .eq("test_id", testId)
    .order("sort_order", { ascending: true });
  if (itemsError) return { ok: false, status: 500, error: itemsError.message };
  const items = (itemRows ?? []) as RubricItem[];

  const courseId = (test.course_id as string | null) ?? null;
  const roster = await loadReportRoster(supabase, {
    testId,
    courseId,
    itemIds: items.map((i) => i.id),
    showHidden: options.showHidden,
    includeMarkedOutsideRoster: true,
  });
  if (!roster.ok) return roster;

  // ---- Scopes -------------------------------------------------------------
  // One option per class present on the roster, in the roster's own order
  // (the test's own class first), behind the general one.
  const perClass: StatsScopeOption[] = [];
  for (const s of roster.data.subjects) {
    const key = s.courseId || UNKNOWN_CLASS_SCOPE;
    let option = perClass.find((o) => o.key === key);
    if (!option) {
      option = { key, label: s.className || "Other", students: 0, marked: 0 };
      perClass.push(option);
    }
    option.students += 1;
    if (s.marks.size > 0) option.marked += 1;
  }

  const allOption: StatsScopeOption = {
    key: ALL_CLASSES_SCOPE,
    label: ALL_CLASSES_LABEL,
    students: roster.data.subjects.length,
    marked: roster.data.subjects.filter((s) => s.marks.size > 0).length,
  };
  const scopeOptions = [allOption, ...perClass];

  // An unknown scope falls back to the general one rather than 404ing: the
  // key is a course id in a URL a teacher may have bookmarked before a class
  // was renamed or removed.
  const requested = options.scope ?? courseId ?? ALL_CLASSES_SCOPE;
  const scope = scopeOptions.find((o) => o.key === requested) ?? allOption;

  // ---- The marks that count ------------------------------------------------
  const inScope = roster.data.subjects.filter(
    (s) => scope.key === ALL_CLASSES_SCOPE || (s.courseId || UNKNOWN_CLASS_SCOPE) === scope.key
  );
  const present = inScope.filter((s) => !s.absent);
  const subjects: StatsSubject[] = present.map((s) => ({
    subjectId: s.subjectId,
    name: s.name,
    className: s.className,
    marks: s.marks,
  }));

  const stats = buildStandardsStats({ items, rubric, subjects });

  return {
    ok: true,
    data: {
      test: {
        id: test.id as string,
        name: test.name as string,
        courseId,
        testDate: (test.test_date as string | null) ?? null,
      },
      rubric,
      items,
      stats,
      highlights: statsHighlights(stats),
      scope,
      scopeOptions,
      roster: {
        total: inScope.length,
        absent: inScope.filter((s) => s.absent).length,
        marked: stats.paper.attempted,
        complete: stats.paper.n,
      },
    },
  };
}
