import type { ReflectionStep } from "./reflection-types";

/**
 * Which step of the Exam Reflection flow a student lands on when the page
 * opens.
 *
 * The flow is Self-Grade (1) -> Compare (2) -> Upload Corrections (3) ->
 * Done (4), and it used to always open on step 1 for anyone who had not
 * self-graded. That is right when self-assessment is the gate on seeing
 * Clev's Marks, but tests.require_self_assessment can now turn that gate
 * off per test -- and with it off, opening on Self-Grade still put the
 * self-assessment in front of the feedback, which is the exact thing
 * switching it off is meant to stop.
 *
 * So when the gate is off and the student has not self-graded, the flow
 * opens on Compare, where Clev's Marks already are. Self-Grade is not taken
 * away: it stays a step they can walk back to (see StepTracker's onSelect),
 * because a student who wants to predict their own marks after the fact
 * should still be able to, and the disagreement score only means anything
 * once they have.
 */
export interface InitialReflectionStepInput {
  /** They have already uploaded corrected work. */
  hasUpload: boolean;
  /** They have submitted at least one self-mark for this test. */
  hasSelfScores: boolean;
  /** The teacher has entered at least one mark for this test. */
  hasTeacherMarks: boolean;
  /** computeDisagreement()'s result: the gap between self-marks and Clev's
   *  Marks, or null when there is nothing to compare yet. Only an exact 0
   *  opens the corrections step, so null behaves as "still disagreeing" --
   *  the same comparison the flow used before this was extracted. */
  disagreement: number | null;
  /** tests.require_self_assessment -- false means Clev's Marks are visible
   *  without self-grading first. */
  selfAssessmentRequired: boolean;
}

export function initialReflectionStep(input: InitialReflectionStepInput): ReflectionStep {
  if (input.hasUpload) return 4;
  if (input.hasSelfScores) {
    return input.hasTeacherMarks && input.disagreement === 0 ? 3 : 2;
  }
  // Nothing self-graded yet. Only send them to Self-Grade if this test
  // actually requires it; otherwise open on the marks they are here to read.
  return input.selfAssessmentRequired ? 1 : 2;
}

/**
 * Whether Self-Grade should read as deliberately skipped rather than done.
 *
 * The step tracker marks every earlier step complete with a tick. Landing on
 * Compare without self-grading would otherwise tick a step the student never
 * did, which both misreports what happened and hides that the step is still
 * open to them.
 */
export function isSelfGradeSkipped(input: {
  hasSelfScores: boolean;
  selfAssessmentRequired: boolean;
}): boolean {
  return !input.selfAssessmentRequired && !input.hasSelfScores;
}
