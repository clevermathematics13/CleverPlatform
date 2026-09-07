import type { SelfScore } from "@/lib/reflection-types";

/**
 * Building the rows a self-assessment submit writes to student_self_scores.
 *
 * The reflection portal used to upsert these one at a time in a `for` loop,
 * throwing on the first error. That made a failed submit worse than a
 * no-op: every question before the failing one was already committed, so the
 * student got an error message AND a half-saved self-assessment -- which
 * counts as having self-graded (hasSelfScores in reflection-client), moves
 * them off the Self-Grade step, and feeds a disagreement score computed from
 * questions they were never credited with answering.
 *
 * The rows are built here as one array so the callers can send them in a
 * single upsert instead. One statement means all rows land or none do, and a
 * student who sees "not saved" really has nothing saved.
 */

/** One student_self_scores row. */
export interface SelfScoreRow {
  test_item_id: string;
  student_id: string;
  /** NULL is "did not attempt this question", which is not the same fact as
   *  0 ("attempted it and earned nothing"). The column was NOT NULL DEFAULT 0
   *  until migration 20260907152544, which is why submitting a self-assessment
   *  with any question left blank failed outright. */
  self_marks: number | null;
  submitted_at: string;
}

/** The unique constraint student_self_scores upserts against. */
export const SELF_SCORE_CONFLICT_TARGET = "test_item_id,student_id";

export function buildSelfScoreRows(
  scores: SelfScore[],
  studentId: string,
  submittedAt: string = new Date().toISOString()
): SelfScoreRow[] {
  // Postgres rejects an ON CONFLICT DO UPDATE that touches the same row
  // twice in one statement (21000), so a duplicate test_item_id would fail
  // the whole batch where the old row-at-a-time loop just overwrote. The
  // reflection items come from test_items and cannot repeat today; keeping
  // last-write-wins here means a future caller that does repeat one gets the
  // loop's old behavior rather than a submit that dies for a reason no
  // student could act on.
  const byItem = new Map<string, SelfScoreRow>();
  for (const score of scores) {
    byItem.set(score.test_item_id, {
      test_item_id: score.test_item_id,
      student_id: studentId,
      self_marks: score.self_marks,
      submitted_at: submittedAt,
    });
  }
  return [...byItem.values()];
}

/**
 * What a student is told when the submit fails.
 *
 * Whatever went wrong, the batched upsert wrote nothing, so the one thing
 * worth saying first is that their work is still in the form and they can
 * try again. The underlying message is kept on the end for the teacher, who
 * is the one who can do anything about it.
 */
export function selfScoreSubmitMessage(error: unknown): string {
  const detail =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error);
  return `Your self-grades were not saved, so nothing has changed -- your answers are still in the form, so please try again. If it keeps failing, show your teacher this: ${detail}`;
}
