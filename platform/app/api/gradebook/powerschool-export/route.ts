/**
 * GET /api/gradebook/powerschool-export?testId=…&courseId=…
 *
 * The achievement levels for one test, as the CSV PowerTeacher Pro's
 * per-assignment "Import Scores" reads. Format decisions and their sources are
 * documented in lib/powerschool-export.ts.
 *
 * scope=self (the default) includes only students who completed the
 * self-assessment; scope=all includes everyone on the roster. See the
 * selfAssessed set below for what counts as completed and what that excludes.
 *
 * Levels are resolved with the same resolveGrade() the gradebook grid and the
 * Exam Reflection dashboard use, against the test's own boundary set, so the
 * file cannot disagree with the screen it was exported from.
 */

import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getApiTeacher } from "@/lib/auth";
import { INVITED_SUBJECT_PREFIX } from "@/lib/ai-grading";
import { fetchAllRows, loadInvitedRoster } from "@/lib/na-scanning";
import { resolveGrade, type GradeBoundary } from "@/lib/grade-bands";
import {
  buildPowerSchoolCsv,
  powerSchoolFilename,
  rowsMissingStudentNumber,
  scoreCell,
  type PowerSchoolScoreRow,
} from "@/lib/powerschool-export";
import { fillPstScores, PstFormatError } from "@/lib/pst-fill";

type BuiltRows = {
  rows: PowerSchoolScoreRow[];
  notSelfAssessed: number;
  testName: string;
  courseName: string;
};

/** Everything both handlers need: the scored roster for one test, already
 *  narrowed to the requested scope. Shared so the file the teacher downloads
 *  and the template we fill in cannot disagree about a level. */
async function buildScoreRows(
  supabase: SupabaseClient,
  testId: string,
  courseId: string,
  selfAssessedOnly: boolean
): Promise<BuiltRows | { error: string; status: number }> {
  const { data: test } = await supabase
    .from("tests")
    .select("id, name, total_marks, boundary_set_id")
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
      studentNumber: (s.student_number as string | null) ?? null,
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
    courseName: course.name as string,
  };
}

export async function GET(req: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;

  const testId = req.nextUrl.searchParams.get("testId");
  const courseId = req.nextUrl.searchParams.get("courseId");
  // Defaults to the narrower set: a file that wrongly omits a student is
  // noticed, one that wrongly includes them lands a level in PowerSchool for
  // work the student never reviewed.
  const selfAssessedOnly = req.nextUrl.searchParams.get("scope") !== "all";
  if (!testId || !courseId) {
    return NextResponse.json({ error: "testId and courseId are required" }, { status: 400 });
  }

  const built = await buildScoreRows(auth.supabase, testId, courseId, selfAssessedOnly);
  if ("error" in built) {
    return NextResponse.json({ error: built.error }, { status: built.status });
  }
  const { rows, notSelfAssessed, testName, courseName } = built;

  const csv = buildPowerSchoolCsv(rows);
  const filename = powerSchoolFilename(courseName, testName);
  const missing = rowsMissingStudentNumber(rows).length;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Read by the client so it can say what will not match in PowerSchool
      // before the teacher gets there.
      "X-Missing-Student-Numbers": String(missing),
      "X-Row-Count": String(rows.length),
      "X-Scope": selfAssessedOnly ? "self" : "all",
      // Students who have not self-assessed: excluded from the file under
      // scope=self, included but unreviewed under scope=all.
      "X-Not-Self-Assessed": String(notSelfAssessed),
    },
  });
}

/**
 * POST /api/gradebook/powerschool-export
 * multipart form: file (the PST), testId, courseId, scope
 *
 * Fills the Score column of a PowerTeacher Scores Template exported from the
 * assignment in PowerTeacher Pro, and hands it straight back.
 *
 * This is the better half of the feature. The template already names the
 * assignment PowerSchool expects, lists exactly the section being graded, and
 * carries whatever identifiers PowerSchool believes in -- so nothing has to be
 * guessed at, and matching on Student Num means the name differences that
 * would otherwise break it ("Roberto GAMIO" against "Roberto Aurelio Gamio")
 * never come up.
 */
export async function POST(req: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a multipart upload" }, { status: 400 });
  }

  const file = form.get("file");
  const testId = form.get("testId");
  const courseId = form.get("courseId");
  const selfAssessedOnly = form.get("scope") !== "all";
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No template file was uploaded" }, { status: 400 });
  }
  if (typeof testId !== "string" || typeof courseId !== "string") {
    return NextResponse.json({ error: "testId and courseId are required" }, { status: 400 });
  }

  const built = await buildScoreRows(auth.supabase, testId, courseId, selfAssessedOnly);
  if ("error" in built) {
    return NextResponse.json({ error: built.error }, { status: built.status });
  }

  // Only students carrying a number can be placed in the template at all; the
  // rest are reported as unfilled rows on the far side.
  const scoreByNumber = new Map<string, string>();
  for (const row of built.rows) {
    const number = row.studentNumber?.trim();
    if (number) scoreByNumber.set(number, scoreCell(row));
  }

  let result;
  try {
    result = fillPstScores(await file.text(), scoreByNumber);
  } catch (e) {
    const message = e instanceof PstFormatError ? e.message : "Could not read that file as a scores template.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return new NextResponse(result.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${file.name.replace(/\.csv$/i, "")}-filled.csv"`,
      "X-Filled": String(result.filled),
      "X-Unfilled": String(result.unfilled.length),
      // Students we scored whose number the template does not list -- normally
      // another section of the same course, worth saying rather than dropping.
      "X-Not-In-Template": String(result.notInTemplate.length),
      "X-Scope": selfAssessedOnly ? "self" : "all",
      "X-Not-Self-Assessed": String(built.notSelfAssessed),
    },
  });
}
