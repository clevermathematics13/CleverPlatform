/**
 * The scored roster behind every PowerSchool export.
 *
 * Two routes need it and must not disagree: the teacher's download
 * (app/api/gradebook/powerschool-export) and the file regenerated when a
 * student finishes a self-assessment
 * (app/api/gradebook/self-assessment-export). A level that differed between
 * them would be a level the teacher cannot explain, so the query lives here
 * once rather than in each.
 *
 * Levels are resolved with the same resolveGrade() the gradebook grid and the
 * Exam Reflection dashboard use, against the test's own boundary set, so an
 * exported file cannot disagree with the screen it came from.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { INVITED_SUBJECT_PREFIX } from "@/lib/ai-grading";
import { fetchAllRows, loadInvitedRoster } from "@/lib/na-scanning";
import { resolveGrade, type GradeBoundary } from "@/lib/grade-bands";
import { scoreCell, type PowerSchoolScoreRow } from "@/lib/powerschool-export";

export type BuiltRows = {
  rows: PowerSchoolScoreRow[];
  notSelfAssessed: number;
  testName: string;
  /** tests.test_date, for the Due Date line when a stored template is reused
   *  for an assignment other than the one it came from. */
  testDate: string | null;
  /** tests.short_name, for the generated file's name. */
  testShortName: string | null;
  courseName: string;
  /** Everyone on the roster, whatever the scope -- the denominator in
   *  "6 of 20 have self-assessed". */
  rosterCount: number;
  /** Students who have completed the self-assessment: the number the generated
   *  file is named after. */
  completedCount: number;
};

/** Everything both handlers need: the scored roster for one test, already
 *  narrowed to the requested scope. Shared so the file the teacher downloads
 *  and the template we fill in cannot disagree about a level. */
