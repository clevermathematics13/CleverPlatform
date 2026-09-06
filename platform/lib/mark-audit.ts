import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Audit-logging for Clev's Marks written outside the AI-grading flow.
 *
 * The AI accept routes have always written a mark_changes row beside every
 * student_marks write, which is why an AI-graded mark can be traced back to
 * the run, the confidence and the teacher who accepted it. The gradebook's
 * own edits wrote nothing at all, so a hand-typed mark -- and, worse, a
 * cleared one -- left no trace: the value simply differed from whatever the
 * grader had produced, with nothing to say who changed it or when.
 *
 * Identity mirrors student_marks itself: a mark belongs either to a profile
 * (an account) or to a roster row that has not signed in yet, never both.
 * parseGradingSubject in lib/ai-grading.ts turns the opaque studentId the
 * gradebook sends over the wire into one of those.
 */

export interface MarkSubject {
  kind: "profile" | "invited";
  id: string;
}

export interface MarkChange {
  testItemId: string;
  subject: MarkSubject;
  oldMarks: number | null;
  /** null means the mark was cleared, which is not the same as a score of 0. */
  newMarks: number | null;
}

/** Stable key pairing a prior mark with the write that replaces it. */
export function markKey(testItemId: string, subject: MarkSubject): string {
  return `${subject.kind}:${subject.id}:${testItemId}`;
}

/**
 * Shape the mark_changes rows for a set of edits.
 *
 * Writes that changed nothing are dropped. The gradebook re-sends a cell on
 * every save, and a paste can cover columns the teacher never altered, so
 * logging those would bury the real edits in rows that record no change --
 * the opposite of what an audit trail is for. A clear of an already-empty
 * cell (null to null) is a no-op by the same rule.
 *
 * Pure so the identity mapping and the no-op rule can be tested directly:
 * both are easy to get subtly wrong and neither is visible in the UI.
 */
export function buildMarkChangeRows(
  changes: MarkChange[],
  changedBy: string,
  reason: string
): Record<string, unknown>[] {
  return changes
    .filter((c) => c.oldMarks !== c.newMarks)
    .map((c) => ({
      test_item_id: c.testItemId,
      student_id: c.subject.kind === "profile" ? c.subject.id : null,
      invited_student_id: c.subject.kind === "invited" ? c.subject.id : null,
      changed_by: changedBy,
      old_marks: c.oldMarks,
      new_marks: c.newMarks,
      reason,
    }));
}

/**
 * The marks currently stored for the items about to be written, keyed by
 * markKey. Read BEFORE the write, since it is the only way to know what a
 * value replaced.
 *
 * At most two round trips whatever the batch size -- one per identity kind
 * -- rather than one per cell, because a gradebook paste can easily cover a
 * whole class times a whole paper.
 */
export async function readPriorMarks(
  supabase: SupabaseClient,
  targets: { testItemId: string; subject: MarkSubject }[]
): Promise<Map<string, number>> {
  const prior = new Map<string, number>();
  if (targets.length === 0) return prior;

  const testItemIds = [...new Set(targets.map((t) => t.testItemId))];
  const idsOfKind = (kind: MarkSubject["kind"]) => [
    ...new Set(targets.filter((t) => t.subject.kind === kind).map((t) => t.subject.id)),
  ];

  for (const kind of ["profile", "invited"] as const) {
    const ids = idsOfKind(kind);
    if (ids.length === 0) continue;
    const column = kind === "profile" ? "student_id" : "invited_student_id";

    const { data, error } = await supabase
      .from("student_marks")
      .select("test_item_id, student_id, invited_student_id, marks_awarded")
      .in("test_item_id", testItemIds)
      .in(column, ids);
    // A failed read must not block the write it precedes: the edit is what
    // the teacher asked for, and losing one audit row is better than losing
    // their mark. The rows simply read as first-time writes.
    if (error) continue;

    for (const row of data ?? []) {
      const id = (kind === "profile" ? row.student_id : row.invited_student_id) as string | null;
      if (!id || row.marks_awarded === null) continue;
      prior.set(markKey(row.test_item_id as string, { kind, id }), row.marks_awarded as number);
    }
  }

  return prior;
}

/**
 * Write the audit rows for a set of edits. Best-effort by design: called
 * after the marks are already saved, so a failure here must not turn a
 * successful edit into an error the teacher sees. Returns how many rows were
 * logged, which is what the tests assert on.
 */
export async function logMarkChanges(
  supabase: SupabaseClient,
  changes: MarkChange[],
  changedBy: string,
  reason: string
): Promise<number> {
  const rows = buildMarkChangeRows(changes, changedBy, reason);
  if (rows.length === 0) return 0;
  const { error } = await supabase.from("mark_changes").insert(rows);
  return error ? 0 : rows.length;
}
