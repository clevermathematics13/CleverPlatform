/**
 * na-marking-key.ts
 * -----------------------------------------------------------------------------
 * Which of an anchor's two keys is THE key: the one a student's work is
 * actually marked against.
 *
 * There are two, both the teacher's own writing. na_anchors.question_answer is
 * the authored key (nuanced_analyses.parts[].answer); na_anchors.answer_sketch
 * is the terser quick-reference that came from teacher_companion.answerSketches.
 * They are not paraphrases of each other. The sketch was written to fit beside
 * a printed box and reads as prescriptive where the authored key is often
 * explicitly permissive: A.1's Q1(e) sketch said "they agree", where its
 * authored key says "Accept any observation that (c) and (d) agree". A real
 * student was marked down against the former who should have passed against
 * the latter.
 *
 * The grading prompt has preferred the authored key since that was found. The
 * teacher's own review screen did not: it showed the sketch, under the heading
 * "Answer key", while the model beside it had marked against the other one. A
 * teacher checking an AI verdict was checking it against a key the AI had not
 * seen -- which is precisely how the Q1(e) error survived review.
 *
 * So the precedence lives here, in one function with no Node imports, and both
 * the prompt builder and the review screen call it. A client component cannot
 * import lib/na-assessment (it reads the feedback-voice file from disk at
 * module init), and that is the whole reason the rule was duplicable in the
 * first place.
 * -----------------------------------------------------------------------------
 */

/** The two key columns, as either caller has them to hand. */
export interface MarkingKeySource {
  /** na_anchors.question_answer -- the authored key. Wins. */
  questionAnswer?: string | null;
  /** na_anchors.answer_sketch -- the quick-reference. Used only as a fallback. */
  answerSketch?: string | null;
}

/**
 * The key this anchor is marked against, or null when it has neither.
 * Whitespace-only counts as absent: a key of " " would otherwise win over a
 * real one and leave the model with nothing.
 */
export function markingKeyFor(a: MarkingKeySource): string | null {
  return a.questionAnswer?.trim() || a.answerSketch?.trim() || null;
}

/**
 * Which column that key came from, for a screen that wants to say so.
 * Null when there is no key at all.
 */
export function markingKeySource(a: MarkingKeySource): "authored" | "sketch" | null {
  if (a.questionAnswer?.trim()) return "authored";
  if (a.answerSketch?.trim()) return "sketch";
  return null;
}
