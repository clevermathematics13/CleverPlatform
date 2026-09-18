/**
 * Math Medic Lesson 1.1 - Equations that Describe Patterns (Exploration).
 *
 * The first activity through the Exploration/homework route, transcribed from
 * the two PDFs the teacher supplied: the blank worksheet and the annotated
 * answer key. Callie's Catering Company on page 1 (8 questions), Check Your
 * Understanding on page 2 (2 questions, 4 parts).
 *
 * TWO THINGS ABOUT THE TRANSCRIPTION, both forced by the source:
 *
 * 1. Page 2 restarts its numbering at 1, which would collide with page 1 on
 *    test_items' unique (test_id, question_number, part_label). The Check Your
 *    Understanding questions are therefore carried as Q9 and Q10, and each one
 *    says so in its own question text so the marker and the teacher both know
 *    which printed question it is.
 *
 * 2. The worksheet prints no marks anywhere, because it is not a mark-bearing
 *    paper. The 1s and 2s here are the plumbing lib/activity-rubric.ts
 *    describes, chosen so that each part's two tokens are two genuinely
 *    separable ideas (the chairs column and the tablecloths column; the
 *    substitution and the value). A part with only one idea in it is worth 1.
 *
 * The three LEARNING TARGETS are the lesson's own, read off the QuickNotes box
 * on page 2 of the key, not invented here.
 *
 * This is the fixture the activity-rubric tests pin their thresholds to. It is
 * NOT read at runtime: the live copy is the tests / test_items rows plus
 * tests.activity_rubric, editable on the test's detail page.
 */

import type { ActivityRubric } from "../activity-rubric";
import { DEFAULT_OUTCOME_BANDS } from "../activity-rubric";

export interface ActivitySeedItem {
  questionNumber: number;
  partLabel: string;
  maxMarks: number;
  questionText: string;
  /** What having the idea looks like. Not a token list -- see the marking policy. */
  markschemeText: string;
}

export const EXPLORATION_1_1_NAME = "Exploration 1.1 - Equations that Describe Patterns";
export const EXPLORATION_1_1_SHORT_NAME = "Exp1.1";
export const EXPLORATION_1_1_LESSON = "1.1";
export const EXPLORATION_1_1_TOTAL_MARKS = 20;

const CATERING_CONTEXT =
  "Callie's Catering Company prepares for an event by setting up tables and chairs. Each table is set with 8 chairs. Callie always brings three extra tablecloths than what she needs for the tables.";

const CANDY_CONTEXT =
  "Kasey noticed that the distribution of candy bars in the variety bags of candy bars is always the same. There are three times as many Twix bars as Milky Ways. There are 5 fewer Snickers than there are Twix.";

const TEMPERATURE_CONTEXT =
  "While the U.S. measures temperature in degrees Fahrenheit, much of the world uses the Celsius scale. If $C$ is the temperature in degrees Celsius and $F$ is the temperature in degrees Fahrenheit, then $C = \\frac{5}{9}(F - 32)$.";

