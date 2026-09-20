import { z } from "zod";
import { buildGradingSystemPrompt, buildUnitBlock, type GradingUnit } from "./ai-grading";

/**
 * Turning a teacher's feedback on one part into a marking ruling the grader
 * reads.
 *
 * A teacher looking at a graded part can say, in their own words, what the
 * marker got wrong or should do differently ("a substitution shown but not
 * finished is worth the M mark", "stop calling route 2 guess-and-check").
 * That sentence is not yet a rule: it does not say which mark scheme token
 * it changes, whether it applies to every student or this one, or what the
 * scheme should now read. This module builds the request that asks a model
 * to draft that rule, given everything the grader itself is given for the
 * part (the whole grading system prompt, policy included, and the part's
 * question, scheme and current notes) plus the case in front of the teacher.
 * The draft goes back to the teacher to review and save as
 * test_items.marking_notes; nothing here writes anything.
 *
 * The model is Opus 5 at high effort: the task is to reconcile a teacher's
 * sentence with a mark scheme and a nineteen-rule marking policy without
 * breaking either, which is the same kind of work the standards and
 * activity imports use it for. One call per piece of feedback, at the desk,
 * so cost is not the constraint; getting the wording right is.
 */
export const GRADER_FEEDBACK_MODEL = "claude-opus-5";

export const GraderFeedbackResponseSchema = z.object({
  /**
   * The complete marking notes for the part after this feedback: the
   * existing notes, revised, with the new ruling folded in. This is what the
   * teacher saves and the grader reads, so it is the whole text, not a diff.
   */
  markingNotes: z.string(),
  /** One or two sentences for the teacher: what the ruling changes and why. */
  summary: z.string(),
  /**
   * What the case the teacher was looking at should now score under the
   * revised notes, or null if no case was given or it does not change.
   */
  caseMarks: z.number().int().min(0).nullable(),
  /**
   * Set when the feedback cannot be turned into a ruling for this part -- it
   * asks for something the mark scheme's own maximum or the policy forbids,
   * or it is about a different part. The teacher sees this instead of a draft.
   */
  cannotApply: z.string().nullable(),
});

export type GraderFeedbackResponse = z.infer<typeof GraderFeedbackResponseSchema>;

/** The graded result the teacher was looking at when they wrote the feedback. */
export interface GraderFeedbackCase {
  studentLabel: string;
  evidence: string;
  reasoning: string;
  markBreakdown: { token: string; awarded: boolean; note?: string }[];
  suggestedMarks: number;
  maxMarks: number;
  confidence: string;
}

/**
 * The system prompt: the grader's own system prompt for this part, so the
 * drafting model knows exactly which rules the ruling will sit beside, then
 * its own brief.
 */
export function buildGraderFeedbackSystemPrompt(unit: GradingUnit): string {
  return `${buildGradingSystemPrompt([unit])}

${GRADER_FEEDBACK_TASK_BLOCK}`;
}

/**
 * The same prompt as two system blocks, so the route can put a cache
 * breakpoint after the grader's own prompt: that block is byte-identical to
 * what a marking call for this paper sends, so a feedback call made while
 * that entry is warm reads 29-50k characters from cache instead of paying
 * for them again. The task block stays outside the breakpoint.
 */
export function buildGraderFeedbackSystemBlocks(unit: GradingUnit): { grading: string; task: string } {
  return { grading: buildGradingSystemPrompt([unit]), task: GRADER_FEEDBACK_TASK_BLOCK };
}

const GRADER_FEEDBACK_TASK_BLOCK = `=== YOUR TASK IN THIS CALL ===
You are NOT marking a script now. Everything above is the brief the marker works from, given to you so you know it exactly. A teacher has read one of the marker's results for the part below and written feedback about how it should be marked. Turn that feedback into the part's TEACHER'S MARKING NOTES: the rulings the marker will read after the mark scheme on every later script on this paper (rule 20 above).

Write the notes as a second marker would want them: which mark scheme token or descriptor the ruling touches, what earns it and what does not, and any alternative the scheme did not list. Fold the feedback into the existing notes rather than appending a contradiction; keep every existing ruling the feedback does not overturn. Keep the mark scheme's maximum and the marking policy above intact -- if the feedback cannot be honoured without breaking either, or it is about a different part, say so in cannotApply and leave markingNotes as the existing notes unchanged. Do not restate the mark scheme; the notes are read beside it. Write in the teacher's register, plainly, in LaTeX $...$ for any mathematics as the scheme does.

Return ONLY a JSON object with markingNotes, summary, caseMarks and cannotApply.`;

export function buildGraderFeedbackUserPrompt(args: {
  unit: GradingUnit;
  feedback: string;
  currentNotes: string | null;
  graded: GraderFeedbackCase | null;
}): string {
  const { unit, feedback, currentNotes, graded } = args;
  // The unit block already prints the current notes when the unit carries
  // them; make sure it does, so the model revises what the grader reads.
  const block = buildUnitBlock({ ...unit, markingNotes: currentNotes ?? unit.markingNotes ?? null });
  const parts = [
    `--- The part ---`,
    block,
    ``,
    currentNotes?.trim()
      ? `--- Existing marking notes (also printed above; revise these) ---\n${currentNotes.trim()}`
      : `--- Existing marking notes ---\n(none yet)`,
  ];
  if (graded) {
    parts.push(
      ``,
      `--- The marker's result the teacher was looking at (${graded.studentLabel}) ---`,
      `Suggested marks: ${graded.suggestedMarks} of ${graded.maxMarks} (confidence ${graded.confidence})`,
      `Transcription of the student's work: ${graded.evidence || "(none)"}`,
      `Mark breakdown: ${
        graded.markBreakdown.length > 0
          ? graded.markBreakdown.map((b) => `${b.token} ${b.awarded ? "awarded" : "not awarded"}${b.note ? ` -- ${b.note}` : ""}`).join("; ")
          : "(none)"
      }`,
      `Examiner reasoning: ${graded.reasoning || "(none)"}`
    );
  }
  parts.push(``, `--- The teacher's feedback ---`, feedback.trim(), ``, `Draft the marking notes now. Return the JSON object only.`);
  return parts.join("\n");
}
