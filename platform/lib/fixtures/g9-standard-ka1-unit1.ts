/**
 * Grade 9 Standard Level, Key Assessment 1, Unit 1 (14-15 September 2026).
 *
 * The first Standard Level summative, transcribed from the two PDFs the
 * teacher supplied: the paper (9 questions, 26 parts, 42 marks, 60 minutes,
 * calculator permitted) and the Teacher Marking Rubric (four strands, level
 * bands at about 85 / 65 / 40 per cent, a part-by-part map). Each part's
 * `markschemeText` is the rubric's own "a full-mark response shows..." line
 * plus the answer, with marking notes drawn from the rubric's level
 * descriptors where a part is worth more than one mark.
 *
 * This is the fixture the standards-rubric tests pin their thresholds to,
 * and the source the seed migration for the live test was written from. It
 * is NOT read at runtime: the live copy is the tests / test_items rows plus
 * tests.standards_rubric, editable on the test's detail page.
 *
 * A multi-part question's shared lead-in (the sequence, the scenario) is
 * `stemText`, identical on every part, and `questionText` is the part's own
 * wording -- the shape of test_items.stem_text / question_text since
 * migration 20260924024538 (ka1_unit1_split_stems). The seed had pasted the stem
 * into every part's text; lib/ai-grading.ts composeQuestionText joins the
 * two back together, so what the marker reads is unchanged. Q1's lead-in
 * ("Evaluate ... Show all work.") stays in each part on purpose: it is the
 * command each part's mark depends on, and rule A6 of
 * lib/ask-what-you-mark.ts says a demand made only in a stem does not carry
 * into a part.
 */

import type { StandardsRubric } from "../standards-rubric";

export interface SeedItem {
  questionNumber: number;
  partLabel: string;
  maxMarks: number;
  /** The question's shared lead-in for a lettered part, null for a whole-question item or a question with no shared lead-in. */
  stemText: string | null;
  questionText: string;
  markschemeText: string;
}

export const KA1_UNIT1_NAME = "Key Assessment 1 - Unit 1";
export const KA1_UNIT1_SHORT_NAME = "KA1";
export const KA1_UNIT1_DATE = "2026-09-14";
export const KA1_UNIT1_TOTAL_MARKS = 42;

const Q2_SEQUENCE = "Consider the sequence: position 1, 2, 3, 4, 5, ... has terms 88, 82, 76, 70, 64, ...";
const Q3_SEQUENCE =
  "Consider the alternating sequence: position 1, 2, 3, 4, 5, 6, 7, ... has terms 12, 11, 15, 14, 18, 17, 21, ...";
const Q4_CONTEXT =
  "Maya buys a city commuter bus pass. The pass card costs a one-time fee of $10, paid in week 1. She then pays $4 per day to ride the bus on weekdays (Mon-Fri; no bus Sat or Sun).";
const Q6_SEQUENCE =
  "Consider the repeating sequence: position 1, 2, 3, 4, 5, 6, 7, 8, 9, ... has terms $-3, 0, 3, -3, 0, 3, -3, 0, 3, \\ldots$ (the block $-3, 0, 3$ repeats forever).";
const Q7_CONTEXT =
  "The 84 students in fifth grade are gathering in the auditorium. The teachers choose $x$ students to perform a skit, and then split the remaining students into equal groups of 5 for a project activity.";
// The live Q9 stem since 20260918123826: it describes the printed figures
// and says nothing about how they grow, because the earlier wording stated
// the answer to part (a) and the grader marked on its vocabulary.
const Q9_CONTEXT =
  "Look at the pattern made from arrangements of $1 \\times 1$ square tiles. [Marker's note, describing the figures PRINTED on the paper. The student read no such sentence, so none of its words are required in any answer: Figure 1 is a row of 3 tiles with 1 further tile meeting the row at its centre (4 tiles); Figure 2 is a row of 5 with a line of 2 (7 tiles); Figure 3 is a row of 7 with a line of 3 (10 tiles).]";

