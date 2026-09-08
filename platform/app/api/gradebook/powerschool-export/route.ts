/**
 * GET /api/gradebook/powerschool-export?testId=…&courseId=…
 *
 * The achievement levels for one test, as the CSV PowerTeacher Pro's
 * per-assignment "Import Scores" reads. Format decisions and their sources are
 * documented in lib/powerschool-export.ts.
 *
 * Levels are resolved with the same resolveGrade() the gradebook grid and the
 * Exam Reflection dashboard use, against the test's own boundary set, so the
 * file cannot disagree with the screen it was exported from.
 */

import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { INVITED_SUBJECT_PREFIX } from "@/lib/ai-grading";
import { fetchAllRows, loadInvitedRoster } from "@/lib/na-scanning";
import { resolveGrade, type GradeBoundary } from "@/lib/grade-bands";
import {
  buildPowerSchoolCsv,
  powerSchoolFilename,
  rowsMissingStudentNumber,
  type PowerSchoolScoreRow,
} from "@/lib/powerschool-export";

export async function GET(req: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const testId = req.nextUrl.searchParams.get("testId");
  const courseId = req.nextUrl.searchParams.get("courseId");
  if (!testId || !courseId) {
    return NextResponse.json({ error: "testId and courseId are required" }, { status: 400 });
  }

  const { data: test } = await supabase
    .from("tests")
    .select("id, name, total_marks, boundary_set_id")
    .eq("id", testId)
    .single();
  if (!test) return NextResponse.json({ error: "Test not found" }, { status: 404 });

  const { data: course } = await supabase
    .from("courses")
    .select("id, name")
    .eq("id", courseId)
    .single();
  if (!course) return NextResponse.json({ error: "Course not found" }, { status: 404 });

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
  const rows: PowerSchoolScoreRow[] = subjects
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

  const csv = buildPowerSchoolCsv(rows);
  const filename = powerSchoolFilename(course.name as string, test.name as string);
  const missing = rowsMissingStudentNumber(rows).length;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Read by the client so it can say what will not match in PowerSchool
      // before the teacher gets there.
      "X-Missing-Student-Numbers": String(missing),
      "X-Row-Count": String(rows.length),
    },
  });
}
