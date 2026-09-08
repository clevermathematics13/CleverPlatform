/**
 * The PowerSchool file that keeps itself up to date.
 *
 * POST — called by the student's browser the moment a self-assessment is
 * submitted. It rebuilds the filled scores template for that student's class
 * and stores it, named for how many of the class have now completed the
 * assessment: 9C_Form1_6.csv. The teacher does not have to be in the app, or
 * remember to export anything, for the file to be current.
 *
 * GET — the teacher downloading that stored file.
 *
 * Why the two halves live together: they are the two ends of one artifact, and
 * splitting them would make it easy to change what is written without changing
 * what is served.
 *
 * ## The privilege boundary
 *
 * The file lists every classmate's achievement level. The student who triggers
 * it must not see it, and must not be able to write it.
 *
 * So POST authenticates the student, establishes that they are enrolled and
 * that they really did just self-assess, and only then hands off to a service
 * role client to read the class's marks and write the object. It returns
 * `{ ok: true }` and nothing else -- not the filename, which would leak the
 * class's completion count, and certainly not the file.
 *
 * powerschool_export_files has no INSERT or UPDATE policy at all and the
 * bucket is private with no storage policies, so the service role is the only
 * writer and the GET below is the only reader. A student calling POST in a
 * loop can cost us a rebuild; it cannot read anything back.
 */

import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher, getApiUser } from "@/lib/auth";
import {
  BUCKET,
  regenerateIfStale,
  regenerateSelfAssessmentExport,
  serviceClient,
} from "@/lib/self-assessment-export";

export async function POST(req: NextRequest) {
  const auth = await getApiUser();
  if (!auth.ok) return auth.response;

  let testId: unknown;
  let courseId: unknown;
  try {
    ({ testId, courseId } = (await req.json()) as { testId?: unknown; courseId?: unknown });
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  if (typeof testId !== "string" || testId === "") {
    return NextResponse.json({ error: "testId is required" }, { status: 400 });
  }

  // A teacher asking for a rebuild after changing marks. They can already see
  // every level in the file, so there is nothing to establish beyond the role
  // getApiUser already read -- and unlike the student path below, they name
  // the class rather than being placed in one.
  if (auth.profile.role === "teacher") {
    if (typeof courseId !== "string" || courseId === "") {
      return NextResponse.json({ error: "courseId is required" }, { status: 400 });
    }
    const out = await regenerateSelfAssessmentExport(serviceClient(), courseId, testId);
    return NextResponse.json(
      out ? { ok: true, ...out } : { ok: true, skipped: "no scores template stored for this class" }
    );
  }

  // Which classes this caller is in. Read through their own client, so RLS
  // still applies and nobody can regenerate a class they are not enrolled in.
  const { data: enrolments } = await auth.supabase
    .from("students")
    .select("course_id")
    .eq("profile_id", auth.user.id)
    .eq("hidden", false);
  const courseIds = [...new Set((enrolments ?? []).map((e) => e.course_id as string))];
  if (courseIds.length === 0) {
    // A teacher previewing, or a student with no enrolment. Nothing to do, and
    // not an error worth showing anyone.
    return NextResponse.json({ ok: true });
  }

  // And that they really did just self-assess this test -- otherwise any
  // signed-in student could make us rebuild any assessment at will.
  const { data: items } = await auth.supabase.from("test_items").select("id").eq("test_id", testId);
  const itemIds = (items ?? []).map((i) => i.id as string);
  if (itemIds.length === 0) return NextResponse.json({ ok: true });

  const { data: own } = await auth.supabase
    .from("student_self_scores")
    .select("id")
    .eq("student_id", auth.user.id)
    .in("test_item_id", itemIds)
    .not("self_marks", "is", null)
    .limit(1);
  if (!own || own.length === 0) {
    return NextResponse.json({ error: "No self-assessment found for this assessment" }, { status: 403 });
  }

  const service = serviceClient();
  for (const courseId of courseIds) {
    await regenerateSelfAssessmentExport(service, courseId, testId);
  }

  // Deliberately nothing about the file: its name carries the class's
  // completion count, which is not this student's to know.
  return NextResponse.json({ ok: true });
}

/**
 * GET /api/gradebook/self-assessment-export?testId=…&courseId=…
 *
 * The stored file, under the name it was given when it was written. Teacher
 * only. Served through the service role because the bucket is private and has
 * no policies -- this route is its only reader.
 */
export async function GET(req: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;

  const testId = req.nextUrl.searchParams.get("testId");
  const courseId = req.nextUrl.searchParams.get("courseId");
  if (!testId || !courseId) {
    return NextResponse.json({ error: "testId and courseId are required" }, { status: 400 });
  }

  const read = () =>
    auth.supabase
      .from("powerschool_export_files")
      .select("storage_path, filename, completed_count, roster_count, filled_count, stale")
      .eq("course_id", courseId)
      .eq("test_id", testId)
      .maybeSingle();

  let { data: row } = await read();
  // Marks moved after this file was written. Rebuild before serving rather
  // than hand back something the gradebook already disagrees with -- this is
  // the backstop for every mark-write path, which only sets the flag.
  if (row?.stale && (await regenerateIfStale(courseId, testId, true))) {
    ({ data: row } = await read());
  }
  if (!row) {
    return NextResponse.json(
      {
        error:
          "Nothing generated for this assessment yet. It is written the first time a student in this class finishes the self-assessment.",
      },
      { status: 404 }
    );
  }

  const { data: file, error } = await serviceClient()
    .storage.from(BUCKET)
    .download(row.storage_path as string);
  if (error || !file) {
    return NextResponse.json({ error: "The stored file could not be read." }, { status: 404 });
  }

  return new NextResponse(await file.text(), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${row.filename as string}"`,
      "X-Completed-Count": String(row.completed_count),
      "X-Roster-Count": String(row.roster_count),
      "X-Filled": String(row.filled_count),
    },
  });
}
