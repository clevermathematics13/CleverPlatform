/**
 * The mathematical register -- one vocabulary for everything the platform
 * generates.
 * -----------------------------------------------------------------------------
 * Every AI-authored artefact here is read by a student as mathematics: a
 * Nuanced Analysis packet, an assessment, a practice question, a DP module,
 * the feedback written on a scanned response. A loose word in any of them
 * teaches the loose word.
 *
 * WHY THIS IS A MODULE AND NOT A PARAGRAPH IN ONE PROMPT. The defects that
 * prompted it were found on a Grade 9 summative, but they are not assessment
 * defects:
 *
 *   "State precisely where the two expressions agree" -- "agree" is not a
 *     relation. Two expressions are EQUAL at a value and EQUIVALENT on a
 *     domain, and the whole point of that question was the difference.
 *   "the value of w that is excluded from this equation" -- excluded by
 *     whom? The value is NOT IN THE DOMAIN, and the equation is UNDEFINED
 *     there. The vague version hides the reason the next part asks for.
 *
 * Both would have been written the same way into an NA packet or a piece of
 * marking feedback, so the fix belongs where every generator can reach it.
 *
 * RIGOUR IS NOT UNFAMILIAR NOTATION. Rule 10 exists because the obvious
 * failure mode of a rule like this is a Grade 9 paper that suddenly says
 * "for all x in R". The register is about using the precise WORD, in
 * language the course has already met.
 */

/**
 * The rules, as they are spliced into a generator's system prompt. Numbered
 * so a teacher reviewing output can name the one that was broken.
 */
export const MATHEMATICAL_REGISTER_RULES: readonly string[] = [
  "R1. NAME THE OBJECT, AND USE ITS VERB. An expression, an equation, an identity, a formula and an inequality are different objects. You simplify, expand, factor or evaluate an EXPRESSION; you solve an EQUATION or an INEQUALITY; you prove an IDENTITY; you rearrange a FORMULA to make something its subject. Never ask a student to 'solve' an expression or to 'simplify' an equation.",
  "R2. EQUAL IS NOT EQUIVALENT. Two expressions are EQUAL at a particular value of the variable, and EQUIVALENT when they are equal at every value in their common domain. Say which you mean, and say over what. Never write that expressions 'agree', 'match', 'are the same', or 'come out the same' -- none of those is a relation, and the difference between them is usually the mathematics being assessed.",
  "R3. DOMAIN, NOT PERMISSION. A value at which an expression has no meaning is NOT IN THE DOMAIN, and the expression is UNDEFINED there. Write 'state the value of x for which the expression is undefined' or 'state the restriction on x'. Do not write that a value 'is excluded from the equation', 'is not allowed', or 'cannot be used' -- those describe a rule someone imposed rather than the reason, which is what a student has to supply.",
  "R4. NAME THE OPERATION PERFORMED ON THE EQUATION. 'Add 3 to both sides', 'multiply every term by (w - 3)', 'divide both sides by the common factor'. Never 'move it across', 'get rid of', 'do the opposite', or 'cancel'. 'Cancel' in particular hides a division by a quantity that may be zero, which is the exact error these questions exist to catch.",
  "R5. SOLUTION, ROOT AND ZERO ARE DIFFERENT WORDS. A SOLUTION satisfies an equation; a ROOT is a solution of an equation in one variable; a ZERO is a value at which a function takes the value 0. Pick the one that fits and keep it consistent within an item.",
  "R6. QUANTIFY THE CLAIM. 'for every real value of x', 'for at least one value of x', 'there is no value of x'. An unquantified claim cannot be marked, because the student and the marker may quantify it differently.",
  "R7. ASK FOR A NAMED THING. 'the value of ...', 'an expression for ... in terms of ...', 'the set of values of ... for which ...'. 'Work out the answer' and 'find it' name nothing, and a mark scheme cannot describe what was wanted.",
  "R8. EXACT OR APPROXIMATE, STATED. Either 'give the exact value' (a fraction, a surd, a multiple of pi) or 'give your answer correct to 3 significant figures'. A part that says neither will be marked two ways.",
  "R9. THE ORDINARY WORDS ARE THE TECHNICAL ONES. Numerator and denominator, not top and bottom. Substitute, not plug in. Multiply by, not times by. Coefficient, term and factor each mean one thing; so do exponent, base and index. Use them.",
  "R10. RIGOUR IS THE PRECISE WORD, NOT UNFAMILIAR NOTATION. Never introduce a symbol the material has not already taught in order to sound formal -- no set-builder notation, no element or real-number symbols, no quantifier symbols, unless the course has met them. Where the precise term has not been taught, write the precise idea in plain words rather than reaching for a loose synonym.",
] as const;

/**
 * The block as it appears in a system prompt. Generators splice this in
 * rather than restating any of it, so tightening a rule tightens it
 * everywhere at once.
 */
export function mathematicalRegisterBlock(): string {
  return [
    "MATHEMATICAL REGISTER. These apply to every word you write -- question prompts, answers, mark schemes, explanations, headings and feedback alike. A student reads what you write as mathematics, so a loose word teaches the loose word.",
    ...MATHEMATICAL_REGISTER_RULES,
  ].join("\n");
}

