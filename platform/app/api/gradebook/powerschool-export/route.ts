/**
 * GET /api/gradebook/powerschool-export?testId=…&courseId=…
 *
 * The achievement levels for one test, as the PowerTeacher Scores Template
 * stored for this course with the Score column filled in. PowerSchool gets its
 * own file, with its own roster and its own student numbers, and the import
 * dialog has nothing to ask about. 404 until a template has been uploaded once
 * via POST.
 *
 * There used to be a second shape here, a bare three-column CSV. PowerSchool's
 * import does not read that as data at all (see lib/powerschool-export.ts), so
 * it is gone: the only file this route hands out is one that imports.
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
import { getApiTeacher } from "@/lib/auth";
import { powerSchoolFilename, rowsMissingStudentNumber } from "@/lib/powerschool-export";
import {
  buildScoreRows,
  loadStoredTemplate,
  scoreMapFor,
} from "@/lib/powerschool-rows";
import {
  clearPstScores,
  fillPstScores,
  readPstMetadata,
  retargetPst,
  PstFormatError,
} from "@/lib/pst-fill";

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
      "Content-Disposition": `attachment; filename="${powerSchoolFilename(courseName, testName)}"`,
      ...fillHeaders(result, selfAssessedOnly, notSelfAssessed),
      // Scored students with no number at all: they could not be placed in
      // the template, so they are not among its unfilled rows either.
      "X-Missing-Student-Numbers": String(rowsMissingStudentNumber(rows).length),
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
 * plain GET. Without a testId this only stores -- that is the
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
