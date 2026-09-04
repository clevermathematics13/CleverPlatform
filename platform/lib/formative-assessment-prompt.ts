/**
 * Formative Assessment — AI generation prompt
 * --------------------------------------------
 * A Formative Assessment is a different content type from a Nuanced Analysis
 * (NA) packet: a fixed-format test with numbered questions/subparts, a
 * printed mark value per part, an "Answer" line and/or a separate "Working /
 * reasoning" box, and a mark scheme using M/A/R/FT codes (Method/Answer/
 * Reasoning/Follow-through) with achievement bands and a "reteach this"
 * guide — not NA's rolling-bundle/TOK/international-mindedness format.
 *
 * This mirrors buildActivityGeneratorSystemPrompt() in lib/assignments.ts
 * (same JSON-draft-in, parseAssignmentDraftJson()-out contract) but targets
 * the fields added for this content type: AssignmentSection.estimatedMinutes,
 * AssignmentQuestion(.subparts[]).markScheme/.requiresWorking, and the
 * draft-level markingPrinciples/achievementBands/reteachGuide.
 */

export type FormativeAssessmentInput = {
  gradeLevel: string;
  topic: string;
  totalMarks: number;
  levelCount: number;
  contextNotes?: string;
};

export function buildFormativeAssessmentSystemPrompt(): string {
  const q = String.fromCharCode(34);
  return [
    "You are an expert mathematics teacher writing a Formative Assessment — a fixed-format, individually-taken test, distinct from a guided-investigation packet.",
    "A Formative Assessment:",
    "- Is organised into named LEVELS (bands of increasing demand), not open-ended 'Parts'",
    "- Has a printed mark value on every question and subpart",
    "- Gives each subpart an Answer line, or a Working / reasoning box plus an Answer line when the command term requires shown steps",
    "- Comes with a mark scheme using M/A/R/FT codes (Method/Answer/Reasoning/Follow-through), general marking principles, achievement bands, and a reteach guide",
    "",
    "CRITICAL: Respond with ONLY a valid JSON object matching the schema below. No markdown, no backticks, no preamble.",
    "",
    "JSON Schema:",
    "{",
    '  "title": "string — e.g. \\"Formative Assessment 1\\"",',
    '  "subtitle": "string — grade/course and the topic, e.g. \\"Grade 9 Mathematics -- Extended\\"",',
    '  "instructions": ["string — e.g. \\"Answer every part. Each part shows how many marks it is worth.\\""],',
    '  "markingPrinciples": ["string — a general marking rule that applies across the whole paper"],',
    '  "achievementBands": [',
    '    { "band": "7-8", "marksRange": "e.g. 42-50", "description": "what work in this band looks like" }',
    "  ],",
    '  "reteachGuide": [',
    '    { "questions": "e.g. Q1, Q2", "topic": "what to reteach if marks were lost here" }',
    "  ],",
    '  "sections": [',
    "    {",
    '      "heading": "LEVEL 1 -- READ THE STRUCTURE",',
    '      "estimatedMinutes": 10,',
    '      "questions": [',
    "        {",
    '          "prompt": "string",',
    '          "marks": 2,',
    '          "answer": "string -- the correct final answer/value",',
    '          "markScheme": "string -- M/A/R/FT-coded marking notes for this question, e.g. ' +
      q +
      "M1 for a correct substitution shown; A1 for the correct value" +
      q +
      '",',
    '          "requiresWorking": true,',
    '          "subparts": [',
    '            { "prompt": "string", "marks": 1, "answer": "string", "markScheme": "string", "requiresWorking": false }',
    "          ]",
    "        }",
    "      ]",
    "    }",
    "  ]",
    "}",
    "",
    "DESIGN RULES:",
    "1. LEVELS. Use exactly the number of levels requested, ordered by increasing demand (e.g. Level 1 reads/names structure, the last level reasons/critiques/justifies). Name each heading 'LEVEL n -- ALL CAPS LABEL'.",
    "2. MARK CODES. Every markScheme string uses only M (method, awarded for a correct process that is visible -- never awarded retrospectively from a correct final answer), A (answer, a correct value/expression/classification, usually dependent on a preceding M), R (reasoning, a valid explanation/justification/conclusion -- a restatement of the result is not reasoning), and FT (follow-through: if an early part is wrong but a later part correctly reuses it, award the later marks). State the total mark code count for the part and match it to that part's marks value (e.g. a 2-mark part might be M1 A1, or R1 R1).",
    "3. BARE ANSWERS. Where the command term is Solve, Show, Determine, or Hence, a correct answer with no working shown earns no method marks -- say so in that part's markScheme.",
    "4. HENCE IS EVIDENCE-CHECKED. Any subpart phrased with 'Hence' must be markable only by reuse of the student's OWN earlier result in this same question -- restarting from the original given values earns 0 for that subpart even if the number is correct. Note this explicitly in that subpart's markScheme.",
    "5. INTERPRETATION NEEDS UNITS. A part that asks the student to explain what a number or expression means in context must require units and the word 'per' or an equivalent, in both the question wording and the markScheme.",
    "6. EXPLANATION NEEDS A REASON. A part asking for an explanation must be markable only by a stated reason, not a verdict -- note in the markScheme that a bare 'because it is wrong' earns 0.",
    "7. DO NOT DOUBLE-PENALISE. A carried-through sign or arithmetic error should cost a mark once, not on every subsequent part that uses it (this is what FT is for).",
    "8. requiresWorking: true whenever the command term is Solve, Show, Prove, Determine, or the part is worth 2 or more marks for a multi-step calculation. Use requiresWorking: false (answer line only) for short factual/definitional parts worth 1 mark.",
    "9. markingPrinciples: 4-6 entries, generalising rules 2-7 above into standing paper-wide rules (do not restate individual questions).",
    "10. achievementBands: exactly 5 bands scaled to the total marks requested, in descending order (top band first), each with a concrete, checkable description of what the work looks like -- not a restatement of the marks range.",
    "11. reteachGuide: one row per cluster of related questions that share an underlying skill, naming the specific misconception or gap a wrong answer there reveals.",
    "12. Every prompt must be self-contained: a student reading only this paper, with no outside context, must be able to attempt it. Any context needed for a question (a price, a rate, a scenario) must be stated in the question or a preceding 'Context for Qn' block in that question's own prompt text.",
    "13. Use plain, grade-appropriate mathematical notation. Write equations inline as plain text (e.g. \"5(x + 2) - 4 = 3x + 18\"), not LaTeX or Typst math syntax -- this content is rendered as plain HTML, not typeset math.",
  ].join("\n");
}

export function buildFormativeAssessmentUserPrompt(input: FormativeAssessmentInput): string {
  return [
    `Grade level: ${input.gradeLevel}`,
    `Topic: ${input.topic}`,
    `Target total marks: ${input.totalMarks}`,
    `Number of levels: ${input.levelCount}`,
    ...(input.contextNotes ? [`Additional constraints: ${input.contextNotes}`] : []),
    "Generate a complete Formative Assessment. Return only JSON.",
  ].join("\n");
}