export async function buildScoreRows(
  supabase: SupabaseClient,
  testId: string,
  courseId: string,
  selfAssessedOnly: boolean
): Promise<BuiltRows | { error: string; status: number }> {
  const { data: test } = await supabase
    .from("tests")
    .select("id, name, short_name, test_date, total_marks, boundary_set_id")
    .eq("id", testId)
    .single();
  if (!test) return { error: "Test not found", status: 404 };

  const { data: course } = await supabase
    .from("courses")
    .select("id, name")
    .eq("id", courseId)
    .single();
  if (!course) return { error: "Course not found", status: 404 };

  let boundaries: GradeBoundary[] | null = null;
  if (test.boundary_set_id) {
    const { data: rows } = await supabase
      .from("grade_boundaries")
      .select("grade, min_proportion")
      .eq("set_id", test.boundary_set_id)
      .order("grade", { ascending: true });
    boundaries =
      (rows ?? []).map((r) => ({ grade: r.grade, min_proportion: Number(r.min_proportion) })) ?? null;
    if (boundaries.length === 0) boundaries = null;
  }

  // The roster this gradebook shows: registered students plus invitees who
  // have never signed in, exactly as app/dashboard/gradebook/[courseId] builds
  // it, so the file covers the same people as the grid.
  const { roster: invitedRoster, sourceCourseIds } = await loadInvitedRoster(supabase, courseId);

  const { data: rawStudents } = await supabase
    .from("students")
    .select("profile_id, student_number, profiles(display_name)")
    .in("course_id", sourceCourseIds)
    .eq("hidden", false);

  // The same student's number lives in two places, and only one of them is
  // filled reliably. A students row is created on first sign-in without a
  // number; invited_students carries the one the teacher entered. Reading
  // only the students row meant a class where everyone had signed in
  // recently exported with EVERY score blank -- 9G, 17 rows, nothing filled,
  // and PowerSchool's dialog said "0 of 17 scores will be imported" without
  // being able to say why. Nothing warns, because a row with no number is
  // simply one the template never matches.
  const { data: invitedNumbers } = await supabase
    .from("invited_students")
    .select("profile_id, student_number")
    .in("course_id", sourceCourseIds)
    .not("profile_id", "is", null);
  const numberByProfile = new Map(
    (invitedNumbers ?? [])
      .filter((r) => r.student_number)
      .map((r) => [r.profile_id as string, r.student_number as string])
  );

  const subjects: { subjectId: string; name: string; studentNumber: string | null }[] = (
    rawStudents ?? []
  ).map((s) => {
    const prof = s.profiles as unknown;
    const displayName =
      prof && typeof prof === "object" && !Array.isArray(prof)
        ? (prof as { display_name: string }).display_name
        : Array.isArray(prof) && prof.length > 0
        ? (prof[0] as { display_name: string }).display_name
        : null;
    return {
      subjectId: s.profile_id as string,
      name: displayName ?? "Unknown",
      studentNumber:
        (s.student_number as string | null) ??
        numberByProfile.get(s.profile_id as string) ??
        null,
    };
  });

  const invitedIds = invitedRoster.filter((r) => !r.profileId).map((r) => r.invitedId);
  if (invitedIds.length > 0) {
    const { data: invitedRows } = await supabase
      .from("invited_students")
      .select("id, full_name, student_number")
      .in("id", invitedIds);
    for (const r of invitedRows ?? []) {
      subjects.push({
        subjectId: `${INVITED_SUBJECT_PREFIX}${r.id as string}`,
        name: (r.full_name as string) ?? "Unknown",
        studentNumber: (r.student_number as string | null) ?? null,
      });
    }
  }

  const { data: items } = await supabase
    .from("test_items")
    .select("id")
    .eq("test_id", testId);
  const itemIds = (items ?? []).map((i) => i.id as string);

  // Paged: one assessment for a 50-student track is past PostgREST's silent
  // 1000-row cap. See the same note in the gradebook page.
  const earned: Record<string, number> = {};
  if (itemIds.length > 0) {
    const rawMarks = await fetchAllRows<{
      student_id: string | null;
      invited_student_id: string | null;
      marks_awarded: number;
    }>((from, to) =>
      supabase
        .from("student_marks")
        .select("student_id, invited_student_id, marks_awarded")
        .in("test_item_id", itemIds)
        .order("id", { ascending: true })
        .range(from, to)
    );
    for (const m of rawMarks) {
      const subjectId =
        m.student_id ??
        (m.invited_student_id ? `${INVITED_SUBJECT_PREFIX}${m.invited_student_id}` : null);
      if (!subjectId) continue;
      earned[subjectId] = (earned[subjectId] ?? 0) + m.marks_awarded;
    }
  }

  // Who counts as having completed the self-assessment. Gathered even when
  // exporting everyone, so scope=all can still report how many of its rows are
  // unreviewed rather than presenting the two files as equivalent.
  //
  // The platform's own test for that is hasSelfScores in reflection-client:
  // at least one non-null self_marks for the test. A submit writes every item
  // in a single upsert (buildSelfScoreRows), so rows exist or they do not; the
  // non-null part additionally excludes a submission left blank end to end,
  // which is what computeDisagreement already treats as "has not self-graded".
  // Uploading corrections is a later step and deliberately not required here.
  //
  // student_self_scores keys on student_id and has no invited-student
  // fallback, correctly: a student who has never signed in has no account to
  // have submitted one. Those students can therefore never satisfy this and
  // never appear under scope=self -- which is the intended reading of
  // "completed the self-assessment", but it is also why the excluded count is
  // reported rather than left for the teacher to notice from a short file.
  //
  // Paged: 50 students x 41 items is past PostgREST's silent 1000-row cap.
  const selfRows =
    itemIds.length > 0
      ? await fetchAllRows<{ student_id: string }>((from, to) =>
          supabase
            .from("student_self_scores")
            .select("student_id")
            .in("test_item_id", itemIds)
            .not("self_marks", "is", null)
            .order("id", { ascending: true })
            .range(from, to)
        )
      : [];
  const selfAssessed = new Set(selfRows.map((r) => r.student_id));

  const { data: rawAbsences } = await supabase
    .from("test_absences")
    .select("profile_id, invited_student_id")
    .eq("test_id", testId);
  const absent = new Set<string>();
  for (const a of rawAbsences ?? []) {
    const subjectId =
      a.profile_id ??
      (a.invited_student_id ? `${INVITED_SUBJECT_PREFIX}${a.invited_student_id}` : null);
    if (subjectId) absent.add(subjectId);
  }

  const totalMarks = test.total_marks ?? 0;
  const lastName = (n: string) => n.trim().split(/\s+/).slice(-1)[0] ?? n;
  const included = selfAssessedOnly
    ? subjects.filter((s) => selfAssessed.has(s.subjectId))
    : subjects;
  // Under scope=self this is who was left out; under scope=all it is who is in
  // the file without having reviewed their marks. Both are worth saying.
  const notSelfAssessed = subjects.filter((s) => !selfAssessed.has(s.subjectId)).length;
  const rows: PowerSchoolScoreRow[] = included
    .sort((a, b) => lastName(a.name).localeCompare(lastName(b.name)) || a.name.localeCompare(b.name))
    .map((s) => {
      const marks = earned[s.subjectId];
      const level =
        marks !== undefined && totalMarks > 0
          ? resolveGrade((marks / totalMarks) * 100, boundaries)
          : null;
      return {
        studentNumber: s.studentNumber,
        studentName: s.name,
        level,
        absent: absent.has(s.subjectId),
      };
    });

  return {
    rows,
    notSelfAssessed,
    testName: test.name as string,
    testDate: (test.test_date as string | null) ?? null,
    testShortName: (test.short_name as string | null) ?? null,
    courseName: course.name as string,
    rosterCount: subjects.length,
    completedCount: subjects.length - notSelfAssessed,
  };
}

/** The scores to write, keyed the only way PowerSchool matches on. Students
 *  with no number cannot be placed in a template at all; they are reported as
 *  unfilled rows on the far side rather than dropped silently. */
export function scoreMapFor(rows: PowerSchoolScoreRow[]): Map<string, string> {
  const byNumber = new Map<string, string>();
  for (const row of rows) {
    const number = row.studentNumber?.trim();
    if (number) byNumber.set(number, scoreCell(row));
  }
  return byNumber;
}

export type StoredTemplate = {
  template: string;
  source_test_id: string | null;
  assignment_name: string | null;
};

export async function loadStoredTemplate(
  supabase: SupabaseClient,
  courseId: string
): Promise<StoredTemplate | null> {
  const { data } = await supabase
    .from("powerschool_templates")
    .select("template, source_test_id, assignment_name")
    .eq("course_id", courseId)
    .maybeSingle();
  return (data as StoredTemplate | null) ?? null;
}
