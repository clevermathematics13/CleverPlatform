import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { INVITED_SUBJECT_PREFIX } from "@/lib/ai-grading";

export const maxDuration = 300;

interface RunRow {
  id: string;
  student_id: string | null;
  invited_student_id: string | null;
  created_at: string;
}

/** Which student_marks/mark_changes columns a run's identity writes against. */
interface Identity {
  student_id: string | null;
  invited_student_id: string | null;
}

function identityFor(r: RunRow): Identity {
  return r.student_id
    ? { student_id: r.student_id, invited_student_id: null }
    : { student_id: null, invited_student_id: r.invited_student_id };
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
 * Works the same whether a run's identity is a registered student
 * (student_id) or an imported-but-not-yet-registered one
 * (invited_student_id) -- see student_marks.invited_student_id. Since a
 * batch this size mixes both, and each identity kind needs its own upsert
 * conflict target (test_item_id,student_id vs test_item_id,invited_student_id),
 * the two groups are upserted separately.
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
    .select("id, student_id, invited_student_id, created_at")
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

  const runs = [...latestBySubject.values()];
  if (runs.length === 0) {
    return NextResponse.json(
      { error: "No completed runs to accept.", appliedCount: 0, studentsProcessed: 0 },
      { status: 404 }
    );
  }

  const identityByRun = new Map(runs.map((r) => [r.id, identityFor(r)]));
  const runIds = runs.map((r) => r.id);

  const { data: results, error: resultsErr } = await supabase
    .from("ai_grade_results")
    .select("id, run_id, test_item_id, suggested_marks, max_marks, confidence")
    .in("run_id", runIds)
    .eq("accepted", false);

  if (resultsErr) return NextResponse.json({ error: resultsErr.message }, { status: 500 });

  if (!results || results.length === 0) {
    return NextResponse.json({
      appliedCount: 0,
      studentsProcessed: runs.length,
      message: "Nothing to accept -- every suggested mark for every student is already accepted.",
    });
  }

  const clamped = results.map((r) => ({
    ...r,
    identity: identityByRun.get(r.run_id)!,
    marks: Math.max(0, Math.min(r.suggested_marks, r.max_marks)),
  }));

  // Prior marks, for the mark_changes audit log -- one query per identity
  // kind for every (subject, test_item) pair this batch touches, instead of
  // one query per row (this test alone can be 41 items x 17 students).
  const testItemIds = [...new Set(clamped.map((r) => r.test_item_id))];
  const profileRows = clamped.filter((r) => r.identity.student_id);
  const invitedRows = clamped.filter((r) => r.identity.invited_student_id);

  const existingByKey = new Map<string, number>();
  if (profileRows.length > 0) {
    const studentIds = [...new Set(profileRows.map((r) => r.identity.student_id!))];
    const { data, error } = await supabase
      .from("student_marks")
      .select("student_id, test_item_id, marks_awarded")
      .in("student_id", studentIds)
      .in("test_item_id", testItemIds);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const m of data ?? []) existingByKey.set(`p:${m.student_id}:${m.test_item_id}`, m.marks_awarded);
  }
  if (invitedRows.length > 0) {
    const invitedIds = [...new Set(invitedRows.map((r) => r.identity.invited_student_id!))];
    const { data, error } = await supabase
      .from("student_marks")
      .select("invited_student_id, test_item_id, marks_awarded")
      .in("invited_student_id", invitedIds)
      .in("test_item_id", testItemIds);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const m of data ?? [])
      existingByKey.set(`i:${m.invited_student_id}:${m.test_item_id}`, m.marks_awarded);
  }

  const keyFor = (r: (typeof clamped)[number]) =>
    r.identity.student_id
      ? `p:${r.identity.student_id}:${r.test_item_id}`
      : `i:${r.identity.invited_student_id}:${r.test_item_id}`;

  if (profileRows.length > 0) {
    const { error } = await supabase.from("student_marks").upsert(
      profileRows.map((r) => ({
        test_item_id: r.test_item_id,
        student_id: r.identity.student_id,
        invited_student_id: null,
        marks_awarded: r.marks,
      })),
      { onConflict: "test_item_id,student_id" }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (invitedRows.length > 0) {
    const { error } = await supabase.from("student_marks").upsert(
      invitedRows.map((r) => ({
        test_item_id: r.test_item_id,
        student_id: null,
        invited_student_id: r.identity.invited_student_id,
        marks_awarded: r.marks,
      })),
      { onConflict: "test_item_id,invited_student_id" }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { error: changesErr } = await supabase.from("mark_changes").insert(
    clamped.map((r) => ({
      test_item_id: r.test_item_id,
      student_id: r.identity.student_id,
      invited_student_id: r.identity.invited_student_id,
      changed_by: user.id,
      old_marks: existingByKey.get(keyFor(r)) ?? null,
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
    studentsProcessed: runs.length,
    totalApplied: clamped.reduce((sum, r) => sum + r.marks, 0),
  });
}
