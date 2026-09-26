/**
 * summative-grading-gate.ts
 * -----------------------------------------------------------------------------
 * Which AI-suggested marks a batch accept is allowed to cover.
 *
 * On a formative, all of them: "Accept all" is one click instead of fifty, and
 * a mark that turns out wrong is corrected in the next lesson at no cost to
 * anyone.
 *
 * On a summative it is not the same click. A paper that counts cannot have a
 * mark the model itself was unsure about written into ClevMarks because
 * nobody opened that part. So batch accept covers only what the model was
 * fully confident about, and everything else stays unaccepted -- waiting in
 * the review UI, where accepting one IS the teacher looking at it.
 *
 * The confidence rule is not invented here. `gradeNeedsReview` in
 * lib/ai-grading.ts already decides what belongs in a run's needsReview list --
 * anything short of "high", medium included, plus anything graded with no
 * working found -- and it is reused verbatim so the parts a summative holds
 * are exactly the parts the review UI already flags. Two definitions of
 * "needs review" would be two answers to the only question that matters here.
 *
 * Nothing stops a teacher accepting a held mark: POST .../ai-grade/accept
 * takes whatever they select, unchanged. That route is the intervention, not
 * an exception to it.
 * -----------------------------------------------------------------------------
 */

import { gradeNeedsReview } from "./ai-grading";
import type { AssessmentKind } from "./assessment-kind";

/** The shape this module needs from an `ai_grade_results` row. */
export type GradeResultConfidence = {
  confidence: string;
  /** ai_grade_results.work_found. Null on a row that predates the column. */
  work_found?: boolean | null;
};

/**
 * Would this result be written by a batch accept on this kind of assessment?
 *
 * `work_found` null counts as work found. A null is an old row rather than a
 * blank page, and treating "we don't know" as "no working" would hold marks
 * that were never in doubt.
 */
export function batchAcceptCovers(kind: AssessmentKind, result: GradeResultConfidence): boolean {
  if (kind !== "summative") return true;
  return !gradeNeedsReview({
    confidence: result.confidence as "high" | "medium" | "low",
    item: { workFound: result.work_found !== false },
  });
}

/** Split a batch into what it may write and what it must leave for a teacher. */
export function partitionBatchAccept<T extends GradeResultConfidence>(
  kind: AssessmentKind,
  results: T[],
): { accept: T[]; held: T[] } {
  const accept: T[] = [];
  const held: T[] = [];
  for (const result of results) {
    (batchAcceptCovers(kind, result) ? accept : held).push(result);
  }
  return { accept, held };
}

/**
 * What to tell the teacher about the marks that were not written.
 *
 * Empty string when nothing was held, so the caller can append it
 * unconditionally. Says how many and where they are, because a count on its
 * own reads as a failure rather than as the thing that was asked for.
 */
export function heldForReviewMessage(heldCount: number, studentsAffected: number): string {
  if (heldCount <= 0) return "";
  const marks = `${heldCount} suggested mark${heldCount === 1 ? "" : "s"}`;
  const students = `${studentsAffected} student${studentsAffected === 1 ? "" : "s"}`;
  return (
    `${marks} across ${students} were NOT accepted: this is a summative, and Clev was not ` +
    "fully confident about them. Open each student's review to check and accept those yourself."
  );
}
