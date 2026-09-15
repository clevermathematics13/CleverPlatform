import type { SupabaseClient } from "@supabase/supabase-js";
import { INVITED_SUBJECT_PREFIX } from "./grading-subject";
import { fetchAllRows, loadInvitedRoster } from "./na-scanning";
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
 * disagree about who is on the roster or which marks count. The roster rule
 * is the AI grader's: the test's own class plus its track siblings (a Grade
 * 9 test is attached to one class and sat by the track), registered students
 * from `students` and never-logged-in ones from `invited_students`, each
 * under the same opaque subject id the marks are keyed by.
 *
 * Marks are student_marks -- what a teacher has ACCEPTED -- not AI
 * suggestions. A level here is a level that has been signed off part by
 * part, which is the only kind that belongs on a report.
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

  // -- Roster ---------------------------------------------------------------
  const courseId = (test.course_id as string | null) ?? null;
  let sourceCourseIds: string[] = [];
  let courseNames: Record<string, string> = {};
  const students: { subjectId: string; name: string; courseId: string }[] = [];
  if (courseId) {
    const resolution = await loadInvitedRoster(supabase, courseId, { includeTrackSiblings: true });
    sourceCourseIds = resolution.sourceCourseIds;
    courseNames = resolution.sourceCourseNames;

    let query = supabase
      .from("students")
      .select("profile_id, course_id, profiles:profile_id(display_name)")
      .in("course_id", sourceCourseIds);
    if (!options.showHidden) query = query.eq("hidden", false);
    const { data: registered, error: regError } = await query;
    if (regError) return { ok: false, status: 500, error: regError.message };

    const seen = new Set<string>();
    for (const s of registered ?? []) {
      const pid = s.profile_id as string | null;
      if (!pid || seen.has(pid)) continue;
      seen.add(pid);
      const prof = s.profiles as unknown;
      const displayName =
        prof && typeof prof === "object" && !Array.isArray(prof)
          ? (prof as { display_name: string | null }).display_name
          : Array.isArray(prof) && prof.length > 0
            ? (prof[0] as { display_name: string | null }).display_name
            : null;
      students.push({ subjectId: pid, name: displayName ?? "Unknown", courseId: s.course_id as string });
    }
    for (const r of resolution.roster) {
      if (r.profileId) {
        if (seen.has(r.profileId)) continue;
        seen.add(r.profileId);
        students.push({ subjectId: r.profileId, name: r.fullName, courseId: r.sourceCourseId });
      } else {
        students.push({ subjectId: `${INVITED_SUBJECT_PREFIX}${r.invitedId}`, name: r.fullName, courseId: r.sourceCourseId });
      }
    }
  }

  // -- Marks and absences -----------------------------------------------------
  const marksBySubject = new Map<string, Map<string, number>>();
  const itemIds = items.map((i) => i.id);
  if (itemIds.length > 0) {
    let rawMarks: { test_item_id: string; student_id: string | null; invited_student_id: string | null; marks_awarded: number }[];
    try {
      rawMarks = await fetchAllRows((from, to) =>
        supabase
          .from("student_marks")
          .select("test_item_id, student_id, invited_student_id, marks_awarded")
          .in("test_item_id", itemIds)
          .order("id", { ascending: true })
          .range(from, to)
      );
    } catch (e) {
      return { ok: false, status: 500, error: e instanceof Error ? e.message : String(e) };
    }
    for (const m of rawMarks) {
      const subjectId =
        m.student_id ?? (m.invited_student_id ? `${INVITED_SUBJECT_PREFIX}${m.invited_student_id}` : null);
      if (!subjectId) continue;
      let map = marksBySubject.get(subjectId);
      if (!map) {
        map = new Map();
        marksBySubject.set(subjectId, map);
      }
      map.set(m.test_item_id, m.marks_awarded);
    }
  }

  const absent = new Set<string>();
  const { data: absences } = await supabase
    .from("test_absences")
    .select("profile_id, invited_student_id")
    .eq("test_id", testId);
  for (const a of absences ?? []) {
    const subjectId = a.profile_id ?? (a.invited_student_id ? `${INVITED_SUBJECT_PREFIX}${a.invited_student_id}` : null);
    if (subjectId) absent.add(subjectId);
  }

  const lastName = (n: string) => n.trim().split(/\s+/).slice(-1)[0] ?? n;
  const classIndex = new Map(sourceCourseIds.map((id, i) => [id, i]));
  const rows: StandardsReportRow[] = students
    .map((s) => ({
      classOrder: classIndex.get(s.courseId) ?? 0,
      row: {
        subjectId: s.subjectId,
        name: s.name,
        className: courseNames[s.courseId] ?? null,
        absent: absent.has(s.subjectId),
        report: buildStandardsReport(rubric, items, marksBySubject.get(s.subjectId) ?? new Map()),
      },
    }))
    .sort(
      (a, b) =>
        a.classOrder - b.classOrder ||
        lastName(a.row.name).localeCompare(lastName(b.row.name)) ||
        a.row.name.localeCompare(b.row.name)
    )
    .map((x) => x.row);

  return {
    ok: true,
    data: {
      test: { id: test.id as string, name: test.name as string, courseId, testDate: (test.test_date as string | null) ?? null },
      rubric,
      items,
      rows,
      classCount: new Set(students.map((s) => s.courseId)).size,
    },
  };
}
