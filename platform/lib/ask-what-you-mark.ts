/**
 * ask-what-you-mark.ts -- the question has to ask for everything its mark
 * scheme will withhold a mark for.
 * -----------------------------------------------------------------------------
 * A part is two things written together: the prompt the student reads and
 * the scheme the marker applies. When the scheme demands something the
 * prompt never asked for, the student loses a mark for not reading the
 * marker's mind, and it is recorded as a mathematical error, which it is
 * not.
 *
 * THE INCIDENT THIS CAME FROM. Key Assessment 1 (Grade 9 Extended) Q13(b),
 * worth one mark, printed:
 *
 *   "Use your expression to explain why the student is wrong."
 *
 * and was marked:
 *
 *   "R1 for reading 0.72c as a 28% reduction AND giving the reason (the
 *    second discount applies to the reduced price)."
 *
 * Those are not the same demand. 32 of the 49 who sat it scored 0, and at
 * least five of those had given the reason in plain words and were denied
 * the mark solely for not also stating 28% -- a figure the question never
 * asked for. The marking was not even consistent about it: two students
 * were awarded the mark with the note "although they didn't explicitly
 * state 28%, the reasoning is correct", while five others with the same
 * shape of answer were refused it. That inconsistency is the tell. When a
 * scheme demands more than its prompt, the extra demand is applied to
 * whichever student the marker happens to read strictly.
 *
 * WHY THIS IS A MODULE AND NOT A RULE IN ONE PROMPT. Every generator that
 * writes a question also writes the scheme that marks it -- assessments,
 * Nuanced Analysis packets, practice questions -- so the defect is
 * available to all of them and the fix belongs where all of them can reach
 * it. Carriers splice the block; ask-what-you-mark.test.ts fails if one
 * stops.
 *
 * THE OTHER HALF OF THE GUARD lives in
 * grading_policies/g9_formative_assessment_marking_principles.md, which
 * tells the MARKER not to withhold a mark for something the question did
 * not ask. This module stops the mismatch being written; that principle
 * stops an existing one costing a student marks on a paper already sat.
 */

/**
 * The rules, as they are spliced into a generator's system prompt. Numbered
 * so a teacher reviewing output can name the one that was broken.
 */
export const ASK_WHAT_YOU_MARK_RULES: readonly string[] = [
  "A1. READ THE SCHEME BACK AS A CHECKLIST, AGAINST THE PROMPT. Write the part, then list what its mark scheme would withhold a mark for -- a value, a form, a unit, a reason, a named property, a second thing after an AND -- and find each item in the question's own words. Anything the scheme gates a mark on that the prompt does not ask for is a mark the student cannot know to earn. Fix it by asking for the thing, or by dropping it from the scheme; never leave it in the scheme alone.",
  "A2. THE SAFE MISMATCH IS ASKING FOR MORE THAN YOU REQUIRE. Where the prompt and the scheme cannot be made to match exactly, let the prompt ask for more and the scheme require less. Asking for something you do not insist on costs a student nothing. Requiring something you did not ask for costs them a mark, and tells them their mathematics was wrong when it was not.",
  "A3. AN UPPERCASE AND IN A ONE-MARK SCHEME IS TWO DEMANDS. A part worth one mark whose scheme reads 'X AND Y' is gated on two separate things. Either name both in the prompt, or make the part worth two marks, or cut the scheme down to the one thing the prompt actually asks for. The same goes for a scheme that says 'must also', 'as well as', or 'with the reason'.",
  "A4. A PART QUOTING A WRONG CLAIM IS WHERE THIS BITES HARDEST. 'Explain why the student is wrong' is answered by ANY demonstration that they are -- a counterexample, a contradicting value, the correct expression set beside theirs. So a scheme that wants the true value named AND the mistake described has to ask for both: 'state the single percentage reduction the two discounts actually give, and describe the mistake in the student's reasoning'. Name the mistake as the thing to be described; do not settle for a verdict on it.",
  "A5. NAME THE FORM, THE UNITS AND THE VARIABLES WHEREVER THE SCHEME WILL. If the scheme insists on units, the prompt says 'include units'. If it insists on the general form, the prompt says 'in terms of x and y' -- a part following one that substituted particular values must say so, or a reasonable student cannot tell whether you want the general form or the value they just computed. If it insists on an exact answer or a number of significant figures, the prompt says which. If two readings of a prompt are both reasonable, one of them will be marked wrong for a reason that is not mathematical.",
  "A6. ASK IN THE PART THAT MARKS IT. A demand introduced in a question's stem, in the instructions, or in an earlier part does not carry into this part's mark scheme. If this part's mark depends on it, this part's prompt has to say it.",
] as const;

/**
 * The block as it appears in a system prompt. Generators splice this in
 * rather than restating any of it, so tightening a rule tightens it
 * everywhere at once.
 */
export function askWhatYouMarkBlock(): string {
  return [
    "ASK FOR WHAT YOU WILL MARK. The prompt a student reads and the scheme a marker applies are written together here, and they have to demand the same things. A scheme that requires what its prompt never asked for takes a mark off a student for not guessing, and records it as a mathematical error.",
    ...ASK_WHAT_YOU_MARK_RULES,
  ].join("\n");
}