export const EXPLORATION_1_1_ITEMS: ActivitySeedItem[] = [
  {
    questionNumber: 1,
    partLabel: "",
    maxMarks: 2,
    questionText: `${CATERING_CONTEXT} Callie needs to make a spreadsheet so that her crew will know what to bring to each event. Help her fill out the missing information. The table has a row for 1, 2, 3, 4, 5 and 6 tables, and columns for Chairs and Tablecloths.`,
    markschemeText:
      "Both columns filled from the context. Chairs: 8, 16, 24, 32, 40, 48. Tablecloths: 4, 5, 6, 7, 8, 9. One mark for the chairs column, one for the tablecloths column. A column with one slip in it but the right rule running through it still shows the idea -- award the mark and say which cell is wrong.",
  },
  {
    questionNumber: 2,
    partLabel: "",
    maxMarks: 2,
    questionText: "What patterns do you notice in the table?",
    markschemeText:
      "One mark for the chairs pattern: they go up by 8 each time, because each extra table brings 8 more chairs. One mark for the tablecloths pattern: always 3 more than the number of tables, and they go up by 1 each time. Any wording that says the thing earns the mark; naming the constant difference without saying why still earns it at this stage.",
  },
  {
    questionNumber: 3,
    partLabel: "",
    maxMarks: 2,
    questionText: "If Callie brings 11 tables, how many chairs will she bring? How many tablecloths will she bring?",
    markschemeText:
      "One mark for 88 chairs ($11 \\times 8$). One mark for 14 tablecloths ($11 + 3$). Working need not be shown -- a correct value is evidence the student can apply the rule.",
  },
  {
    questionNumber: 4,
    partLabel: "",
    maxMarks: 2,
    questionText: "If Callie brings 120 chairs, how many tables will she bring? How many tablecloths?",
    markschemeText:
      "One mark for 15 tables ($120 \\div 8$). One mark for 18 tablecloths ($15 + 3$). This part runs the chairs rule backwards, so a student who multiplied instead of dividing has not got it; a student who divided correctly and then slipped on the tablecloths has half of it.",
  },
  {
    questionNumber: 5,
    partLabel: "",
    maxMarks: 2,
    questionText: "If Callie brings 16 tablecloths, how many tables will she bring? How many chairs?",
    markschemeText:
      "One mark for 13 tables ($16 - 3$). One mark for 104 chairs ($13 \\times 8$). Follow-through applies: a student who subtracted wrongly in the first half but then correctly multiplied their own number of tables by 8 earns the second mark.",
  },
  {
    questionNumber: 6,
    partLabel: "",
    maxMarks: 1,
    questionText:
      "Write an equation that shows the relationship between the number of tables, $t$, and the number of chairs, $c$.",
    markschemeText:
      "$c = 8t$, or any correct rearrangement: $\\frac{c}{8} = t$, $t = \\frac{c}{8}$, $8t = c$. The mark is for the relationship, not the arrangement.",
  },
  {
    questionNumber: 7,
    partLabel: "",
    maxMarks: 1,
    questionText:
      "Write an equation that shows the relationship between the number of tables, $t$, and the number of tablecloths, $b$.",
    markschemeText:
      "$b = t + 3$, or any correct rearrangement: $b - 3 = t$, $t = b - 3$. The mark is for the relationship, not the arrangement.",
  },
  {
    questionNumber: 8,
    partLabel: "",
    maxMarks: 2,
    questionText:
      "Write an equation that shows the relationship between the number of tablecloths, $b$, and the number of chairs, $c$.",
    markschemeText:
      "One mark for getting from tablecloths to tables, $b - 3 = t$, anywhere in the work -- this is the substitution the whole question turns on. One mark for a correct equation in $b$ and $c$ alone: $c = 8(b - 3)$, or the expanded $c = 8b - 24$, or $\\frac{c}{8} + 3 = b$, or $\\frac{c}{8} = b - 3$. A student who writes $c = 8b$ has not eliminated the 3 and earns neither mark.",
  },
  {
    questionNumber: 9,
    partLabel: "a",
    maxMarks: 2,
    questionText: `Check Your Understanding, question 1(a). ${CANDY_CONTEXT} Determine the quantity of each candy in the small, medium, and large variety bags. The table gives Milky Ways = 8 for the small bag, Twix = 30 for the medium bag, and Snickers = 37 for the large bag; the other six cells are blank.`,
    markschemeText:
      "One mark for using \"three times as many Twix as Milky Ways\" correctly throughout: small Twix 24, medium Milky Ways 10, large Milky Ways 14. One mark for using \"5 fewer Snickers than Twix\" correctly throughout: small Snickers 19, medium Snickers 25, large Twix 42. Award each mark on the relationship being applied in the right direction, not on all three cells being arithmetically perfect.",
  },
  {
    questionNumber: 9,
    partLabel: "b",
    maxMarks: 1,
    questionText:
      "Check Your Understanding, question 1(b). Write an equation that relates the number of Milky Ways, $M$, and the number of Snickers, $S$, for any variety bag.",
    markschemeText:
      "$3M - 5 = S$, or any correct rearrangement: $S = 3M - 5$, $S + 5 = 3M$, $\\frac{S + 5}{3} = M$. The mark is for composing the two given relationships into one; an equation relating $S$ to Twix rather than to $M$ has not composed them.",
  },
  {
    questionNumber: 10,
    partLabel: "a",
    maxMarks: 2,
    questionText: `Check Your Understanding, question 2(a). ${TEMPERATURE_CONTEXT} If an American recipe states to preheat the oven to 425 degrees Fahrenheit, how many degrees would this be in degrees Celsius?`,
    markschemeText:
      "One mark for substituting and subtracting first: $425 - 32 = 393$. One mark for $\\frac{5}{9}(393) = 218.33$ degrees Celsius (accept 218.3, $218\\frac{1}{3}$, or $\\frac{655}{3}$). A student who multiplied by $\\frac{5}{9}$ before subtracting 32 has the order of operations wrong and earns neither mark, however tidy the arithmetic.",
  },
  {
    questionNumber: 10,
    partLabel: "b",
    maxMarks: 1,
    questionText:
      "Check Your Understanding, question 2(b). Describe in words the relationship between a temperature given in degrees Fahrenheit and its corresponding temperature in degrees Celsius.",
    markschemeText:
      "A description that carries both operations and their order: a temperature in Celsius is five-ninths of (the Fahrenheit temperature less 32). Accept any wording that makes the subtraction happen first. A description naming only one of the two operations, or one that puts them the wrong way round, does not earn the mark.",
  },
];

/**
 * The lesson's own learning targets, from the QuickNotes box on page 2 of the
 * key. Q10(b) feeds two of them: describing the Fahrenheit-to-Celsius
 * relationship in words is both a relationship between variables (LT1) and a
 * statement of the operations that relate them (LT2).
 */
export const EXPLORATION_1_1_RUBRIC: ActivityRubric = {
  version: 1,
  kind: "exploration",
  source: "Math Medic Lesson 1.1 answer key, QuickNotes",
  lesson: EXPLORATION_1_1_LESSON,
  bands: DEFAULT_OUTCOME_BANDS,
  targets: [
    {
      code: "LT1",
      name: "Look for relationships between variables",
      note: 'Reads "more than", "less than", "__ times greater" and "fewer" as relationships between two quantities.',
      parts: ["1", "2", "9a", "10b"],
    },
    {
      code: "LT2",
      name: "Use operations to describe a relationship between variables",
      note: "Uses +, -, x and division to write the relationship, and knows it can be written in more than one way.",
      parts: ["6", "7", "8", "9b", "10b"],
    },
    {
      code: "LT3",
      name: "Evaluate an expression by substituting a value for a variable",
      note: "Substitutes a value in for a variable and applies the order of operations (PEMDAS).",
      parts: ["3", "4", "5", "10a"],
    },
  ],
};
