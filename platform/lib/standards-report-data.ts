import type { SupabaseClient } from "@supabase/supabase-js";
import { loadReportRoster } from "./report-roster";
import {
  buildStandardsReport,
  parseStandardsRubric,
  type RubricItem,
  type StandardsReport,
  type StandardsRubric,
} from "./standards-rubric";

/**
 * The class's strand levels for one Standard Level test, from Clev's Marks.
 *
 * Shared by the standards report page and its CSV route so the two cannot
 * disagree about who is on the roster or which marks count. The roster and
 * the marks come from lib/report-roster.ts, which the Exploration/homework
 * report uses too -- see that file for the rule, which is the AI grader's.
 */

export interface StandardsReportRow {
  subjectId: string;
  name: string;
  className: string | null;
  absent: boolean;
  report: StandardsReport;
}

export interface StandardsReportData {
  test: { id: string; name: string; courseId: string | null; testDate: string | null };
  rubric: StandardsRubric;
  items: RubricItem[];
  rows: StandardsReportRow[];
  /** More than one class on the roster, so rows should be grouped. */
  classCount: number;
}

export type StandardsReportLoad =
  | { ok: true; data: StandardsReportData }
  | { ok: false; status: 404 | 400 | 500; error: string };

export async function loadStandardsReportData(
  supabase: SupabaseClient,
  testId: string,
  options: { showHidden: boolean }
): Promise<StandardsReportLoad> {
  const { data: test, error: testError } = await supabase
    .from("tests")
    .select("id, name, course_id, test_date, standards_rubric")
    .eq("id", testId)
    .maybeSingle();
  if (testError) return { ok: false, status: 500, error: testError.message };
  if (!test) return { ok: false, status: 404, error: "Test not found" };

  const parsed = parseStandardsRubric(test.standards_rubric);
  if (!parsed.ok) return { ok: false, status: 400, error: `This test's standards rubric is not valid: ${parsed.error}` };
  if (!parsed.rubric) {
    return { ok: false, status: 400, error: "This test has no standards rubric, so it has no strand levels to report." };
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

  const rows: StandardsReportRow[] = roster.data.subjects.map((s) => ({
    subjectId: s.subjectId,
    name: s.name,
    className: s.className,
    absent: s.absent,
    report: buildStandardsReport(rubric, items, s.marks),
  }));

  return {
    ok: true,
    data: {
      test: { id: test.id as string, name: test.name as string, courseId, testDate: (test.test_date as string | null) ?? null },
      rubric,
      items,
      rows,
      classCount: roster.data.classCount,
    },
  };
}
