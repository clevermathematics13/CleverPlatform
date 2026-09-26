import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { markExportsStale } from "@/lib/self-assessment-export";
import { COULD_NOT_CHECK_SELF_ASSESSMENT, COULD_NOT_READ_CLEVMARK, isProtectedDecrease } from "@/lib/protected-marks";
import { selfAssessedStudentIds } from "@/lib/protected-marks-service";

/**
 * POST /api/tests/[id]/ai-grade/accept
 * Body: {
 *   runId: string,
 *   selections: { resultId: string, marks?: number, note?: string }[]
 * }
 *
 * Applies teacher-reviewed AI results to student_marks ("ClevMarks").
 *
 * This is the ONLY path from an AI suggestion to a real mark. Every write is
 * logged to mark_changes with an explicit reason, so an AI-originated mark stays
 * distinguishable from one entered by hand. If the teacher overrode the
 * suggested value, the override is what gets written, and a `note` they typed
 * with it goes into the same reason -- the record of WHY, which until now was
 * only ever written by an agent session after the fact. A ruling that should
 * change how the part is marked from now on belongs on the item instead
 * (test_items.marking_notes, PUT .../items/[itemId]/marking-notes); this note
 * is the audit trail for this one mark.
 *
 * A ClevMark is never lowered once the student has self-assessed the test
 * (lib/protected-marks.ts). A lower value chosen for such a student writes no
 * mark and no mark_changes row: the ClevMark on file stays, the suggestion is
 * still flagged accepted (the teacher has reviewed it, so it leaves the queue),
 * and the part comes back in `kept` so the review panel can say so.
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
  const notes = new Map<string, string>();
  for (const sel of body.selections as { resultId?: unknown; marks?: unknown; note?: unknown }[]) {
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
    if (typeof sel.note === "string" && sel.note.trim()) {
      notes.set(sel.resultId.trim(), sel.note.trim().slice(0, 500));
    }
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
  // student_marks (ClevMarks) accepts either identity, mirroring
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

  // Whether this student has self-assessed the test, which is what protects
  // their ClevMarks from coming down. Checked once, before anything is written;
  // a failed check writes nothing rather than risk an unreported decrease.
  // An invited-only student has no account, so cannot have self-assessed.
  let selfAssessed = false;
  if (identity.student_id) {
    try {
      selfAssessed = (await selfAssessedStudentIds(supabase, testId, [identity.student_id])).has(identity.student_id);
    } catch {
      return NextResponse.json({ error: COULD_NOT_CHECK_SELF_ASSESSMENT }, { status: 503 });
    }
  }

  const acceptedPatch = () => ({ accepted: true, accepted_at: new Date().toISOString(), accepted_by: user.id });

  const applied: { resultId: string; testItemId: string; marks: number }[] = [];
  const failures: { resultId: string; error: string }[] = [];
  /** Parts whose ClevMark stayed because a lower value was chosen after the student self-assessed. */
  const kept: { resultId: string; testItemId: string; kept: number; requested: number }[] = [];

  for (const r of results) {
    const override = overrides.get(r.id);
    const requested = override === null || override === undefined ? r.suggested_marks : override;
    const marks = Math.max(0, Math.min(requested, r.max_marks));
    const wasOverridden = marks !== r.suggested_marks;

    // Prior mark, for the audit log and the protection check
    let existingQuery = supabase.from("student_marks").select("marks_awarded").eq("test_item_id", r.test_item_id);
    existingQuery = identity.student_id
      ? existingQuery.eq("student_id", identity.student_id)
      : existingQuery.eq("invited_student_id", identity.invited_student_id!);
    const { data: existing, error: existingErr } = await existingQuery.maybeSingle();

    // Without the mark on file there is no telling whether this write would
    // lower it, so a protected student's part is left alone and reported.
    if (existingErr && selfAssessed) {
      failures.push({ resultId: r.id, error: COULD_NOT_READ_CLEVMARK });
      continue;
    }

    const oldMarks: number | null = existing?.marks_awarded ?? null;

    if (isProtectedDecrease({ existing: oldMarks, requested: marks, selfAssessed })) {
      const { error: flagErr } = await supabase.from("ai_grade_results").update(acceptedPatch()).eq("id", r.id);
      if (flagErr) {
        failures.push({ resultId: r.id, error: flagErr.message });
        continue;
      }
      kept.push({ resultId: r.id, testItemId: r.test_item_id, kept: oldMarks!, requested: marks });
      continue;
    }

    const { data: written, error: upsertErr } = await supabase
      .from("student_marks")
      .upsert(
        {
          test_item_id: r.test_item_id,
          student_id: identity.student_id,
          invited_student_id: identity.invited_student_id,
          marks_awarded: marks,
        },
        { onConflict: marksConflictTarget }
      )
      .select("marks_awarded")
      .maybeSingle();

    if (upsertErr) {
      failures.push({ resultId: r.id, error: upsertErr.message });
      continue;
    }

    // The database keeps a protected ClevMark rather than failing the write
    // (the student_marks_protect_self_assessed trigger), for instance when the
    // student self-assessed after the check above. What is on file now is what
    // counts: if it is not the value sent, nothing changed, so nothing is logged.
    const onFile = typeof written?.marks_awarded === "number" ? written.marks_awarded : marks;
    if (onFile !== marks) {
      await supabase.from("ai_grade_results").update(acceptedPatch()).eq("id", r.id);
      kept.push({ resultId: r.id, testItemId: r.test_item_id, kept: onFile, requested: marks });
      continue;
    }

    await supabase.from("mark_changes").insert({
      test_item_id: r.test_item_id,
      student_id: identity.student_id,
      invited_student_id: identity.invited_student_id,
      changed_by: user.id,
      old_marks: oldMarks,
      new_marks: marks,
      reason:
        (wasOverridden
          ? `AI grading run ${runId} suggested ${r.suggested_marks} (${r.confidence} confidence); teacher applied ${marks}`
          : `AI grading run ${runId}, suggestion accepted as marked (${r.confidence} confidence)`) +
        (notes.has(r.id) ? ` -- note: ${notes.get(r.id)}` : ""),
    });

    await supabase.from("ai_grade_results").update(acceptedPatch()).eq("id", r.id);

    applied.push({ resultId: r.id, testItemId: r.test_item_id, marks });
  }

  // ClevMarks just changed, so the stored PowerSchool export no longer
  // matches it. Nothing applied means nothing moved, so there is nothing to
  // flag -- a kept part moved nothing either. Mirrors accept-all, which flags
  // the whole test the same way.
  if (applied.length > 0) await markExportsStale({ testId });

  return NextResponse.json({
    appliedCount: applied.length,
    applied,
    failures,
    kept,
    totalApplied: applied.reduce((sum, a) => sum + a.marks, 0),
  });
}
