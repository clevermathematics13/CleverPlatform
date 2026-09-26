/**
 * A ClevMark is never lowered or cleared once the student has self-assessed.
 *
 * The teacher's rule (25 Sep 2026): once a student has self-assessed a test,
 * no ClevMark already allocated on that test comes down -- not by accepting a
 * lower suggestion, not by retyping or pasting over a gradebook cell, not by
 * clearing it, not by answering a re-mark request. Raising a mark is always
 * allowed, and so is lowering one before the student has self-assessed. A
 * wrong mark found after self-assessment is left standing, and the lesson goes
 * to the grader instead (the part's marking notes, the grading policies).
 *
 * "Has self-assessed" here means: at least one student_self_scores row for the
 * student on any part of the test. That is deliberately wider than the reveal
 * gate (summariseSelfAssessment in lib/ai-grade-review.ts, which needs at least
 * one non-null self mark). A Redo, or clearing every box on the Compare step,
 * sets every self mark back to null but leaves the rows; an all-blank submit
 * leaves rows too. Neither should reopen a student's marks to being lowered,
 * so any row counts. Invited-only students (no account yet) cannot
 * self-assess, so they never count.
 *
 * The database enforces the same rule: the trigger
 * student_marks_protect_self_assessed keeps the old value instead of raising,
 * so a bulk write never fails on it. This module is the application side.
 * Every route checks before it writes and tells the teacher which marks were
 * kept, because the trigger alone would keep them silently.
 *
 * Pure (no server imports) so client components can share the rule and the
 * wording -- including the reflection dashboard, which ships in the student
 * bundle. Nothing here says "AI" for that reason.
 */

export interface ProtectionInput {
  /** The ClevMark on file for this part, or null when there is none. */
  existing: number | null;
  /** The value being written; null means the mark is being cleared. */
  requested: number | null;
  /** Whether the student has a self-assessment on file for this test. */
  selfAssessed: boolean;
}

/**
 * True when this write would lower or clear a ClevMark the rule protects.
 * A part with no ClevMark yet has nothing to protect, so any first mark is
 * allowed; an equal or higher value is never a decrease.
 */
export function isProtectedDecrease(input: ProtectionInput): boolean {
  if (!input.selfAssessed) return false;
  if (input.existing === null) return false;
  return input.requested === null || input.requested < input.existing;
}

/** Split a batch into the writes that may go ahead and the ones that must be kept. Order is preserved in both. */
export function partitionProtectedWrites<T>(
  rows: readonly T[],
  view: (row: T) => ProtectionInput
): { write: T[]; kept: T[] } {
  const write: T[] = [];
  const kept: T[] = [];
  for (const row of rows) (isProtectedDecrease(view(row)) ? kept : write).push(row);
  return { write, kept };
}

/** The protection's test for one student and one test: any self-score row at all. */
export function hasSelfAssessmentOnFile(rows: readonly unknown[] | null | undefined): boolean {
  return (rows?.length ?? 0) > 0;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Why a single write was refused. Safe to show to a student. */
export function protectedRefusalMessage(input: { kept: number; requested: number | null }): string {
  const attempted = input.requested === null ? "cleared" : `lowered to ${input.requested}`;
  return (
    `This ClevMark stays at ${input.kept} and was not ${attempted}: the student has a ` +
    `self-assessment on file for this test, and a ClevMark is never lowered or cleared after that.`
  );
}

/** Accept-all's summary of the suggestions it did not apply. Empty when there were none. */
export function keptSuggestionsMessage(count: number, students: number): string {
  if (count <= 0) return "";
  return (
    `${count} ${plural(count, "suggestion was", "suggestions were")} lower than the ClevMark already on file ` +
    `for ${students} ${plural(students, "student", "students")} with a self-assessment on file, so ` +
    `${plural(count, "that ClevMark was", "those ClevMarks were")} kept.`
  );
}

/** The gradebook paste's summary of the cells it did not change. Empty when there were none. */
export function refusedCellsMessage(count: number): string {
  if (count <= 0) return "";
  return (
    `${count} ${plural(count, "cell kept its", "cells kept their")} ClevMark: ` +
    `${plural(count, "that student has", "those students have")} a self-assessment on file for the test, ` +
    `and a ClevMark is never lowered or cleared after that.`
  );
}

const MAX_LISTED_PARTS = 6;

/** A one-line list of kept parts for the review panel, e.g. "3.3(a) stays 3 (suggested 1)". */
export function describeKeptParts(parts: readonly { label: string; kept: number; requested: number }[]): string {
  if (parts.length === 0) return "";
  const listed = parts
    .slice(0, MAX_LISTED_PARTS)
    .map((p) => `${p.label} stays ${p.kept} (you chose ${p.requested})`)
    .join(", ");
  const more = parts.length > MAX_LISTED_PARTS ? `, and ${parts.length - MAX_LISTED_PARTS} more` : "";
  return (
    `Kept ${parts.length} ${plural(parts.length, "ClevMark", "ClevMarks")}: ${listed}${more}. ` +
    `This student has a self-assessment on file, so a ClevMark is never lowered after that.`
  );
}

/** Shown when the protection lookup itself failed: nothing is written rather than risk an unreported change. */
export const COULD_NOT_CHECK_SELF_ASSESSMENT =
  "Could not check whether the student has self-assessed this test, so nothing was saved. Try again.";

/** Shown when the student has self-assessed but the ClevMark on file could not be read, so a decrease cannot be ruled out. */
export const COULD_NOT_READ_CLEVMARK =
  "Could not read the ClevMark on file for this part, so nothing was saved. Try again.";
