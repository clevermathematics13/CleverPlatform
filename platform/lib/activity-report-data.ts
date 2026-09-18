import type { SupabaseClient } from "@supabase/supabase-js";
import { loadReportRoster } from "./report-roster";
import {
  buildActivityReport,
  parseActivityRubric,
  tallyTargets,
  type ActivityReport,
  type ActivityRubric,
  type RubricItem,
  type StudentActivityRow,
  type TargetTally,
} from "./activity-rubric";

/**
 * The class's learning targets for one Exploration or homework, from Clev's
 * Marks.
 *
 * Shared by the activity report page and its CSV route so the two cannot
 * disagree about who is on the roster or which marks count. The roster and
 * the marks come from lib/report-roster.ts, the same function the Standard
 * Level report uses -- see that file for the rule, which is the AI grader's.
 *
 * The one thing this carries that the Standard Level report does not is the
 * TALLY: how many students sit at each outcome for each target. That is the
 * teaching signal the whole route exists for -- "eleven of seventeen are Not
 * yet on LT2" is what changes tomorrow's lesson, and no per-student column
 * says it.
 */

export interface ActivityReportRow {
  subjectId: string;
  name: string;
  className: string | null;
  absent: boolean;
  report: ActivityReport;
}

export interface ActivityReportData {
  test: { id: string; name: string; courseId: string | null; testDate: string | null };
  rubric: ActivityRubric;
  items: RubricItem[];
  rows: ActivityReportRow[];
  tallies: TargetTally[];
  /** More than one class on the roster, so rows should be grouped. */
  classCount: number;
  /** Every student on the roster has every part marked. */
  complete: boolean;
}

export type ActivityReportLoad =
  | { ok: true; data: ActivityReportData }
  | { ok: false; status: 404 | 400 | 500; error: string };

export async function loadActivityReportData(
  supabase: SupabaseClient,
  testId: string,
  options: { showHidden: boolean }
): Promise<ActivityReportLoad> {
  const { data: test, error: testError } = await supabase
    .from("tests")
    .select("id, name, course_id, test_date, activity_rubric")
    .eq("id", testId)
    .maybeSingle();
  if (testError) return { ok: false, status: 500, error: testError.message };
  if (!test) return { ok: false, status: 404, error: "Activity not found" };

  const parsed = parseActivityRubric(test.activity_rubric);
  if (!parsed.ok) {
    return { ok: false, status: 400, error: `This activity's learning targets are not valid: ${parsed.error}` };
  }
  if (!parsed.rubric) {
    return {
      ok: false,
      status: 400,
      error: "This test has no learning targets, so it is not an activity and has nothing to report here.",
    };
  }
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
  });
  if (!roster.ok) return roster;

  const rows: ActivityReportRow[] = roster.data.subjects.map((s) => ({
    subjectId: s.subjectId,
    name: s.name,
    className: s.className,
    absent: s.absent,
    report: buildActivityReport(rubric, items, s.marks),
  }));

  const tallyRows: StudentActivityRow[] = rows.map((r) => ({
    name: r.name,
    className: r.className,
    report: r.report,
    absent: r.absent,
  }));

  const present = rows.filter((r) => !r.absent);

  return {
    ok: true,
    data: {
      test: { id: test.id as string, name: test.name as string, courseId, testDate: (test.test_date as string | null) ?? null },
      rubric,
      items,
      rows,
      tallies: tallyTargets(rubric, tallyRows),
      classCount: roster.data.classCount,
      complete: present.length > 0 && present.every((r) => r.report.complete),
    },
  };
}
