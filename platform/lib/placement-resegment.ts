/**
 * placement-resegment.ts
 * -----------------------------------------------------------------------------
 * Whether a placement test's questions may be rebuilt by re-running
 * segmentation, and what to say when they may not.
 *
 * Segmentation does not edit questions, it replaces them: the route clears
 * placement_test_questions for the test and re-derives the lot from the scan.
 * placement_test_marks references placement_test_question_id ON DELETE
 * CASCADE, so that clear-out takes every mark on the paper with it.
 *
 * That is harmless for the case the clear-out was written for -- a retry after
 * a segmentation attempt that failed, where there is nothing yet to lose --
 * and silently destructive once the paper has been graded. Status does not
 * separate the two: the dashboard offers "Retry segmentation" whenever the
 * test is in 'error', and a test reaches 'error' with a full set of marks on
 * it when a later step (grading, recommending) is what failed.
 *
 * So the marks decide. Re-running a step is not a reason to delete a
 * judgement someone made about a student's work.
 *
 * One module rather than a check in the route and another in the dashboard:
 * the route refuses with this reason and the dashboard withholds the button
 * with the same one, so the rule cannot be tightened in one place and left
 * behind in the other.
 * -----------------------------------------------------------------------------
 */

/**
 * The reason re-segmenting is refused, or null when it is allowed.
 *
 * `markCount` is how many marks exist against this test's questions. The
 * dashboard passes the number of questions that carry a mark and the API
 * passes the row count from placement_test_marks; grading writes one row per
 * question, so the two agree, and either way the only thing that matters here
 * is whether it is zero.
 */
export function resegmentBlockedReason(markCount: number): string | null {
  if (markCount <= 0) return null;
  return (
    `This paper already has ${markCount} mark${markCount === 1 ? "" : "s"} on it, and ` +
    "re-segmenting rebuilds the questions those marks belong to, which would delete " +
    "them. Grade it again to redo the marks, or delete the test and upload it again " +
    "to start over."
  );
}

/** Shorthand for the dashboard, which only needs the yes/no. */
export function canResegment(markCount: number): boolean {
  return resegmentBlockedReason(markCount) === null;
}
