import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { parseGradingSubject } from "@/lib/ai-grading";
import { markExportsStale } from "@/lib/self-assessment-export";
import {
  describeAuditWarning,
  logMarkChanges,
  markKey,
  readPriorMarks,
  type MarkAuditResult,
} from "@/lib/mark-audit";
import {
  COULD_NOT_CHECK_SELF_ASSESSMENT,
  COULD_NOT_READ_CLEVMARK,
  isProtectedDecrease,
  protectedRefusalMessage,
} from "@/lib/protected-marks";
import { loadMarkProtection } from "@/lib/protected-marks-service";

const AUDIT_REASON = "Gradebook edit";

/** The mark is already saved by the time this runs, so an incomplete audit
 *  trail is reported rather than raised: logged for the server, and returned
 *  as a warning the gradebook shows without claiming the edit failed. */
function auditResponse(
  audit: MarkAuditResult,
  priorReadFailed: boolean,
  context: Record<string, unknown>
) {
  if (audit.error || priorReadFailed) {
    console.error("[gradebook] mark audit incomplete", {
      ...context,
      missed: audit.missed,
      priorReadFailed,
      error: audit.error,
    });
  }
  const warning = describeAuditWarning({ priorReadFailed, missed: audit.missed });
  return NextResponse.json(warning ? { ok: true, auditWarning: warning } : { ok: true });
}

/** 409 for a ClevMark the protection kept: the gradebook puts `keptMarks` back in the cell. */
function keptResponse(kept: number, requested: number | null) {
  return NextResponse.json({ error: protectedRefusalMessage({ kept, requested }), keptMarks: kept }, { status: 409 });
}

export async function POST(req: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { testItemId, studentId, marksAwarded } =
    body as Record<string, unknown>;

  if (
    typeof testItemId !== "string" ||
    typeof studentId !== "string" ||
    !testItemId.trim() ||
    !studentId.trim()
  ) {
    return NextResponse.json(
      { error: "testItemId and studentId are required strings" },
      { status: 400 }
    );
  }

  // studentId is the opaque subject id every AI-grade endpoint also
  // understands -- usually a real profiles.id, but "invited-<id>" for a
  // roster entry that has never logged in (see parseGradingSubject).
  const subject = parseGradingSubject(studentId);

  // null clears the cell; anything else must be a whole number of marks.
  const clearing = marksAwarded === null || marksAwarded === undefined;
  const marks = clearing ? null : parseInt(String(marksAwarded), 10);
  if (marks !== null && (isNaN(marks) || marks < 0)) {
    return NextResponse.json(
      { error: "marksAwarded must be a non-negative integer" },
      { status: 400 }
    );
  }

  // Read what is there now, before either branch overwrites it -- a mark
  // that is about to be replaced or deleted is the only place the old value
  // still exists.
  const { prior, failed: priorReadFailed } = await readPriorMarks(supabase, [
    { testItemId, subject },
  ]);
  const oldMarks = prior.get(markKey(testItemId, subject)) ?? null;

  // A ClevMark is never lowered or cleared once the student has self-assessed
  // the test (lib/protected-marks.ts). Refused before anything is written; if
  // either lookup it needs failed, nothing is written either.
  let selfAssessed = false;
  if (subject.kind === "profile") {
    try {
      const protection = await loadMarkProtection(supabase, [{ testItemId, studentId: subject.id }]);
      selfAssessed = protection.isSelfAssessed(subject.id, testItemId);
    } catch {
      return NextResponse.json({ error: COULD_NOT_CHECK_SELF_ASSESSMENT }, { status: 503 });
    }
  }
  if (selfAssessed && priorReadFailed) {
    return NextResponse.json({ error: COULD_NOT_READ_CLEVMARK }, { status: 503 });
  }
  if (isProtectedDecrease({ existing: oldMarks, requested: marks, selfAssessed })) {
    return keptResponse(oldMarks!, marks);
  }

  // Delete mark (clear the cell)
  if (marks === null) {
    let del = supabase.from("student_marks").delete().eq("test_item_id", testItemId);
    del = subject.kind === "invited" ? del.eq("invited_student_id", subject.id) : del.eq("student_id", subject.id);
    const { data: deleted, error } = await del.select("marks_awarded");
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });

    // The database skips a protected delete rather than failing it (the
    // student_marks_protect_self_assessed trigger), e.g. when the student
    // self-assessed after the check above. Nothing deleted while a mark was on
    // file means it may still be there: look, and report it as kept if so.
    if ((deleted ?? []).length === 0 && oldMarks !== null) {
      const { prior: after, failed } = await readPriorMarks(supabase, [{ testItemId, subject }]);
      const still = after.get(markKey(testItemId, subject));
      if (!failed && still !== undefined) return keptResponse(still, null);
    }

    // The levels in the stored PowerSchool export just changed. Flagged, not
    // rebuilt: the gradebook saves one cell at a time. The rebuild happens a
    // few seconds after the typing stops, or at the download.
    await markExportsStale({ testItemIds: [testItemId] });

    // Logged as new_marks null: a cleared cell is not a score of 0.
    const audit = await logMarkChanges(
      supabase,
      [{ testItemId, subject, oldMarks, newMarks: null }],
      user.id,
      AUDIT_REASON
    );
    return auditResponse(audit, priorReadFailed, { testItemId, action: "clear" });
  }

  // UPSERT -- RLS will deny if the teacher doesn't own the test
  const { data: written, error } = await supabase
    .from("student_marks")
    .upsert(
      {
        test_item_id: testItemId,
        student_id: subject.kind === "profile" ? subject.id : null,
        invited_student_id: subject.kind === "invited" ? subject.id : null,
        marks_awarded: marks,
      },
      { onConflict: subject.kind === "invited" ? "test_item_id,invited_student_id" : "test_item_id,student_id" }
    )
    .select("marks_awarded")
    .maybeSingle();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  // The database keeps a protected ClevMark rather than failing the write, so
  // a value that came back different was kept: nothing changed, nothing logged.
  if (typeof written?.marks_awarded === "number" && written.marks_awarded !== marks) {
    return keptResponse(written.marks_awarded, marks);
  }

  // The levels in the stored PowerSchool export just changed. Flagged, not
  // rebuilt: the gradebook saves one cell at a time. The rebuild happens a
  // few seconds after the typing stops, or at the download.
  await markExportsStale({ testItemIds: [testItemId] });

  const audit = await logMarkChanges(
    supabase,
    [{ testItemId, subject, oldMarks, newMarks: marks }],
    user.id,
    AUDIT_REASON
  );

  return auditResponse(audit, priorReadFailed, { testItemId, action: "set" });
}