export const KA1_UNIT1_ITEMS: SeedItem[] = [
  // -- Q1: evaluate expressions [3] ------------------------------------------
  {
    questionNumber: 1,
    partLabel: "a",
    maxMarks: 1,
    stemText: null,
    questionText: "Evaluate the algebraic expression for the given variable value. Show all work. $4m + 2(m - 5)$ when $m = 3$.",
    markschemeText:
      "A full-mark response shows correct substitution and evaluation with brackets: $4(3) + 2(3 - 5) = 12 + 2(-2) = 12 - 4 = 8$. Answer: 8. The substitution must be shown; a bare 8 with no substitution does not earn the mark.",
  },
  {
    questionNumber: 1,
    partLabel: "b",
    maxMarks: 1,
    stemText: null,
    questionText:
      "Evaluate the algebraic expression for the given variable value. Show all work. $\\frac{1}{2}t^2 - 5t$ when $t = 6$.",
    markschemeText:
      "A full-mark response squares first, then halves: $\\frac{1}{2}(36) - 30 = 18 - 30 = -12$. Answer: $-12$. Halving 6 before squaring ($9 - 30 = -21$) is the order-of-operations error the rubric names and earns 0.",
  },
  {
    questionNumber: 1,
    partLabel: "c",
    maxMarks: 1,
    stemText: null,
    questionText:
      "Evaluate the algebraic expression for the given variable value. Show all work. $-3(w + 4) - 5w$ when $w = -4$.",
    markschemeText:
      "A full-mark response shows correct signs with a negative input: $-3(-4 + 4) - 5(-4) = -3(0) + 20 = 20$. Answer: 20. A sign slip (for example $-20$ or $0$) earns 0.",
  },
  // -- Q2: arithmetic sequence 88, 82, 76, ... [6] ----------------------------
  {
    questionNumber: 2,
    partLabel: "a",
    maxMarks: 1,
    stemText: Q2_SEQUENCE,
    questionText: "Describe the sequence in words, including the first term and how it changes.",
    markschemeText:
      "A full-mark response gives how the sequence changes: it goes down by 6 each term (a change of $-6$). The question asks for the first term as well, and \"starts at 88 and goes down by 6\" is the complete description, but the mark is for the change: \"it goes down by 6\" earns it on its own, in any wording, and so does a correct change of $-6$ given with a wrong first term. \"Starts at 88\" alone, a change of the wrong size or sign (\"goes up by 6\", \"subtracts 8\"), or only continuing the list of terms ($88, 82, 76, 70, 64, 58, \\ldots$) earns 0.",
  },
  {
    questionNumber: 2,
    partLabel: "b",
    maxMarks: 2,
    stemText: Q2_SEQUENCE,
    questionText: "Write an explicit rule to find the $n$th term in the sequence.",
    markschemeText:
      "A full-mark response gives a correct explicit rule: $94 - 6n$ (accept any equivalent, e.g. $88 - 6(n - 1)$ or $-6n + 94$). 2 marks: one for the structure (a linear rule in $n$ with the common difference $-6$ as the coefficient), one for the correct constant so the rule gives 88 at $n = 1$. An off-by-one rule such as $88 - 6n$ earns 1 (correct difference, wrong starting value). A recursive description (\"subtract 6 each time\") is not an explicit rule and earns 0.",
  },
  {
    questionNumber: 2,
    partLabel: "c",
    maxMarks: 1,
    stemText: Q2_SEQUENCE,
    questionText: "What is the value of the 20th term?",
    markschemeText:
      "A full-mark response uses the rule for the 20th term: $94 - 6(20) = -26$. Answer: $-26$. Follow-through: award the mark for correctly evaluating the student's own rule from part (b) at $n = 20$, even if that rule was wrong. Listing out all 20 terms correctly also earns the mark.",
  },
  {
    questionNumber: 2,
    partLabel: "d",
    maxMarks: 2,
    stemText: Q2_SEQUENCE,
    questionText: "Is $-52$ a term of this sequence? Justify your answer.",
    markschemeText:
      "A full-mark response concludes that $-52$ is NOT a term because solving $94 - 6n = -52$ gives $n = 24.33\\ldots$ (or $146/6$), which is not a whole number, so no position has that value. 2 marks: one for a valid method that tests $-52$ against the rule (solving for $n$, or showing the terms around it: $-50$ at $n = 24$ and $-56$ at $n = 25$), one for the correct conclusion justified by that reasoning. A bare \"no\" with no reasoning earns 0; \"no, because it is not in the list\" without showing the neighbouring terms earns 0. Follow-through from an incorrect rule in part (b) applies if the reasoning is sound for that rule.",
  },
  // -- Q3: alternating sequence 12, 11, 15, 14, ... [4] ------------------------
  {
    questionNumber: 3,
    partLabel: "a",
    maxMarks: 1,
    stemText: Q3_SEQUENCE,
    questionText: "Describe the pattern or rule of the sequence in words.",
    markschemeText:
      "A full-mark response states the alternating rule: subtract 1, then add 4, repeating (accept \"down 1, up 4\" or \"every two terms it goes up by 3\" together with the alternation). \"It goes down and then up\" without the amounts earns 0.",
  },
  {
    questionNumber: 3,
    partLabel: "b",
    maxMarks: 1,
    stemText: Q3_SEQUENCE,
    questionText: "The 11th term of the sequence is 27. What is the 13th term? Show how you know.",
    markschemeText:
      "A full-mark response finds the 13th term from the 11th: from position 11 (odd, value 27) the next term is $27 - 1 = 26$ and then $26 + 4 = 30$, or equivalently two positions on is $+3$. Answer: 30, with the reasoning shown.",
  },
  {
    questionNumber: 3,
    partLabel: "c",
    maxMarks: 2,
    stemText: Q3_SEQUENCE,
    questionText: "Find the 40th term of the sequence. Show how you know.",
    markschemeText:
      "A full-mark response uses the structure of the sequence to find the 40th term: the even-position terms are 11, 14, 17, ... (start 11, add 3), so the 40th term is the 20th even term, $11 + 3(19) = 68$. Answer: 68. 2 marks: one for using the structure, one for the correct value. The structure mark is for any working that shows how the pattern moves: separating odd and even positions, a rule for the even positions, listing the terms, or the alternating step itself ($-1$ then $+4$, \"take away 1, then add 4\", written on the list or used to build the terms). It is earned even if the arithmetic then goes wrong. The value mark is for 68 only. So listing all 40 terms correctly earns both marks, and a list or pattern that shows the structure but goes off track earns 1.",
  },
  // -- Q4: bus pass [4] -------------------------------------------------------
  {
    questionNumber: 4,
    partLabel: "a",
    maxMarks: 1,
    stemText: Q4_CONTEXT,
    questionText: "Complete the table to show the TOTAL amount Maya has spent by the end of each week (assuming 5 commuting days per week): weeks 1 to 5.",
    markschemeText:
      "A full-mark response completes the table: 30, 50, 70, 90, 110 (week 1 is $10 + 5 \\times 4 = 30$, then $+20$ each week). All five values must be correct for the mark.",
  },
  {
    questionNumber: 4,
    partLabel: "b",
    maxMarks: 2,
    stemText: Q4_CONTEXT,
    questionText: "Write an explicit rule to find the total amount of money Maya has spent by the end of the $n$th week.",
    markschemeText:
      "A full-mark response gives a rule with the starting value: $20n + 10$ (accept equivalents such as $10 + 20n$ or $30 + 20(n - 1)$). 2 marks: one for the rate $20n$, one for the correct constant so the rule gives 30 at $n = 1$. A rule that leaves out the card fee ($20n$) or uses the weekly $+20$ wrongly earns 1 if the rate is right. Follow-through from part (a) applies.",
  },
  {
    questionNumber: 4,
    partLabel: "c",
    maxMarks: 1,
    stemText: Q4_CONTEXT,
    questionText: "How much money will Maya have spent in total by the end of 1 year (52 weeks)?",
    markschemeText:
      "A full-mark response uses the rule for 52 weeks: $20(52) + 10 = 1050$. Answer: \\$1050. Follow-through: award the mark for correctly evaluating the student's own rule from part (b) at $n = 52$.",
  },
  // -- Q5: two terms of an arithmetic sequence [4] ---------------------------
  {
    questionNumber: 5,
    partLabel: "",
    maxMarks: 4,
    stemText: null,
    questionText:
      "The 4th and 8th terms of an arithmetic sequence are 21 and 33, respectively. What is the first term of the sequence?",
    markschemeText:
      "A full-mark response finds the common difference from the two terms, then the first term: from position 4 to position 8 is 4 steps and $33 - 21 = 12$, so $d = 12 \\div 4 = 3$; then the first term is $21 - 3 \\times 3 = 12$. Answer: 12. 4 marks: one for recognising 4 steps between the 4th and 8th terms, one for the common difference 3, one for working back 3 steps from the 4th term (or forward from a rule), one for the first term 12. Counting 5 steps instead of 4 (giving $d = 2.4$) earns the first mark only if the step count is otherwise reasoned; a student who finds $d = 3$ but stops there earns 2. Follow-through applies to the first term for a wrong $d$ if the working back is correct.",
  },
  // -- Q6: repeating sequence -3, 0, 3 [6] -------------------------------------
  {
    questionNumber: 6,
    partLabel: "a",
    maxMarks: 1,
    stemText: Q6_SEQUENCE,
    questionText: "Find the sum of the first 3 terms.",
    markschemeText: "A full-mark response gives the sum of one cycle: $-3 + 0 + 3 = 0$. Answer: 0.",
  },
  {
    questionNumber: 6,
    partLabel: "b",
    maxMarks: 1,
    stemText: Q6_SEQUENCE,
    questionText: "Find the sum of the first 7 terms.",
    markschemeText:
      "A full-mark response gives the sum of the first 7 terms: two full cycles (sum 0) plus the 7th term $-3$, so $-3$. Answer: $-3$. Adding the seven terms directly and getting $-3$ also earns the mark.",
  },
  {
    questionNumber: 6,
    partLabel: "c",
    maxMarks: 1,
    stemText: Q6_SEQUENCE,
    questionText: "Find the sum of the first 8 terms.",
    markschemeText:
      "A full-mark response gives the sum of the first 8 terms: two full cycles plus $-3 + 0$, so $-3$. Answer: $-3$.",
  },
  {
    questionNumber: 6,
    partLabel: "d",
    maxMarks: 3,
    stemText: Q6_SEQUENCE,
    questionText: "The sum of the first $k$ terms is $-3$. What can you conclude about the value of $k$? Explain your reasoning.",
    markschemeText:
      "A full-mark response gives the general rule with reasons: each group of three terms adds to 0, so the sum of the first $k$ terms is 0 when $k$ is a multiple of 3, and $-3$ when $k$ is one or two more than a multiple of 3 (the leftover terms are $-3$, or $-3 + 0$). So $k$ is NOT a multiple of 3 (accept: $k$ leaves a remainder of 1 or 2 when divided by 3; $k = 3m + 1$ or $3m + 2$). 3 marks: one for the observation that each cycle of three sums to 0, one for identifying which leftover positions give $-3$ (the 1st or 2nd term of a cycle), one for the correct general conclusion about $k$ with that reason. Any conclusion stated in terms of multiples of 3 (groups of three, \"every third term\", dividing $k$ by 3) shows the three-term structure and earns the first two marks, even with nothing else written and even the wrong way round (\"$k$ must be a multiple of 3\"). The third mark needs the correct conclusion, that $k$ is NOT a multiple of 3, together with the reason: each cycle sums to 0 and the leftover terms are $-3$ or $-3 + 0$. So a bare \"$k$ is not a multiple of 3\" with no reasoning earns 2, a conclusion the wrong way round earns at most 2, and a response that only lists examples ($k = 1, 2, 4, 5, 7, 8$) without the general rule earns at most 2. A response that says nothing about threes earns the first two marks only if it shows that structure some other way.",
  },
  // -- Q7: 84 students, groups of 5 [5] ----------------------------------------
  {
    questionNumber: 7,
    partLabel: "a",
    maxMarks: 1,
    stemText: Q7_CONTEXT,
    questionText: "If 4 students are selected to perform the skit, how many groups will be needed for the remaining students?",
    markschemeText: "A full-mark response computes $(84 - 4) \\div 5 = 80 \\div 5 = 16$ groups. Answer: 16.",
  },
  {
    questionNumber: 7,
    partLabel: "b",
    maxMarks: 1,
    stemText: Q7_CONTEXT,
    questionText: "If 14 students are selected to perform the skit, how many groups will be needed for the remaining students?",
    markschemeText: "A full-mark response computes $(84 - 14) \\div 5 = 70 \\div 5 = 14$ groups. Answer: 14.",
  },
  {
    questionNumber: 7,
    partLabel: "c",
    maxMarks: 1,
    stemText: Q7_CONTEXT,
    questionText: "Write an algebraic expression to determine the number of groups needed if $x$ students are chosen for the skit.",
    markschemeText:
      "A full-mark response writes $(84 - x) \\div 5$ WITH the brackets (accept $\\frac{84 - x}{5}$). An expression missing its grouping, such as $84 - x \\div 5$, earns 0: the rubric names the missing brackets as the error.",
  },
  {
    questionNumber: 7,
    partLabel: "d",
    maxMarks: 2,
    stemText: Q7_CONTEXT,
    questionText: "Does your expression in part (c) yield a valid whole number of groups for all whole-number values of $x$? Explain.",
    markschemeText:
      "A full-mark response answers what was asked: NO, with mathematics behind it. Either route is complete on its own -- a counterexample worked through ($x = 5$ gives $79 \\div 5 = 15.8$, not a whole number), or the general reason ($84 - x$ has to be a multiple of 5, and it is not for every whole-number $x$). The question asks whether the expression works for all $x$, and for an explanation; it does NOT ask for the condition under which it does work, so do not require one. 2 marks: one for the conclusion NO reached from mathematics rather than asserted, one for the supporting reason being correct and complete. A student who gives both a counterexample and the condition has answered more than was asked, and earns 2, not more. A bare \"no\" earns 0, and \"no, because you never know what $x$ might be\" earns 0 -- neither contains any mathematics. \"No, it only works when $x$ is divisible by 5\" earns 1: the conclusion is right and divisibility is the right idea, but the condition is on the wrong quantity.",
  },
  // -- Q8: equivalent expressions [5] ------------------------------------------
  {
    questionNumber: 8,
    partLabel: "",
    maxMarks: 5,
    stemText: null,
    questionText:
      "Expression A, $3(x + k) + j(2x - 4)$, and Expression B, $11x + 5$, are equivalent. What must be the value of $j$ and $k$? Show your algebraic steps.",
    markschemeText:
      "The question asks for the values of $j$ and $k$ and for algebraic steps; it does not prescribe a method, so ANY valid algebraic route to $j = 4$, $k = 7$ earns all 5 marks. Route 1 (match coefficients): $3(x + k) + j(2x - 4) = 3x + 3k + 2jx - 4j = (3 + 2j)x + (3k - 4j)$; matching with $11x + 5$ gives $3 + 2j = 11$ so $j = 4$, and $3k - 4j = 5$ so $3k - 16 = 5$ and $k = 7$. Route 2 (substitute and verify): $3(x + 7) + 4(2x - 4) = 3x + 21 + 8x - 16 = 11x + 5$, which IS Expression B, so $j = 4$ and $k = 7$ are the values that make the two expressions equivalent. Route 2 is a complete algebraic argument and earns the same 5 marks as Route 1 - do not cap it, and do not call it guess-and-check. Answer: $j = 4$, $k = 7$. 5 marks: one for expanding both brackets correctly (either $3x + 3k + 2jx - 4j$, or $3x + 21 + 8x - 16$ once the values are substituted); one for collecting into a single linear expression (either $(3 + 2j)x + (3k - 4j)$, or $11x + 5$); one for $j = 4$; one for work connecting the constant terms (either $3k - 4j = 5$, or $21 - 16 = 5$); one for $k = 7$. Judge each of the five on its own evidence, whichever route the student took. A copying slip when restating Expression A - for example writing $4(6x - 4)$ but expanding it correctly as $8x - 16$ - is a notation slip, not an expansion error. Correct values with no working at all earn the two answer marks.",
  },
  // -- Q9: tile pattern [5] ----------------------------------------------------
  {
    questionNumber: 9,
    partLabel: "a",
    maxMarks: 2,
    stemText: Q9_CONTEXT,
    questionText: "Describe how the visual pattern is changing. You may use colours or symbols to support your description.",
    markschemeText:
      "A full-mark response describes the change well enough that a reader could draw the next figure: 3 tiles are added each time, one at each of the three growing ends -- the two ends of the row, and the far end of the line meeting it. 2 marks: one for the amount (3 tiles per figure, or 2 on one part and 1 on the other), one for WHERE the new tiles go. The question asks only for a description, so mark the content and not the vocabulary: \"one on the left, one on the right and one on the bottom\", \"two on each side and one below\", \"each arm grows by one\" and \"2 in the row, 1 in the column\" are the same answer, and each earns both marks. Do not require the words \"row\" or \"column\", and do not require the orientation to match this note -- which way the line runs is what the student sees on the page, not a mathematical claim. A description giving only the total change (\"it adds 3 each time\"), with nothing about where, earns 1. An annotated sketch showing the added tiles counts as description.",
  },
  {
    questionNumber: 9,
    partLabel: "b",
    maxMarks: 1,
    stemText: Q9_CONTEXT,
    questionText: "How many squares are in Figure 5? Explain how you know using your description from part (a). You may sketch on the grid.",
    markschemeText:
      "A full-mark response gives 16 squares, explained from the structure: Figure 3 has 10, so Figure 4 has 13 and Figure 5 has 16 (adding 3 each time), or from a row of 11 and a line of 5 meeting it. Answer: 16. A sketch of Figure 5 on the grid counts as the explanation: a drawing that shows about 16 tiles (typically a row of 11 with a line of 5 meeting it) earns the mark with no words, even if the hand-drawn squares cannot be counted exactly, and without writing 16 or the $+3$ separately. A sketch that clearly shows a different number of tiles (13, which is Figure 4, or a count well away from 16) earns 0. Follow-through: an answer that follows consistently from a wrong description in part (a) earns the mark.",
  },
  {
    questionNumber: 9,
    partLabel: "c",
    maxMarks: 2,
    stemText: Q9_CONTEXT,
    questionText: "Write an expression that would give the number of squares in Figure $n$. How does your explicit rule relate to your answer from part (a)?",
    markschemeText:
      "A full-mark response gives $3n + 1$ (accept equivalents such as $4 + 3(n - 1)$) AND relates it to the student's OWN answer to part (a), which is what the question asks for. 2 marks: one for a correct expression, one for the link. The link earns its mark when the student says what the 3 counts -- the tiles added per figure, in whatever words their own (a) used (\"the 3 is the 3 squares added each time\"; \"the common difference is 3, which is the 2 on the sides and the 1 below\"). Naming what the $+1$ counts (the one tile that is there before any growth) is a fuller answer, but the question does not ask for the two parts separately, so do not withhold the mark for its absence. A correct expression with no reference to the pattern at all earns 1; \"it relates because it works when I test Figure 3\" is a verification rather than a link, and earns nothing for the link. Follow-through: a student whose (a) was wrong earns the link mark for relating the rule to what they themselves described.",
  },
];

