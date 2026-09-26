import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { parseGradingSubject } from "@/lib/ai-grading";
import { markExportsStale } from "@/lib/self-assessment-export";
import {
  describeAuditWarning,
  logMarkChanges,
  markKey,
  readPriorMarks,
  type MarkChange,
} from "@/lib/mark-audit";
import {
  COULD_NOT_CHECK_SELF_ASSESSMENT,
  COULD_NOT_READ_CLEVMARK,
  partitionProtectedWrites,
} from "@/lib/protected-marks";
import { loadMarkProtection } from "@/lib/protected-marks-service";

const AUDIT_REASON = "Gradebook edit (batch)";

type MarkEntry = {
  testItemId: string;
  studentId: string;
  marksAwarded: number | null;
};

/** A pasted cell that was not changed because the protection kept its ClevMark. */
type RefusedCell = { testItemId: string; studentId: string; keptMarks: number };

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

  // studentId is the opaque subject id every AI-grade endpoint also
  // understands -- usually a real profiles.id, but "invited-<id>" for a
  // roster entry that has never logged in (see parseGradingSubject).
  const parsed = (marks as MarkEntry[]).map((e) => ({
    ...e,
    marksAwarded: e.marksAwarded === null || e.marksAwarded === undefined ? null : e.marksAwarded,
    subject: parseGradingSubject(e.studentId),
  }));
  type Cell = (typeof parsed)[number];
  const keyOf = (c: Cell) => markKey(c.testItemId, c.subject);

  // Every prior value in at most two queries, before any of it is
  // overwritten. A paste can cover a whole class times a whole paper, so
  // this deliberately does not read cell by cell.
  const targets = parsed.map((c) => ({ testItemId: c.testItemId, subject: c.subject }));
  const { prior, failed: priorReadFailed } = await readPriorMarks(supabase, targets);

  // A ClevMark is never lowered or cleared once the student has self-assessed
  // the test (lib/protected-marks.ts). Those cells are skipped and returned in
  // `refused`; the rest of the paste goes ahead. If the protection cannot be
  // worked out, nothing is written.
  let protection: Awaited<ReturnType<typeof loadMarkProtection>>;
  try {
    protection = await loadMarkProtection(
      supabase,
      parsed.filter((c) => c.subject.kind === "profile").map((c) => ({ testItemId: c.testItemId, studentId: c.subject.id }))
    );
  } catch {
    return NextResponse.json({ error: COULD_NOT_CHECK_SELF_ASSESSMENT }, { status: 503 });
  }
  const isProtected = (c: Cell) => c.subject.kind === "profile" && protection.isSelfAssessed(c.subject.id, c.testItemId);
  if (priorReadFailed && parsed.some(isProtected)) {
    return NextResponse.json({ error: COULD_NOT_READ_CLEVMARK }, { status: 503 });
  }
  const { write, kept } = partitionProtectedWrites(parsed, (c) => ({
    existing: prior.get(keyOf(c)) ?? null,
    requested: c.marksAwarded,
    selfAssessed: isProtected(c),
  }));
  const refused: RefusedCell[] = kept.map((c) => ({
    testItemId: c.testItemId,
    studentId: c.studentId,
    keptMarks: prior.get(keyOf(c))!,
  }));

  // Split into two groups since each identity kind needs its own upsert
  // conflict target (test_item_id,student_id vs test_item_id,invited_student_id).
  const withMarks = write.filter((c) => c.marksAwarded !== null);
  const profileUpserts = withMarks
    .filter((c) => c.subject.kind === "profile")
    .map((c) => ({
      test_item_id: c.testItemId,
      student_id: c.subject.id,
      invited_student_id: null,
      marks_awarded: c.marksAwarded as number,
    }));
  const invitedUpserts = withMarks
    .filter((c) => c.subject.kind === "invited")
    .map((c) => ({
      test_item_id: c.testItemId,
      student_id: null,
      invited_student_id: c.subject.id,
      marks_awarded: c.marksAwarded as number,
    }));

  const deletes = write.filter((c) => c.marksAwarded === null);

  // Each write reads back what is on file afterwards. The database keeps a
  // protected ClevMark rather than failing the write (the
  // student_marks_protect_self_assessed trigger), e.g. when the student
  // self-assessed after the check above, so a value that came back different
  // -- or a delete that removed nothing while a mark was on file and still is
  // -- was kept, and is refused like the rest.
  const onFile = new Map<string, number>();
  const RETURNING = "test_item_id, student_id, invited_student_id, marks_awarded";
  const readBack = (rows: { test_item_id: string; student_id: string | null; invited_student_id: string | null; marks_awarded: number }[] | null) => {
    for (const m of rows ?? []) {
      const subject = m.student_id
        ? ({ kind: "profile", id: m.student_id } as const)
        : ({ kind: "invited", id: m.invited_student_id! } as const);
      onFile.set(markKey(m.test_item_id, subject), m.marks_awarded);
    }
  };

  if (profileUpserts.length > 0) {
    const { data, error } = await supabase
      .from("student_marks")
      .upsert(profileUpserts, { onConflict: "test_item_id,student_id" })
      .select(RETURNING);
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    readBack(data);
  }

  if (invitedUpserts.length > 0) {
    const { data, error } = await supabase
      .from("student_marks")
      .upsert(invitedUpserts, { onConflict: "test_item_id,invited_student_id" })
      .select(RETURNING);
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    readBack(data);
  }

  const undeleted: Cell[] = [];
  for (const c of deletes) {
    let del = supabase.from("student_marks").delete().eq("test_item_id", c.testItemId);
    del = c.subject.kind === "invited" ? del.eq("invited_student_id", c.subject.id) : del.eq("student_id", c.subject.id);
    const { data, error } = await del.select("marks_awarded");
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    if ((data ?? []).length === 0 && prior.has(keyOf(c))) undeleted.push(c);
  }
  if (undeleted.length > 0) {
    const { prior: after, failed } = await readPriorMarks(
      supabase,
      undeleted.map((c) => ({ testItemId: c.testItemId, subject: c.subject }))
    );
    if (!failed) {
      for (const c of undeleted) {
        const still = after.get(keyOf(c));
        if (still !== undefined) onFile.set(keyOf(c), still);
      }
    }
  }

  // A cell the read-back did not return is taken as written: the check above
  // already applied the rule, and this is only its backstop.
  const applied: Cell[] = [];
  for (const c of write) {
    const now = onFile.get(keyOf(c));
    if (now !== undefined && now !== c.marksAwarded) {
      refused.push({ testItemId: c.testItemId, studentId: c.studentId, keptMarks: now });
    } else {
      applied.push(c);
    }
  }

  // The levels in the stored PowerSchool export just changed. Flagged rather
  // than rebuilt; the gradebook asks for a rebuild once the typing stops.
  // Refused cells changed nothing, so they flag nothing.
  if (applied.length > 0) await markExportsStale({ testItemIds: applied.map((c) => c.testItemId) });

  // One audit row per cell the paste actually changed. Cells re-sent with
  // the value they already had are dropped by buildMarkChangeRows, so a
  // wide paste does not bury the real edits; refused cells did not change.
  const changes: MarkChange[] = applied.map((c) => ({
    testItemId: c.testItemId,
    subject: c.subject,
    oldMarks: prior.get(keyOf(c)) ?? null,
    newMarks: c.marksAwarded,
  }));
  const audit = await logMarkChanges(supabase, changes, user.id, AUDIT_REASON);

  // The marks are already written, so an incomplete trail is reported, not
  // raised: logged for the server, and returned as a warning the gradebook
  // shows without telling the teacher their paste failed.
  if (audit.error || priorReadFailed) {
    console.error("[gradebook] mark audit incomplete", {
      action: "batch",
      cells: parsed.length,
      missed: audit.missed,
      priorReadFailed,
      error: audit.error,
    });
  }
  const warning = describeAuditWarning({ priorReadFailed, missed: audit.missed });

  return NextResponse.json({
    ok: true,
    ...(warning ? { auditWarning: warning } : {}),
    ...(refused.length > 0 ? { refused } : {}),
  });
}
