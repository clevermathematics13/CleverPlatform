import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "./na-scanning";

/** Test items per prior-marks request. Bounds the GET query string, which
 *  carries every id inline: a whole paper plus a whole class is ~90 uuids
 *  before this splits them. */
const PRIOR_MARK_ITEM_CHUNK = 40;

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

export interface PriorMarksResult {
  prior: Map<string, number>;
  /** True when a lookup failed, so `prior` is incomplete. Callers must not
   *  treat a miss as "there was no mark here": the rows would be logged as
   *  first-time writes, which is a false claim about what the teacher
   *  replaced, and the no-op filter would stop suppressing unchanged cells. */
  failed: boolean;
}

/**
 * The marks currently stored for the items about to be written, keyed by
 * markKey. Read BEFORE the write, since it is the only way to know what a
 * value replaced.
 *
 * Batched by identity kind and chunked by test item rather than read one
 * cell at a time, because a gradebook paste can easily cover a whole class
 * times a whole paper.
 *
 * Paged through fetchAllRows, and that is not optional. PostgREST caps a
 * request at 1000 rows and reports no error when it stops, and the two
 * .in() filters here match the whole rectangle of existing marks, not just
 * the pasted cells: one 50-student assessment is already 2050 rows. An
 * unpaged read would come back half empty with error null, every missing
 * prior would read as "no mark here", and the audit would fill with
 * first-time-mark rows for cells that already had marks -- fabricated
 * history, written silently, since a truncation sets no error for the
 * warning to report. The gradebook page that renders this very grid hit the
 * same cap on 5 Sep 2026 (see its comment above the marks query).
 */
export async function readPriorMarks(
  supabase: SupabaseClient,
  targets: { testItemId: string; subject: MarkSubject }[]
): Promise<PriorMarksResult> {
  const prior = new Map<string, number>();
  let failed = false;
  if (targets.length === 0) return { prior, failed };

  const testItemIds = [...new Set(targets.map((t) => t.testItemId))];
  const idsOfKind = (kind: MarkSubject["kind"]) => [
    ...new Set(targets.filter((t) => t.subject.kind === kind).map((t) => t.subject.id)),
  ];

  type Row = {
    test_item_id: string;
    student_id: string | null;
    invited_student_id: string | null;
    marks_awarded: number | null;
  };

  for (const kind of ["profile", "invited"] as const) {
    const ids = idsOfKind(kind);
    if (ids.length === 0) continue;
    const column = kind === "profile" ? "student_id" : "invited_student_id";

    for (let i = 0; i < testItemIds.length; i += PRIOR_MARK_ITEM_CHUNK) {
      const itemChunk = testItemIds.slice(i, i + PRIOR_MARK_ITEM_CHUNK);
      let rows: Row[];
      try {
        rows = await fetchAllRows<Row>((from, to) =>
          supabase
            .from("student_marks")
            .select("test_item_id, student_id, invited_student_id, marks_awarded")
            .in("test_item_id", itemChunk)
            .in(column, ids)
            // Paging without a deterministic order can skip and repeat
            // rows across pages, which would put the fabricated history
            // back by another route.
            .order("id", { ascending: true })
            .range(from, to)
        );
      } catch {
        // A failed read must not block the write it precedes: the edit is
        // what the teacher asked for, and losing an audit row is better
        // than losing their mark. It is recorded rather than swallowed,
        // though -- the resulting rows would otherwise silently claim these
        // were first-time marks.
        failed = true;
        continue;
      }

      for (const row of rows) {
        const id = kind === "profile" ? row.student_id : row.invited_student_id;
        if (!id || row.marks_awarded === null) continue;
        prior.set(markKey(row.test_item_id, { kind, id }), row.marks_awarded);
      }
    }
  }

  return { prior, failed };
}

export interface MarkAuditResult {
  /** Rows actually written to mark_changes. */
  logged: number;
  /** Rows that should have been written but were not. */
  missed: number;
  /** The insert error, for the server log. Null when nothing went wrong. */
  error: string | null;
}

/**
 * Write the audit rows for a set of edits.
 *
 * Still never throws and never fails the request: it runs after the marks
 * are saved, and a broken audit insert must not tell a teacher mid-marking
 * that their edit failed when it did not. What it no longer does is stay
 * quiet about it -- the caller gets the counts and the error so the gap can
 * be logged server-side and shown to the teacher as a warning.
 */
export async function logMarkChanges(
  supabase: SupabaseClient,
  changes: MarkChange[],
  changedBy: string,
  reason: string
): Promise<MarkAuditResult> {
  const rows = buildMarkChangeRows(changes, changedBy, reason);
  if (rows.length === 0) return { logged: 0, missed: 0, error: null };

  const { error } = await supabase.from("mark_changes").insert(rows);
  if (error) return { logged: 0, missed: rows.length, error: error.message };
  return { logged: rows.length, missed: 0, error: null };
}

/**
 * The warning a teacher should see when the trail behind an edit is
 * incomplete, or null when it is sound.
 *
 * Deliberately says the marks ARE saved first. The failure being reported is
 * in the record of the change, not the change itself, and a teacher who
 * reads a warning mid-marking as "my edit was lost" will re-enter marks that
 * were never lost.
 *
 * Pure, so the wording and the precedence between the two failure modes can
 * be tested without a database.
 */
export function describeAuditWarning(input: {
  /** The prior-value lookup failed, so old_marks may be wrong. */
  priorReadFailed: boolean;
  /** Audit rows that could not be written. */
  missed: number;
}): string | null {
  const saved = "Your marks are saved.";
  if (input.missed > 0) {
    const rows = input.missed === 1 ? "1 change" : `${input.missed} changes`;
    return `${saved} ${rows} could not be written to the mark history, so this edit is not in the audit trail.`;
  }
  if (input.priorReadFailed) {
    return `${saved} The previous marks could not be read, so the mark history may show this edit as a first-time mark rather than a change.`;
  }
  return null;
}
