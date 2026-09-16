/**
 * Assessment — AI generation prompt
 * ---------------------------------
 * An assessment is a different content type from a Nuanced Analysis (NA)
 * packet: a fixed-format test with numbered questions/subparts, a printed mark
 * value per part, an "Answer" line and/or a separate "Working / reasoning"
 * box, and a mark scheme using M/A/R/FT codes (Method/Answer/Reasoning/
 * Follow-through) with a "reteach this" guide — not NA's rolling-bundle/TOK/
 * international-mindedness format.
 *
 * FORMATIVE OR SUMMATIVE. One prompt, because a summative is not a different
 * document: same LEVEL bands, same mark codes, same marking principles. What
 * changes is what the paper is FOR, and the handful of rules that follow from
 * it — exam conditions, no hints, coverage across the whole topic rather than
 * a diagnostic probe at one skill. Those are folded in below rather than
 * written as a second prompt file, which would drift from this one the first
 * time a mark-code rule was tightened in only one of them.
 *
 * This mirrors buildActivityGeneratorSystemPrompt() in lib/assignments.ts
 * (same JSON-draft-in, parseAssignmentDraftJson()-out contract) but targets
 * the fields added for this content type: AssignmentSection.estimatedMinutes,
 * AssignmentQuestion(.subparts[]).markScheme/.requiresWorking, and the
 * draft-level markingPrinciples/reteachGuide.
 */

import type { AssessmentKind } from "./assessment-kind";
import type { CalculatorPolicy } from "./assignments";
import { calculatorPolicyLabel } from "./exam-conditions";
import { mathematicalRegisterBlock } from "./mathematical-register";

export type FormativeAssessmentInput = {
  gradeLevel: string;
  topic: string;
  totalMarks: number;
  levelCount: number;
  contextNotes?: string;
  /** Defaults to formative, which is what every caller meant before this existed. */
  kind?: AssessmentKind;
  /**
   * The exam conditions, on a summative only.
   *
   * They print on the cover either way (lib/exam-conditions.ts). What they do
   * HERE is constrain what the paper may ask. A cover that says no calculator
   * over a question that cannot be answered without one is a paper that cannot
   * be sat -- and the teacher chose that rule BEFORE pressing Generate, which
   * is the whole reason the control sits above the button.
   *
   * Both are dropped for a formative, whose cover carries no conditions
   * (applyKindFormatting clears them), so a formative's prompt is unchanged
   * from what it was before any of this existed.
   */
  calculatorPolicy?: CalculatorPolicy;
  timeAllowedMinutes?: number;
};

