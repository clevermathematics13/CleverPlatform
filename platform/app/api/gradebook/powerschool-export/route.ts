/**
 * GET /api/gradebook/powerschool-export?testId=…&courseId=…[&format=pst]
 *
 * The achievement levels for one test. Two shapes:
 *
 * - format=pst fills in the PowerTeacher Scores Template stored for this
 *   course and hands it back. This is the one to use: PowerSchool gets its own
 *   file, with its own roster and its own student numbers, and the import
 *   dialog has nothing to ask about. 404 until a template has been uploaded
 *   once via POST.
 * - Without it, a plain three-column CSV, for reading or for an import whose
 *   columns you map by hand. Format decisions and their sources are documented
 *   in lib/powerschool-export.ts.
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
import {
  clearPstScores,
  fillPstScores,
  readPstMetadata,
  retargetPst,
  PstFormatError,
} from "@/lib/pst-fill";

type BuiltRows = {
  rows: PowerSchoolScoreRow[];
  notSelfAssessed: number;
  testName: string;
  /** tests.test_date, for the Due Date line when a stored template is reused
   *  for an assignment other than the one it came from. */
  testDate: string | null;
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
    .select("id, name, test_date, total_marks, boundary_set_id")
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
    testDate: (test.test_date as string | null) ?? null,
    courseName: course.name as string,
  };
}

/** The scores to write, keyed the only way PowerSchool matches on. Students
 *  with no number cannot be placed in a template at all; they are reported as
 *  unfilled rows on the far side rather than dropped silently. */
function scoreMapFor(rows: PowerSchoolScoreRow[]): Map<string, string> {
  const byNumber = new Map<string, string>();
  for (const row of rows) {
    const number = row.studentNumber?.trim();
    if (number) byNumber.set(number, scoreCell(row));
  }
  return byNumber;
}

type StoredTemplate = {
  template: string;
  source_test_id: string | null;
  assignment_name: string | null;
};

async function loadStoredTemplate(
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

/** Headers describing what a fill did, shared by the stored-template download
 *  and the upload that seeded it. */
function fillHeaders(
  result: { filled: number; unfilled: unknown[]; notInTemplate: unknown[] },
  selfAssessedOnly: boolean,
  notSelfAssessed: number
): Record<string, string> {
  return {
    "X-Filled": String(result.filled),
    "X-Unfilled": String(result.unfilled.length),
    // Students we scored whose number the template does not list -- normally
    // another section of the same course, worth saying rather than dropping.
    "X-Not-In-Template": String(result.notInTemplate.length),
    "X-Scope": selfAssessedOnly ? "self" : "all",
    "X-Not-Self-Assessed": String(notSelfAssessed),
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
  const { rows, notSelfAssessed, testName, testDate, courseName } = built;

  if (req.nextUrl.searchParams.get("format") === "pst") {
    const stored = await loadStoredTemplate(auth.supabase, courseId);
    if (!stored) {
      return NextResponse.json(
        {
          error:
            "No scores template stored for this class yet. Upload one once with Fill PST and it will be reused from then on.",
        },
        { status: 404 }
      );
    }

    // Re-exporting the test the template came from leaves the file exactly as
    // PowerSchool wrote it. For any other test the stored assignment name and
    // due date are known to be wrong, so they are rewritten -- a file whose
    // header names one assignment while its Score column holds another's
    // levels is a trap for whoever opens it next. See retargetPst.
    const aimed =
      stored.source_test_id === testId
        ? stored.template
        : retargetPst(stored.template, { assignmentName: testName, dueDate: testDate });

    let result;
    try {
      result = fillPstScores(aimed, scoreMapFor(rows));
    } catch (e) {
      const message =
        e instanceof PstFormatError
          ? `The stored template for this class could not be read (${e.message}) -- upload it again.`
          : "Could not fill the stored scores template.";
      return NextResponse.json({ error: message }, { status: 500 });
    }

    return new NextResponse(result.csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${powerSchoolFilename(courseName, testName, "pst")}"`,
        ...fillHeaders(result, selfAssessedOnly, notSelfAssessed),
      },
    });
  }

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
 * multipart form: file (the PST), courseId, and optionally testId, scope
 *
 * Stores a PowerTeacher Scores Template against the course, and -- when a
 * testId is given -- hands it straight back with that test's levels written
 * into the Score column.
 *
 * This is the better half of the feature. The template already names the
 * assignment PowerSchool expects, lists exactly the section being graded, and
 * carries whatever identifiers PowerSchool believes in -- so nothing has to be
 * guessed at, and matching on Student Num means the name differences that
 * would otherwise break it ("Roberto GAMIO" against "Roberto Aurelio Gamio")
 * never come up.
 *
 * Storing it makes the upload a one-off: every assignment after this one is a
 * GET with format=pst. Without a testId this only stores -- that is the
 * "replace the stored template" case, which is not an export and should not
 * hand back a file for some arbitrary assignment.
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
  const rawTestId = form.get("testId");
  const courseId = form.get("courseId");
  const selfAssessedOnly = form.get("scope") !== "all";
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No template file was uploaded" }, { status: 400 });
  }
  if (typeof courseId !== "string") {
    return NextResponse.json({ error: "courseId is required" }, { status: 400 });
  }
  const testId = typeof rawTestId === "string" && rawTestId !== "" ? rawTestId : null;

  const uploaded = await file.text();
  let metadata;
  try {
    metadata = readPstMetadata(uploaded);
  } catch (e) {
    const message = e instanceof PstFormatError ? e.message : "Could not read that file as a scores template.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Keep it, so this is the last time the teacher has to find the file. The
  // roster and the identifiers are the same for every assignment in the
  // section, which is what makes one upload enough; only the two metadata
  // lines that name the assignment go stale, and those are rewritten on the
  // way out. Stored with the Score column blank so a template that happened to
  // be uploaded with scores in it cannot hand one back later.
  const { error: storeError } = await auth.supabase.from("powerschool_templates").upsert(
    {
      course_id: courseId,
      template: clearPstScores(uploaded),
      source_test_id: testId,
      source_filename: file.name,
      assignment_name: metadata.assignmentName,
      class_name: metadata.className,
      student_count: metadata.studentCount,
      updated_at: new Date().toISOString(),
      updated_by: auth.user.id,
    },
    { onConflict: "course_id" }
  );

  // Whether the shortcut is armed for next time, and what it now holds.
  const templateHeaders = {
    "X-Template-Stored": storeError ? "0" : "1",
    "X-Template-Assignment": encodeURIComponent(metadata.assignmentName ?? ""),
    "X-Template-Students": String(metadata.studentCount),
  };

  if (!testId) {
    if (storeError) {
      return NextResponse.json(
        { error: `The template could not be saved: ${storeError.message}` },
        { status: 500 }
      );
    }
    return NextResponse.json(
      {
        stored: true,
        assignmentName: metadata.assignmentName,
        studentCount: metadata.studentCount,
      },
      { headers: templateHeaders }
    );
  }

  const built = await buildScoreRows(auth.supabase, testId, courseId, selfAssessedOnly);
  if ("error" in built) {
    return NextResponse.json({ error: built.error }, { status: built.status });
  }

  // Storing already succeeded or failed above; a failure there costs the
  // teacher the shortcut next time, not this file, so it is reported in a
  // header rather than thrown.
  const result = fillPstScores(uploaded, scoreMapFor(built.rows));

  return new NextResponse(result.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${file.name.replace(/\.csv$/i, "")}-filled.csv"`,
      ...fillHeaders(result, selfAssessedOnly, built.notSelfAssessed),
      ...templateHeaders,
    },
  });
}
