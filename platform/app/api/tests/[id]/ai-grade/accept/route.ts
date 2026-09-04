import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

/**
 * POST /api/tests/[id]/ai-grade/accept
 * Body: {
 *   runId: string,
 *   selections: { resultId: string, marks?: number }[]
 * }
 *
 * Applies teacher-reviewed AI results to student_marks ("Clev's Marks").
 *
 * This is the ONLY path from an AI suggestion to a real mark. Every write is
 * logged to mark_changes with an explicit reason, so an AI-originated mark stays
 * distinguishable from one entered by hand. If the teacher overrode the
 * suggested value, the override is what gets written.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const { id: testId } = await params;

  let body: { runId?: unknown; selections?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const runId = typeof body.runId === "string" ? body.runId.trim() : "";
  if (!runId) return NextResponse.json({ error: "runId is required" }, { status: 400 });

  if (!Array.isArray(body.selections) || body.selections.length === 0) {
    return NextResponse.json({ error: "selections must be a non-empty array" }, { status: 400 });
  }

  const overrides = new Map<string, number | null>();
  for (const sel of body.selections as { resultId?: unknown; marks?: unknown }[]) {
    if (typeof sel.resultId !== "string" || !sel.resultId.trim()) {
      return NextResponse.json({ error: "Every selection needs a resultId" }, { status: 400 });
    }
    const marks = sel.marks === undefined || sel.marks === null ? null : Number(sel.marks);
    if (marks !== null && (!Number.isInteger(marks) || marks < 0)) {
      return NextResponse.json(
        { error: "Override marks must be a non-negative integer" },
        { status: 400 }
      );
    }
    overrides.set(sel.resultId.trim(), marks);
  }

  // -- Verify the run belongs to this assessment -----------------------------
  const { data: run, error: runErr } = await supabase
    .from("ai_grade_runs")
    .select("id, test_id, student_id, invited_student_id, status")
    .eq("id", runId)
    .maybeSingle();

  if (runErr) return NextResponse.json({ error: runErr.message }, { status: 500 });
  if (!run) return NextResponse.json({ error: "Grading run not found" }, { status: 404 });
  if (run.test_id !== testId) {
    return NextResponse.json(
      { error: "This grading run does not belong to the specified assessment" },
      { status: 400 }
    );
  }
  // student_marks ("Clev's Marks") accepts either identity, mirroring
  // ai_grade_runs: a run graded against an imported-but-not-yet-registered
  // student (student_id null, invited_student_id set) writes against
  // invited_student_id instead. auto_enroll_from_invitations reconciles it
  // to student_id automatically the moment the student logs in.
  const identity: { student_id: string | null; invited_student_id: string | null } = run.student_id
    ? { student_id: run.student_id, invited_student_id: null }
    : { student_id: null, invited_student_id: run.invited_student_id };
  const marksConflictTarget = identity.student_id ? "test_item_id,student_id" : "test_item_id,invited_student_id";

  const { data: results, error: rErr } = await supabase
    .from("ai_grade_results")
    .select("id, test_item_id, suggested_marks, max_marks, confidence")
    .eq("run_id", runId)
    .in("id", [...overrides.keys()]);

  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });
  if (!results || results.length === 0) {
    return NextResponse.json(
      { error: "None of the supplied resultIds belong to this run" },
      { status: 404 }
    );
  }

  const applied: { resultId: string; testItemId: string; marks: number }[] = [];
  const failures: { resultId: string; error: string }[] = [];

  for (const r of results) {
    const override = overrides.get(r.id);
    const requested = override === null || override === undefined ? r.suggested_marks : override;
    const marks = Math.max(0, Math.min(requested, r.max_marks));
    const wasOverridden = marks !== r.suggested_marks;

    // Prior mark, for the audit log
    let existingQuery = supabase.from("student_marks").select("marks_awarded").eq("test_item_id", r.test_item_id);
    existingQuery = identity.student_id
      ? existingQuery.eq("student_id", identity.student_id)
      : existingQuery.eq("invited_student_id", identity.invited_student_id!);
    const { data: existing } = await existingQuery.maybeSingle();

    const oldMarks = existing?.marks_awarded ?? null;

    const { error: upsertErr } = await supabase.from("student_marks").upsert(
      {
        test_item_id: r.test_item_id,
        student_id: identity.student_id,
        invited_student_id: identity.invited_student_id,
        marks_awarded: marks,
      },
      { onConflict: marksConflictTarget }
    );

    if (upsertErr) {
      failures.push({ resultId: r.id, error: upsertErr.message });
      continue;
    }

    await supabase.from("mark_changes").insert({
      test_item_id: r.test_item_id,
      student_id: identity.student_id,
      invited_student_id: identity.invited_student_id,
      changed_by: user.id,
      old_marks: oldMarks,
      new_marks: marks,
      reason: wasOverridden
        ? `AI grading run ${runId} suggested ${r.suggested_marks} (${r.confidence} confidence); teacher applied ${marks}`
        : `AI grading run ${runId}, suggestion accepted as marked (${r.confidence} confidence)`,
    });

    await supabase
      .from("ai_grade_results")
      .update({ accepted: true, accepted_at: new Date().toISOString(), accepted_by: user.id })
      .eq("id", r.id);

    applied.push({ resultId: r.id, testItemId: r.test_item_id, marks });
  }

  return NextResponse.json({
    appliedCount: applied.length,
    applied,
    failures,
    totalApplied: applied.reduce((sum, a) => sum + a.marks, 0),
  });
}