/**
 * Wordings that the register replaces, for checking generated text.
 *
 * Deliberately narrow. Each pattern is anchored to the mathematical sense of
 * the word so ordinary prose survives: "agree" only where expressions or
 * sides are its subject, "cancel" only as an instruction. A register check
 * that fired on every appearance of the word "power" would be turned off
 * within a week, which is worth more than the findings it would produce.
 */
export const LOOSE_REGISTER_TERMS: readonly {
  rule: number;
  /** What was written. */
  pattern: RegExp;
  /** What to write instead. */
  instead: string;
}[] = [
  {
    rule: 2,
    pattern: /\b(?:expressions?|sides?|they|these)\s+(?:do not |don't |never )?(?:agree|match)\b/i,
    instead: "expressions are EQUAL at a value and EQUIVALENT on a domain -- 'agree' is not a relation (R2)",
  },
  {
    rule: 2,
    pattern: /\b(?:are|is)\s+the\s+same\s+(?:thing|as)\b/i,
    instead: "say EQUAL (at a value) or EQUIVALENT (for every value in the domain) (R2)",
  },
  {
    rule: 3,
    pattern: /\bexcluded\s+from\s+(?:this|the)\s+(?:equation|expression)\b/i,
    instead: "NOT IN THE DOMAIN, or say the equation is UNDEFINED there (R3)",
  },
  {
    rule: 3,
    pattern: /\b(?:is|are)\s+not\s+allowed\b/i,
    instead: "NOT IN THE DOMAIN, or UNDEFINED there (R3)",
  },
  {
    rule: 4,
    pattern: /\bcancel(?:s|led|ling|ling out|\s+out)?\b/i,
    instead: "name the operation -- 'divide both sides by', 'divide out the common factor, which requires it to be non-zero' (R4)",
  },
  {
    rule: 4,
    pattern: /\b(?:move|moving|moved)\s+(?:it|them|the\s+\w+)?\s*(?:to|across|over)\s+the\s+other\s+side\b/i,
    instead: "name the operation applied to both sides (R4)",
  },
  {
    rule: 4,
    pattern: /\bget(?:s|ting)?\s+rid\s+of\b/i,
    instead: "name the operation applied to both sides (R4)",
  },
  {
    rule: 9,
    pattern: /\bplug(?:s|ged|ging)?\s+(?:it|them|in|into)\b/i,
    instead: "SUBSTITUTE (R9)",
  },
  {
    rule: 9,
    pattern: /\b(?:top|bottom)\s+of\s+the\s+fraction\b/i,
    instead: "NUMERATOR / DENOMINATOR (R9)",
  },
  {
    rule: 9,
    pattern: /\btimes(?:ed)?\s+by\b/i,
    instead: "MULTIPLY BY (R9)",
  },
  {
    rule: 1,
    pattern: /\bsolve\s+(?:this\s+|the\s+|your\s+)?expression\b/i,
    instead: "you SIMPLIFY, EXPAND, FACTOR or EVALUATE an expression; only an equation is solved (R1)",
  },
  {
    rule: 1,
    pattern: /\bsimplify\s+(?:this\s+|the\s+)?equation\b/i,
    instead: "you SOLVE an equation, or REARRANGE a formula (R1)",
  },
  {
    rule: 7,
    pattern: /\bwork\s+out\s+the\s+answer\b/i,
    instead: "name what is wanted -- 'the value of ...', 'an expression for ... in terms of ...' (R7)",
  },
] as const;

export interface LooseRegisterHit {
  /** The register rule broken, 1-10. */
  rule: number;
  /** The text as written. */
  found: string;
  /** What the register asks for instead. */
  instead: string;
}

/**
 * Every register slip in a piece of generated text, at most one per pattern
 * so a repeated word does not bury the rest.
 */
export function findLooseRegisterTerms(text: string): LooseRegisterHit[] {
  if (!text) return [];
  const searchable = withoutQuotedText(text);
  const hits: LooseRegisterHit[] = [];
  for (const { rule, pattern, instead } of LOOSE_REGISTER_TERMS) {
    const match = pattern.exec(searchable);
    if (match) hits.push({ rule, found: match[0], instead });
  }
  return hits;
}

/**
 * Quoted spans, which the check deliberately does not read.
 *
 * Loose language inside quotation marks is almost always loose ON PURPOSE
 * here: a Broken Math Critique question quotes a student saying "that is the
 * same as 30% off" precisely so the reader can take it apart, and a mark
 * scheme quotes the wrong answer it is refusing to credit -- "'They are the
 * same' earns 0". Flagging either would train a teacher to ignore the check.
 *
 * Single quotes are matched only where the opening mark follows a space or a
 * bracket and the closing one precedes a space or punctuation, so an
 * apostrophe in "don't" or "the student's own working" is not read as
 * opening a quotation.
 */
const QUOTED_SPAN =
  /"[^"]*"|\u201c[^\u201d]*\u201d|\u2018[^\u2019]*\u2019|(?<=^|[\s([])'[^']*'(?=$|[\s).,;:\]])/g;

function withoutQuotedText(text: string): string {
  return text.replace(QUOTED_SPAN, " ");
}