export const KA1_UNIT1_RUBRIC: StandardsRubric = {
  version: 1,
  source: "Teacher Marking Rubric, 9 Mathematics, Key Assessment #1, Unit 1",
  bands: { exceeding: 0.85, meeting: 0.65, approaching: 0.4 },
  strands: [
    {
      code: "A",
      name: "Expressions: evaluate, write and rewrite",
      standards: [
        "6.EE.A.2c Evaluate expressions at given values, using the order of operations.",
        "7.EE.A.1 Use properties of operations to expand and simplify linear expressions.",
        "A-SSE.A.1 Interpret an expression, and its parts, in terms of a context.",
        "A-SSE.A.2 Use the structure of an expression to rewrite it in an equivalent form.",
      ],
      parts: ["1a", "1b", "1c", "7a", "7b", "7c", "8"],
      descriptors: {
        exceeding:
          "Evaluates every expression accurately, including negatives, brackets and powers, with each substitution shown. Writes (84 - x) / 5 with correct grouping and uses it. Expands, groups and matches coefficients to find j = 4 and k = 7 with complete algebra.",
        meeting:
          "Evaluates most expressions correctly, with one slip in signs or order of operations. Writes and uses a correct expression from the context. Finds j and k algebraically, with at most one small error or missing step.",
        approaching:
          "Substitutes correctly but makes repeated sign or order-of-operations errors. The context expression is missing its brackets, or only the numerical cases are right. Expands Expression A but cannot set up both matching equations, or uses guess-and-check.",
        beginning:
          "Substitution is incomplete or incorrect. Cannot represent the context with an expression. Makes little or no progress with equivalent expressions.",
      },
    },
    {
      code: "B",
      name: "Arithmetic sequences and explicit rules",
      standards: [
        "F-LE.A.1b Recognise situations where a quantity changes by a constant amount.",
        "F-BF.A.1a Find an explicit expression or a calculation from a context.",
        "F-BF.A.2 Write arithmetic sequences with an explicit rule and use them to model situations (explicit form only on this paper).",
        "F-LE.A.2 Build a linear rule from a description, a table, or two input-output pairs.",
      ],
      parts: ["2a", "2b", "2c", "4a", "4b", "4c", "5", "9b"],
      descriptors: {
        exceeding:
          "Identifies the first term and common difference, including a negative difference. Writes correct explicit rules from a list, from a context with a starting value (20n + 10), and from two terms that are not next to each other. Uses the rules accurately to find terms and totals.",
        meeting:
          "Writes correct explicit rules in most representations. May make one off-by-one error (for example 88 - 6n) or leave out the starting value once. Uses rules correctly, including follow-through from an earlier error.",
        approaching:
          "Describes the change (\"subtract 6\") but writes correct rules only in simple cases. Makes frequent off-by-one errors. Finds the common difference from two terms but not the first term, or counts 5 steps instead of 4.",
        beginning: "Extends sequences by listing only. No workable explicit rule. Cannot use the given terms to find missing terms.",
      },
    },
    {
      code: "C",
      name: "Patterns and structure",
      standards: [
        "F-IF.A.3 Recognise that sequences are functions whose inputs are term positions (whole numbers).",
        "A-SSE.A.1b Interpret parts of an expression or pattern by treating them as single pieces.",
        "MP7 Look for and make use of structure.",
      ],
      parts: ["3a", "3b", "3c", "6a", "6b", "6c", "9a"],
      descriptors: {
        exceeding:
          "Describes alternating and repeating patterns precisely. Uses the position of a term (odd or even, groups of three) to find a far term (the 40th term is 68) and sums without listing. Describes the tile pattern by naming which parts grow and by how much.",
        meeting:
          "Describes the patterns correctly and finds nearby terms and sums. Finds the far term with a mostly correct method, with a small counting slip. The tile description names where the new tiles go.",
        approaching:
          "Describes the patterns only partly (\"it goes down and then up\"). Finds far terms by listing, with errors. The tile description gives only the total change (\"it adds 3\").",
        beginning: "Pattern descriptions are incorrect or missing. Cannot extend a pattern beyond the terms shown.",
      },
    },
    {
      code: "D",
      name: "Reasoning and justification",
      standards: [
        "MP3 Construct viable arguments and critique the reasoning of others.",
        "F-IF.B.5 Relate the domain of a function to the quantity it describes.",
        "F-LE.B.5 Interpret the parameters of a linear rule in terms of a context.",
        "F-IF.A.3 Recognise that term positions must be whole numbers.",
      ],
      parts: ["2d", "6d", "7d", "9c"],
      descriptors: {
        exceeding:
          "Justifies every conclusion completely: -52 is not a term because n is not a whole number; k is not a multiple of 3 because each group of three terms adds to 0; gives a counterexample and a correct condition for whole-number groups; links 3n and +1 to parts of the figure.",
        meeting:
          "Reaches correct conclusions with mostly complete reasoning. One argument relies on examples rather than a general rule, or one explanation is missing a step.",
        approaching:
          "Gives correct conclusions with little justification. Reasons from a single example, or explanations just restate the answer.",
        beginning: "Conclusions are missing or incorrect, with no reasoning given.",
      },
    },
  ],
};
