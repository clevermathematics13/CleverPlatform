import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { describeAuditWarning, logMarkChanges } from "@/lib/mark-audit";
import { validateResolution } from "@/lib/remark-requests";
import { markExportsStale } from "@/lib/self-assessment-export";
import { protectedRefusalMessage } from "@/lib/protected-marks";

/**
 * PATCH /api/remark-requests/[id]
 * Body: { outcome: "changed" | "stands", newMarks?, note?, expectedCurrentMarks }
 *
 * The teacher's answer to a student's re-mark request. "changed" writes the
 * new ClevMark the way every other teacher mark edit does -- student_marks,
 * a mark_changes row, and the stored PowerSchool export flagged stale --
 * and "stands" keeps the mark. Either way the request records the outcome,
 * the mark it ended on, and the optional note the student reads.
 *
 * Runs in the teacher's own session: the request is readable and
 * answerable, and the mark writable, only on tests this teacher owns, so
 * the three ownership checks are the same one.
 *
 * The mark is written first and the request second. If the second half
 * fails the mark is already right and the request still waits; answering it
 * again finds the mark in place and skips the write, so a retry is safe.
 *
 * expectedCurrentMarks is the ClevMark the page showed. A mark that moved
 * since (a gradebook edit, an accept on the marking screen) is refused with
 * 409 rather than overwritten or misreported -- see validateResolution.
 *
 * "changed" never lowers the ClevMark: every request follows self-assessment,
 * and a ClevMark is never lowered after that (lib/protected-marks.ts).
 * validateResolution refuses it; if the database keeps the mark anyway (the
 * student_marks_protect_self_assessed trigger), the request is left pending
 * rather than recorded against a mark that did not change.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;
  const { id } = await params;

  const body = (await request.json().catch(() => null)) as {
    outcome?: unknown;
    newMarks?: unknown;
    note?: unknown;
    expectedCurrentMarks?: unknown;
  } | null;
  if (!body) return NextResponse.json({ error: "A JSON body is required" }, { status: 400 });

  const { data: remark, error: remarkError } = await supabase
    .from("remark_requests")
    .select("id, test_item_id, student_id, status, marks_at_request")
    .eq("id", id)
    .maybeSingle();
  if (remarkError) return NextResponse.json({ error: remarkError.message }, { status: 500 });
  if (!remark) return NextResponse.json({ error: "Re-mark request not found" }, { status: 404 });
  if (remark.status !== "pending") {
    return NextResponse.json({ error: "This request has already been answered." }, { status: 409 });
  }

  const testItemId = remark.test_item_id as string;
  const studentId = remark.student_id as string;

  const [itemRes, markRes] = await Promise.all([
    supabase.from("test_items").select("id, max_marks").eq("id", testItemId).maybeSingle(),
    supabase
      .from("student_marks")
      .select("marks_awarded")
      .eq("test_item_id", testItemId)
      .eq("student_id", studentId)
      .maybeSingle(),
  ]);
  if (itemRes.error || markRes.error) {
    return NextResponse.json({ error: (itemRes.error ?? markRes.error)!.message }, { status: 500 });
  }
  if (!itemRes.data) return NextResponse.json({ error: "Test part not found" }, { status: 404 });
  const currentMarks = (markRes.data?.marks_awarded as number | undefined) ?? null;

  const decision = validateResolution({
    outcome: body.outcome,
    newMarks: body.newMarks,
    note: body.note,
    maxMarks: itemRes.data.max_marks as number,
    marksAtRequest: remark.marks_at_request as number,
    currentMarks,
    expectedCurrentMarks: body.expectedCurrentMarks,
  });
  if (!decision.ok) return NextResponse.json({ error: decision.error }, { status: decision.status });

  let auditWarning: string | null = null;
  if (decision.writeMark) {
    // Only student_id is written: a request always belongs to a student with
    // an account, and leaving invited_student_id out of the payload keeps
    // whatever roster link the row already carries (as update-mark does).
    // RLS refuses the write unless this teacher owns the test.
    const { data: written, error: upsertError } = await supabase
      .from("student_marks")
      .upsert(
        { test_item_id: testItemId, student_id: studentId, marks_awarded: decision.resolvedMarks },
        { onConflict: "test_item_id,student_id" }
      )
      .select("marks_awarded")
      .maybeSingle();
    if (upsertError) {
      return NextResponse.json({ error: `The mark could not be saved: ${upsertError.message}` }, { status: 500 });
    }
    if (typeof written?.marks_awarded === "number" && written.marks_awarded !== decision.resolvedMarks) {
      return NextResponse.json(
        {
          error: `${protectedRefusalMessage({ kept: written.marks_awarded, requested: decision.resolvedMarks })} The request is still waiting.`,
          keptMarks: written.marks_awarded,
        },
        { status: 409 }
      );
    }

    const audit = await logMarkChanges(
      supabase,
      [{ testItemId, subject: { kind: "profile", id: studentId }, oldMarks: currentMarks, newMarks: decision.resolvedMarks }],
      user.id,
      decision.note ? `Re-mark request: ${decision.note}` : "Re-mark request"
    );
    if (audit.error) console.error("[remark-requests] mark_changes insert failed", audit.error);
    auditWarning = describeAuditWarning({ priorReadFailed: false, missed: audit.missed });

    // The levels in the stored PowerSchool export just changed.
    await markExportsStale({ testItemIds: [testItemId] });
  }

  const { data: resolved, error: resolveError } = await supabase
    .from("remark_requests")
    .update({
      status: decision.outcome,
      resolved_marks: decision.resolvedMarks,
      teacher_note: decision.note,
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("id, status, resolved_marks, teacher_note, resolved_at")
    .maybeSingle();
  if (resolveError) {
    const saved = decision.writeMark ? " The new mark IS saved; reload and answer the request again to record it." : "";
    return NextResponse.json({ error: `The answer could not be recorded: ${resolveError.message}.${saved}` }, { status: 500 });
  }
  if (!resolved) {
    return NextResponse.json({ error: "This request has already been answered." }, { status: 409 });
  }

  return NextResponse.json({ remark: resolved, marks_awarded: decision.resolvedMarks, auditWarning });
}
