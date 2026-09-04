import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { INVITED_SUBJECT_PREFIX } from "@/lib/ai-grading";

export const maxDuration = 300;

interface RunRow {
  id: string;
  student_id: string | null;
  invited_student_id: string | null;
  created_at: string;
  invited_students: { full_name: string } | { full_name: string }[] | null;
}

/**
 * POST /api/tests/[id]/ai-grade/accept-all
 *
 * Accepts every not-yet-accepted suggested mark, for every question, for
 * every student's most recent COMPLETE run on this assessment -- one click
 * instead of opening each student's review individually. Applies the exact
 * same student_marks / mark_changes writes as POST .../accept, just batched
 * across the whole class rather than one run's selections at a time.
 *
 * A student whose latest run has no student_id (imported but never logged
 * in -- see ai_grade_runs.invited_student_id) is skipped, not failed: there
 * is no profiles row yet for student_marks to key against. Reported back so
 * the teacher knows who was left out and why.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const { id: testId } = await params;

  const { data: allRuns, error: runsErr } = await supabase
    .from("ai_grade_runs")
    .select("id, student_id, invited_student_id, created_at, invited_students(full_name)")
    .eq("test_id", testId)
    .eq("status", "complete")
    .order("created_at", { ascending: false });

  if (runsErr) return NextResponse.json({ error: runsErr.message }, { status: 500 });

  // Newest run per student, same rule the review UI uses (loadOverview).
  const latestBySubject = new Map<string, RunRow>();
  for (const r of (allRuns ?? []) as RunRow[]) {
    const key = r.student_id ?? `${INVITED_SUBJECT_PREFIX}${r.invited_student_id}`;
    if (!latestBySubject.has(key)) latestBySubject.set(key, r);
  }

  const skipped: { subject: string; name: string | null; reason: string }[] = [];
  const runsToProcess: { runId: string; studentId: string }[] = [];
  for (const [key, r] of latestBySubject) {
    if (!r.student_id) {
      const invited = Array.isArray(r.invited_students) ? r.invited_students[0] : r.invited_students;
      skipped.push({
        subject: key,
        name: invited?.full_name ?? null,
        reason: "Hasn't logged in yet -- accept once they register.",
      });
      continue;
    }
    runsToProcess.push({ runId: r.id, studentId: r.student_id });
  }

  if (runsToProcess.length === 0) {
    return NextResponse.json(
      { error: "No completed, registered-student runs to accept.", appliedCount: 0, studentsProcessed: 0, skipped },
      { status: 404 }
    );
  }

  const runIds = runsToProcess.map((r) => r.runId);
  const studentIdByRun = new Map(runsToProcess.map((r) => [r.runId, r.studentId]));

  const { data: results, error: resultsErr } = await supabase
    .from("ai_grade_results")
    .select("id, run_id, test_item_id, suggested_marks, max_marks, confidence")
    .in("run_id", runIds)
    .eq("accepted", false);

  if (resultsErr) return NextResponse.json({ error: resultsErr.message }, { status: 500 });

  if (!results || results.length === 0) {
    return NextResponse.json({
      appliedCount: 0,
      studentsProcessed: runsToProcess.length,
      skipped,
      message: "Nothing to accept -- every suggested mark for every student is already accepted.",
    });
  }

  const clamped = results.map((r) => ({
    ...r,
    studentId: studentIdByRun.get(r.run_id)!,
    marks: Math.max(0, Math.min(r.suggested_marks, r.max_marks)),
  }));

  // Prior marks, for the mark_changes audit log -- one query for every
  // (student, test_item) pair this batch touches, instead of one query per
  // row (this test alone can be 41 items x 17 students = 697 rows).
  const studentIds = [...new Set(clamped.map((r) => r.studentId))];
  const testItemIds = [...new Set(clamped.map((r) => r.test_item_id))];
  const { data: existingMarks, error: existingErr } = await supabase
    .from("student_marks")
    .select("student_id, test_item_id, marks_awarded")
    .in("student_id", studentIds)
    .in("test_item_id", testItemIds);

  if (existingErr) return NextResponse.json({ error: existingErr.message }, { status: 500 });

  const existingByKey = new Map(
    (existingMarks ?? []).map((m) => [`${m.student_id}:${m.test_item_id}`, m.marks_awarded])
  );

  const { error: upsertErr } = await supabase.from("student_marks").upsert(
    clamped.map((r) => ({ test_item_id: r.test_item_id, student_id: r.studentId, marks_awarded: r.marks })),
    { onConflict: "test_item_id,student_id" }
  );
  if (upsertErr) return NextResponse.json({ error: upsertErr.message }, { status: 500 });

  const { error: changesErr } = await supabase.from("mark_changes").insert(
    clamped.map((r) => ({
      test_item_id: r.test_item_id,
      student_id: r.studentId,
      changed_by: user.id,
      old_marks: existingByKey.get(`${r.studentId}:${r.test_item_id}`) ?? null,
      new_marks: r.marks,
      reason: `AI grading run ${r.run_id}, suggestion accepted as marked via batch accept-all (${r.confidence} confidence)`,
    }))
  );
  if (changesErr) return NextResponse.json({ error: changesErr.message }, { status: 500 });

  const acceptedAt = new Date().toISOString();
  const { error: acceptErr } = await supabase
    .from("ai_grade_results")
    .update({ accepted: true, accepted_at: acceptedAt, accepted_by: user.id })
    .in(
      "id",
      clamped.map((r) => r.id)
    );
  if (acceptErr) return NextResponse.json({ error: acceptErr.message }, { status: 500 });

  return NextResponse.json({
    appliedCount: clamped.length,
    studentsProcessed: runsToProcess.length,
    totalApplied: clamped.reduce((sum, r) => sum + r.marks, 0),
    skipped,
  });
}
