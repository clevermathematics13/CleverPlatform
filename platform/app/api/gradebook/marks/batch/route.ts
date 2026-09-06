import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { parseGradingSubject } from "@/lib/ai-grading";
import {
  describeAuditWarning,
  logMarkChanges,
  markKey,
  readPriorMarks,
  type MarkChange,
} from "@/lib/mark-audit";

const AUDIT_REASON = "Gradebook edit (batch)";

type MarkEntry = {
  testItemId: string;
  studentId: string;
  marksAwarded: number | null;
};

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

  const { marks } = body as { marks?: unknown };
  if (!Array.isArray(marks) || marks.length === 0) {
    return NextResponse.json(
      { error: "marks must be a non-empty array" },
      { status: 400 }
    );
  }

  for (const entry of marks) {
    const e = entry as Record<string, unknown>;
    if (typeof e.testItemId !== "string" || typeof e.studentId !== "string") {
      return NextResponse.json(
        { error: "Each entry needs testItemId and studentId strings" },
        { status: 400 }
      );
    }
  }

  const entries = marks as MarkEntry[];

  // studentId is the opaque subject id every AI-grade endpoint also
  // understands -- usually a real profiles.id, but "invited-<id>" for a
  // roster entry that has never logged in (see parseGradingSubject). Split
  // into two groups since each identity kind needs its own upsert conflict
  // target (test_item_id,student_id vs test_item_id,invited_student_id).
  const withMarks = entries.filter((e) => e.marksAwarded !== null && e.marksAwarded !== undefined);
  const profileUpserts = withMarks
    .filter((e) => parseGradingSubject(e.studentId).kind === "profile")
    .map((e) => ({
      test_item_id: e.testItemId,
      student_id: e.studentId,
      invited_student_id: null,
      marks_awarded: e.marksAwarded as number,
    }));
  const invitedUpserts = withMarks
    .filter((e) => parseGradingSubject(e.studentId).kind === "invited")
    .map((e) => ({
      test_item_id: e.testItemId,
      student_id: null,
      invited_student_id: parseGradingSubject(e.studentId).id,
      marks_awarded: e.marksAwarded as number,
    }));

  const deletes = entries.filter(
    (e) => e.marksAwarded === null || e.marksAwarded === undefined
  );

  // Every prior value in at most two queries, before any of it is
  // overwritten. A paste can cover a whole class times a whole paper, so
  // this deliberately does not read cell by cell.
  const targets = entries.map((e) => ({
    testItemId: e.testItemId,
    subject: parseGradingSubject(e.studentId),
  }));
  const { prior, failed: priorReadFailed } = await readPriorMarks(supabase, targets);

  if (profileUpserts.length > 0) {
    const { error } = await supabase
      .from("student_marks")
      .upsert(profileUpserts, { onConflict: "test_item_id,student_id" });
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (invitedUpserts.length > 0) {
    const { error } = await supabase
      .from("student_marks")
      .upsert(invitedUpserts, { onConflict: "test_item_id,invited_student_id" });
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
  }

  for (const e of deletes) {
    const subject = parseGradingSubject(e.studentId);
    let del = supabase.from("student_marks").delete().eq("test_item_id", e.testItemId);
    del = subject.kind === "invited" ? del.eq("invited_student_id", subject.id) : del.eq("student_id", subject.id);
    const { error } = await del;
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // One audit row per cell the paste actually changed. Cells re-sent with
  // the value they already had are dropped by buildMarkChangeRows, so a
  // wide paste does not bury the real edits.
  const changes: MarkChange[] = entries.map((e) => {
    const subject = parseGradingSubject(e.studentId);
    return {
      testItemId: e.testItemId,
      subject,
      oldMarks: prior.get(markKey(e.testItemId, subject)) ?? null,
      newMarks:
        e.marksAwarded === null || e.marksAwarded === undefined ? null : e.marksAwarded,
    };
  });
  const audit = await logMarkChanges(supabase, changes, user.id, AUDIT_REASON);

  // The marks are already written, so an incomplete trail is reported, not
  // raised: logged for the server, and returned as a warning the gradebook
  // shows without telling the teacher their paste failed.
  if (audit.error || priorReadFailed) {
    console.error("[gradebook] mark audit incomplete", {
      action: "batch",
      cells: entries.length,
      missed: audit.missed,
      priorReadFailed,
      error: audit.error,
    });
  }
  const warning = describeAuditWarning({ priorReadFailed, missed: audit.missed });

  return NextResponse.json(warning ? { ok: true, auditWarning: warning } : { ok: true });
}