export function buildFormativeAssessmentSystemPrompt(kind: AssessmentKind = "formative"): string {
  const summative = kind === "summative";
  const q = String.fromCharCode(34);
  return [
    summative
      ? "You are an expert mathematics teacher writing a SUMMATIVE assessment — a fixed-format, individually-taken paper sat under exam conditions, whose mark is reported as the student's grade for this unit. It is not practice. It is the record."
      : "You are an expert mathematics teacher writing a FORMATIVE assessment — a fixed-format, individually-taken test, distinct from a guided-investigation packet. Its purpose is to show the teacher what to teach next.",
    "The paper:",
    "- Is organised into named LEVELS (bands of increasing demand), not open-ended 'Parts'",
    "- Has a printed mark value on every question and subpart",
    "- Gives each subpart an Answer line, or a Working / reasoning box plus an Answer line when the command term requires shown steps",
    "- Comes with a mark scheme using M/A/R/FT codes (Method/Answer/Reasoning/Follow-through), general marking principles, and a reteach guide",
    "",
    "CRITICAL: Respond with ONLY a valid JSON object matching the schema below. No markdown, no backticks, no preamble.",
    "",
    "JSON Schema:",
    "{",
    '  "title": "string — e.g. \\"Formative Assessment 1\\"",',
    '  "subtitle": "string — grade/course and the topic, e.g. \\"Grade 9 Mathematics -- Extended\\"",',
    '  "instructions": ["string — e.g. \\"Answer every part. Each part shows how many marks it is worth.\\""],',
    '  "markingPrinciples": ["string — a general marking rule that applies across the whole paper"],',
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
    "10. reteachGuide: one row per cluster of related questions that share an underlying skill, naming the specific misconception or gap a wrong answer there reveals.",
    "11. Every prompt must be self-contained: a student reading only this paper, with no outside context, must be able to attempt it. Any context needed for a question (a price, a rate, a scenario) must be stated in that question's own prompt text, as an opening sentence -- NOT as a 'Context for Qn' label. Never write a question number into a prompt: the renderer numbers questions by position within their level (2.1, 2.2), so any number you write will disagree with the one printed. To point at an earlier part, name its letter: \"your expression from part (a)\".",
    "12. NOTATION IS LATEX. Wrap every mathematical expression in single dollars for inline maths, e.g. $-9k^2 + 5k - \\sqrt{7}$ and $\\frac{96 - v}{6}$; use double dollars only for a displayed equation on its own line. It is typeset with KaTeX (lib/document-orchestrator.ts renderMath), so write \\sqrt{7}, \\frac{a}{b}, x^{2} and \\neq rather than sqrt(7), a/b or !=. Prose stays outside the dollars.",
    "13. SIZE THE ANSWER SPACE TO THE ANSWER. Every subpart takes answerBoxLines. Use 1 for a single word, value or expression; 2-3 for a sentence of interpretation or a one-step calculation; 4-6 for a multi-step solution, a rearrangement or a proof. A part that asks for one number and offers six ruled lines is telling the student it wants six lines of something.",
    "14. DO NOT NUMBER YOUR OWN SUBPARTS. The renderer prints (a), (b), (c) beside each subpart from its position. A prompt that begins \"(a) ...\" is printed as \"(a) (a) ...\".",
    "15. SAY WHERE THE ANSWER GOES, ONCE AND TRUTHFULLY. A line marked Answer is printed ONLY under a part with requiresWorking: true. So do not write instructions promising 'the line marked Answer' unless every part has one. 'Write your final answer in the space provided, and on the Answer line where one is given' is true of any paper.",
    "16. ASK FOR WHAT YOU WILL MARK. A part that follows one which substituted particular values, and then asks for 'an expression', must say 'in terms of x and y' -- otherwise a reasonable student cannot tell whether you want the general form or the value they just computed. The same discipline everywhere: if two readings of a prompt are both reasonable, one of them will be marked wrong for a reason that is not mathematical. A part that quotes a wrong claim is where this bites hardest: 'explain why the student is wrong' is answered by ANY demonstration that they are, so a scheme wanting the true value named AND the reason given has to ask for both -- 'state the single percentage reduction the two discounts actually give, and describe the mistake in the student's reasoning'. Name the mistake as the thing to be described; do not settle for a verdict on it.",
    "17. NAME WHAT A STUDENT CAN NAME. Asking to 'name the property used on each line' invites a dispute, because 'combine like terms' is an operation rather than a formally named property even though it is the distributive property underneath. Ask for 'the property or operation used on each line' and say in the mark scheme which answers are accepted for each step.",
    "18. A CONTEXT MUST SAY WHO PAYS, WHO SHARES, AND WHAT IS INCLUDED. 'The students share the entire cost' leaves a student wondering whether the teachers' admission is in it. Spell the scope out: 'the n students share the entire cost -- admission for the students and the teachers, and the bus -- equally between them.' Ambiguity in a context is marked as a mathematical error, which it is not.",
    "19. A LEVEL HEADING IS A LABEL, NOT AN INSTRUCTION. 'Expand, simplify and factor' reads as three things to do to every part. Name the skill instead: 'ALGEBRAIC MANIPULATION'. The same for a question stem that introduces subparts -- it sets the scene, it does not issue the commands.",
    "20. TIME IS A BUDGET, NOT A TOTAL. The estimatedMinutes across the levels must come to about EIGHTY PER CENT of the time allowed, not all of it: a student needs the rest for reading, being stuck, page-turning and checking. Count explanation parts at roughly twice a computation of the same marks -- writing a reason takes longer than writing a value -- and if a paper will not fit, cut explanation parts rather than shortening the ramp.",
    "",
    mathematicalRegisterBlock(),
    ...(summative
      ? [
          "",
          "THIS PAPER IS SUMMATIVE. The rules above all still hold. These are on top of them:",
          "S1. NO HINTS. Never emit a hint field, on a question or a subpart. A hint on a paper that counts is marks given away, and this one is printed exactly as you write it.",
          "S2. COVER THE TOPIC, do not probe one corner of it. A formative may spend three questions on the single misconception the teacher is chasing; this paper has to let a student demonstrate the whole unit, so spread the marks across its distinct skills and name each level's skill in its heading.",
          "S3. EVERY MARK MUST BE DEFENSIBLE TO A PARENT. A part whose mark scheme depends on a marker's taste does not belong here. If a part cannot be marked the same way by two teachers reading only the markScheme string, rewrite the part.",
          "S4. NO NEW NOTATION OR CONTEXT. A summative may not be the first place a student meets a form of words, a symbol or a scenario. Use only what the unit has already taught.",
          "S5. THE RAMP STILL APPLIES, and it matters more here: the first level must be genuinely accessible to the weakest student sitting the paper, so that a mark of zero means something went wrong rather than that the paper started above them.",
          "S6. INSTRUCTIONS ARE EXAM INSTRUCTIONS. Write `instructions` for a student sitting under exam conditions -- what to do with working, what to do if they need more space, what happens if they cannot answer a part. Do NOT write the calculator rule, the time allowed or the total marks into instructions: those are printed on the cover from the teacher's own settings, and a second copy is one that can disagree with it.",
          "S7. THE CALCULATOR RULE IS A CONSTRAINT, NOT A NOTE. The user message states what the student may use, and every question must be answerable under exactly that rule. With no calculator: every value a student has to produce must be reachable by hand, so keep the arithmetic to integers and simple decimals, ask for exact forms (fractions, surds) rather than decimal evaluations, and never set a part whose method is \"enter it and read the display\". With a calculator permitted: the marks must still be for method, reasoning or interpretation -- a part that is only keystrokes is not worth a mark on a paper that counts.",
          "S8. THE PAPER MUST FIT THE TIME. Where the user message gives a time allowed, the estimatedMinutes across all levels must sum to no more than it, and should leave a few minutes for reading and checking. A paper that cannot be finished in the time printed on its own cover measures speed, not mathematics.",
        ]
      : []),
  ].join("\n");
}

export function buildFormativeAssessmentUserPrompt(input: FormativeAssessmentInput): string {
  const summative = input.kind === "summative";
  return [
    `Grade level: ${input.gradeLevel}`,
    `Topic: ${input.topic}`,
    `Target total marks: ${input.totalMarks}`,
    `Number of levels: ${input.levelCount}`,
    // The teacher's own cover settings, as constraints -- see S7 and S8, and
    // the note on FormativeAssessmentInput. Raw minutes rather than
    // formatTimeAllowed's "1 hour 15 minutes": this number is arithmetic the
    // model has to do against estimatedMinutes, not a line on a cover.
    ...(summative && input.calculatorPolicy
      ? [`Calculator: ${calculatorPolicyLabel(input.calculatorPolicy)}`]
      : []),
    ...(summative && input.timeAllowedMinutes
      ? [`Time allowed: ${input.timeAllowedMinutes} minutes`]
      : []),
    ...(input.contextNotes ? [`Additional constraints: ${input.contextNotes}`] : []),
    input.kind === "summative"
      ? "Generate a complete summative assessment. Return only JSON."
      : "Generate a complete Formative Assessment. Return only JSON.",
  ].join("\n");
}
