/**
 * Grade 9 Standard Level, Formative Assessment 2.
 *
 * Transcribed from the paper the teacher supplied (5 pages, 6 questions, 14
 * parts, 36 marks) for 9D, the real class behind the Grade 9 Standard track.
 * The paper prints no date, time allowed or calculator rule, and it came
 * WITHOUT a Teacher Marking Rubric -- unlike Key Assessment 1
 * (./g9-standard-ka1-unit1.ts), whose strands, standards and descriptors were
 * the teacher's own. So three things here were written on the platform
 * rather than copied, and all three are the teacher's to change on the
 * test's detail page:
 *
 *   - THE STRANDS. The paper's own question headings, grouped in the shape
 *     KA1's rubric used, so the two papers read alike on the standards
 *     report: A Expressions (Q1, Q2), B Arithmetic sequences (Q3), C
 *     Arithmetic and geometric sequences (Q4, Q5), D Reasoning and
 *     justification (Q6). Standards wording is KA1's wherever KA1 already
 *     named the standard.
 *   - THE MARK SCHEMES. KA1's form -- "a full-mark response shows ..." plus
 *     the answer, and for a part worth more than one mark "N marks: one for
 *     ..., one for ...", which is the itemisation
 *     grading_policies/g9_standard_level_marking_principles.md tells the
 *     marker to use. They carry forward the rulings the teacher made while
 *     marking KA1 (test_items.marking_notes on that paper): an intermediate
 *     result that could only come from the method is evidence of it,
 *     follow-through is applied rather than mentioned, one error costs one
 *     mark, a reason earns its mark for its content and not its wording.
 *   - "SHOW ALL WORK" IS ON THE COVER ONLY. None of the parts repeats it, so
 *     each calculation part's scheme names the cover instruction as the
 *     reason a bare answer earns its answer mark but not its method mark.
 *     That is the one call here worth a teacher's eye before the first
 *     accept: rule A6 of lib/ask-what-you-mark.ts says a demand made only in
 *     the instructions does not carry into a part, and a teacher who reads
 *     the cover that way would have a bare correct answer earn full marks.
 *
 * Q3(b)-(d) share the printed table and graph, so it is their stem, with a
 * bracketed marker's note describing what is printed (as KA1 Q9 does for its
 * tile figures); Q3(a) is a different sequence and has no stem. Q4's stem
 * says "give the next term and explain your reasoning in each case", and
 * each part repeats that demand in its own text, because the part's reason
 * mark depends on it (rule A6, the same reason KA1 Q1 keeps "Show all work"
 * in every part).
 *
 * This is the fixture lib/fixtures/g9-standard-fa2.test.ts pins, and the
 * source the seed migration for the live test was generated from
 * (20260925040451). Q1(b)'s scheme was then reworded by 20260925041302, after
 * a marking pass read its last mark wrongly (HANDOFF section 40), and this
 * file carries the reworded text. It is NOT read at runtime: the live copy
 * is the tests / test_items rows plus tests.standards_rubric. When a later
 * migration rewrites this paper's live text, update this file in the same
 * change -- KA1's fixture drifted from its live paper for a week because
 * nobody did (HANDOFF section 26).
 */

import type { StandardsRubric } from "../standards-rubric";
import type { SeedItem } from "./g9-standard-ka1-unit1";

export const FA2_NAME = "Formative Assessment 2";
export const FA2_SHORT_NAME = "Form2";
export const FA2_TOTAL_MARKS = 36;

/** Each question's total as the paper prints it ("[8 marks total]"), for the check that the parts add up. */
export const FA2_PRINTED_QUESTION_MARKS: Record<number, number> = { 1: 8, 2: 5, 3: 12, 4: 4, 5: 3, 6: 4 };

const Q2_CONTEXT =
  "There are 235 people going on a school field trip. Some are adult chaperones, and the remaining students will be split equally into four groups.";
// Printed as the opening sentence of part (b); parts (c) and (d) are about
// "this sequence" and "your rule", so all three carry it.
const Q3_TABLE_AND_GRAPH =
  "The table and graph below represent the same arithmetic sequence. [Marker's note, describing what is PRINTED on the paper. The student read no such sentence, so none of its words are required in any answer: a table with Term Number 1, 2, 3, 4, 5 and Term Value 45, blank, blank, 0, blank; and a graph of Term Value (vertical axis, $-20$ to 50, gridlines every 10) against Term Number (horizontal axis, 0 to 6), with three points printed, at $(1, 45)$, $(2, 30)$ and $(4, 0)$.]";
const Q4_CONTEXT =
  "The first two terms of a sequence are 12 and 6. Give the next term and explain your reasoning in each case.";
const Q6_CONTEXT =
  "Donuts come in packs of 6 and cookies come in packs of 9. Joan needs exactly 42 desserts with none left over. She wants to buy at least one pack of each.";

export const FA2_ITEMS: SeedItem[] = [
  // -- Q1: expressions and equivalence [8] ------------------------------------
  {
    questionNumber: 1,
    partLabel: "a",
    maxMarks: 2,
    stemText: null,
    questionText: "Evaluate: $7(k + 6) - 10$ when $k = 3$.",
    markschemeText:
      "A full-mark response substitutes $k = 3$ and works out the bracket first: $7(3 + 6) - 10 = 7(9) - 10 = 63 - 10 = 53$. Answer: 53. 2 marks: one for the substitution, written with the bracket kept ($7(3 + 6) - 10$, or $7(9) - 10$); one for the value 53. Expanding first is just as good: $7k + 42 - 10 = 7k + 32$, then $7(3) + 32 = 53$. A correct substitution followed by an arithmetic slip earns 1. Losing the bracket in the substitution ($7 \\times 3 + 6 - 10 = 17$) earns 0. The paper's instructions say \"Show all work\", so a bare 53 with no substitution earns 1, for the value.",
  },
  {
    questionNumber: 1,
    partLabel: "b",
    maxMarks: 3,
    stemText: null,
    questionText: "Evaluate: $4x - 3(x + 1)$ when $x = -2$.",
    markschemeText:
      "A full-mark response substitutes $x = -2$ in both places and keeps track of the negatives: $4(-2) - 3(-2 + 1) = -8 - 3(-1) = -8 + 3 = -5$. Answer: $-5$. 3 marks: one for the substitution, $4(-2) - 3(-2 + 1)$; one for the bracket term worked out with the right sign, $-3(-1) = +3$; one for finishing the arithmetic correctly from the student's own line, which gives $-5$ when the sign is right. That last mark is follow-through, so one sign error costs only the sign mark: $-8 - 3(-1) = -8 - 3 = -11$ earns 2 of 3 (the substitution mark and the finishing mark), and so does expanding $-3(x + 1)$ as $-3x + 3$ and correctly reaching 1. Simplifying first is just as good: expanding $-3(x + 1)$ as $-3x - 3$ earns the sign mark ($4x - 3x - 3 = x - 3$), substituting to get $-2 - 3$ earns the substitution mark, and $-5$ the finishing mark. The paper's instructions say \"Show all work\", so a bare $-5$ earns 1, for the value.",
  },
  {
    questionNumber: 1,
    partLabel: "c",
    maxMarks: 3,
    stemText: null,
    questionText:
      "If Expressions A and B are equivalent, what must the value of $a$ be? Expression A: $6(x + 4) - 2(x + 8)$. Expression B: $2(ax + 4)$.",
    markschemeText:
      "A full-mark response simplifies Expression A and matches it with Expression B: $6(x + 4) - 2(x + 8) = 6x + 24 - 2x - 16 = 4x + 8$, and $2(ax + 4) = 2ax + 8$, so $2a = 4$ and $a = 2$. Answer: $a = 2$. 3 marks: one for expanding both brackets of Expression A ($6x + 24 - 2x - 16$); one for simplifying it correctly to $4x + 8$ (the $-2 \\times 8 = -16$ is where the sign usually goes wrong); one for $a = 2$, from matching the $x$ terms. Any valid route earns all three: writing Expression A as $2(2x + 4)$ and comparing it with $2(ax + 4)$; substituting $a = 2$ into Expression B and showing that both expressions are $4x + 8$; or substituting a value of $x$ into both expressions and solving for $a$ (with $x = 1$, Expression A is $6(5) - 2(9) = 12$ and Expression B is $2a + 8$, so $a = 2$). On that last route the first mark is for substituting into both expressions and the second for evaluating Expression A correctly; $x = 0$ gives $8 = 8$ and cannot find $a$. One sign slip in the expansion (such as $-2(x + 8) = -2x + 16$) costs only the simplification mark: both brackets were still expanded, and matching the $x$ terms still gives $a = 2$. The paper's instructions say \"Show all work\", so a bare $a = 2$ earns 1, for the value.",
  },
  // -- Q2: modeling with expressions [5] ---------------------------------------
  {
    questionNumber: 2,
    partLabel: "a",
    maxMarks: 2,
    stemText: Q2_CONTEXT,
    questionText: "If there are 15 adult chaperones, how many students will be in each group?",
    markschemeText:
      "A full-mark response takes the adult chaperones away first, then shares the students equally among the four groups: $235 - 15 = 220$ students, and $220 \\div 4 = 55$. Answer: 55 students in each group. 2 marks: one for the number of students, $235 - 15 = 220$; one for dividing them into four groups, $220 \\div 4 = 55$. Writing it in one line, $(235 - 15) \\div 4 = 55$, earns both, and so does $220 \\div 4 = 55$ on its own, since the 220 shows the subtraction. Dividing before subtracting ($235 \\div 4 - 15 = 43.75$) earns 0. The right method with an arithmetic slip in the division earns 1. The paper's instructions say \"Show all work\", so a bare 55 earns 1, for the value.",
  },
  {
    questionNumber: 2,
    partLabel: "b",
    maxMarks: 3,
    stemText: Q2_CONTEXT,
    questionText: "Write an expression that gives the number of students in each group if there are $x$ adult chaperones.",
    markschemeText:
      "A full-mark response writes $\\frac{235 - x}{4}$ (accept $(235 - x) \\div 4$, $\\frac{1}{4}(235 - x)$, or an expanded form such as $58.75 - \\frac{x}{4}$; writing it as an equation, such as $g = \\frac{235 - x}{4}$, is fine). 3 marks: one for the number of students, $235 - x$; one for dividing by 4; one for grouping it so that the whole of $235 - x$ is divided (brackets, or a fraction bar under all of it). Missing the grouping, as in $235 - x \\div 4$ or $235 - \\frac{x}{4}$, earns 2: both steps are there, but as written only $x$ is divided. Dividing before subtracting, $\\frac{235}{4} - x$, earns 1, for the division by 4. A number with no $x$ in it (such as 55 again) earns 0.",
  },
  // -- Q3: arithmetic sequences and representations [12] -----------------------
  {
    questionNumber: 3,
    partLabel: "a",
    maxMarks: 3,
    stemText: null,
    questionText:
      "The 7th, 8th, and 9th terms of an arithmetic sequence are 24, 31, and 38 respectively. What is the first term of the sequence?",
    markschemeText:
      "A full-mark response finds the common difference and works back to the first term: $d = 31 - 24 = 7$, and the 1st term is 6 steps before the 7th, so it is $24 - 6 \\times 7 = 24 - 42 = -18$. Answer: $-18$. 3 marks: one for the common difference 7; one for working back the right number of steps from a given term (6 steps from the 7th term, 7 from the 8th, 8 from the 9th), by any route: $24 - 6(7)$, listing the terms back ($24, 17, 10, 3, -4, -11, -18$), or building a rule such as $7n - 25$ and evaluating it at $n = 1$; one for $-18$. Working back one step too many or too few (such as $24 - 7 \\times 7 = -25$) is the error this part tests: it earns the common-difference mark only. A listing that arrives at $-18$ as the first term earns all three marks, and so does a response that writes the common difference 7 and the first term $-18$, since the second follows from the first only by working back the right number of steps. Follow-through: a wrong common difference worked back the right number of steps earns the second mark. The paper's instructions say \"Show all work\", so a bare $-18$ earns 1, for the value.",
  },
  {
    questionNumber: 3,
    partLabel: "b",
    maxMarks: 5,
    stemText: Q3_TABLE_AND_GRAPH,
    questionText: "Fill in all missing table values and missing graph points.",
    markschemeText:
      "A full-mark response completes both the table and the graph for the sequence $45, 30, 15, 0, -15$, whose common difference is $-15$ (read from the graph's printed point at term 2, or from the table's 45 at term 1 and 0 at term 4, three steps apart). The missing table values are 30 (term 2), 15 (term 3) and $-15$ (term 5); the missing graph points are $(3, 15)$ and $(5, -15)$. 5 marks, one for each of the five: the three table values, then the two plotted points. A plotted point earns its mark when it sits at the right term number and at the right height, as closely as a hand-drawn point on this grid allows (15 is halfway between the 10 and 20 gridlines; $-15$ is halfway between $-10$ and $-20$). Follow-through: a point plotted at the student's own table value for that term earns its mark even when that table value is wrong, because the part says the table and the graph show the same sequence, and the wrong value has already cost its table mark. The three printed points (terms 1, 2 and 4) are not the student's work and earn nothing. The part asks only for the values and the points, so no working is needed for any of the five marks.",
  },
  {
    questionNumber: 3,
    partLabel: "c",
    maxMarks: 2,
    stemText: Q3_TABLE_AND_GRAPH,
    questionText: "Write an explicit formula for the $n$th term of this sequence.",
    markschemeText:
      "A full-mark response gives an explicit formula such as $a_n = 60 - 15n$ (accept any equivalent: $45 - 15(n - 1)$, $-15n + 60$, $45 + (n - 1)(-15)$; the \"$a_n =$\" is not required). 2 marks: one for a rule in $n$ with the common difference $-15$ multiplying $n$ (or $n - 1$); one for the constant that makes the rule give 45 when $n = 1$. An off-by-one rule such as $45 - 15n$ earns 1: the right difference with the wrong starting value. A recursive description (\"subtract 15 each time\", or $a_{n+1} = a_n - 15$) is not an explicit formula and earns 0. To check an unfamiliar form, work out terms 1 to 3 from it: if they come out 45, 30, 15, it earns both marks. Follow-through: where the student's table in part (b) used a wrong common difference, a formula that is correct for their own table earns both marks.",
  },
  {
    questionNumber: 3,
    partLabel: "d",
    maxMarks: 2,
    stemText: Q3_TABLE_AND_GRAPH,
    questionText: "Use your rule to find the 15th term.",
    markschemeText:
      "A full-mark response substitutes $n = 15$ into the rule from part (c): $60 - 15(15) = 60 - 225 = -165$. Answer: $-165$. 2 marks: one for substituting $n = 15$ into the student's rule, shown; one for the value. Follow-through: a wrong rule from part (c), correctly evaluated at $n = 15$, earns both marks (such as $45 - 15(15) = -180$ from the off-by-one rule); the wrong rule has already cost its mark in part (c). The part asks for the rule to be used, so reaching $-165$ by listing the terms, or giving a bare $-165$, earns 1, for the value.",
  },
  // -- Q4: arithmetic or geometric? [4] -----------------------------------------
  {
    questionNumber: 4,
    partLabel: "a",
    maxMarks: 2,
    stemText: Q4_CONTEXT,
    questionText: "If the sequence is arithmetic: give the next term and explain your reasoning.",
    markschemeText:
      "A full-mark response gives 0, with the common difference as the reason: an arithmetic sequence changes by the same amount each time, $6 - 12 = -6$, so the next term is $6 - 6 = 0$. Answer: 0. 2 marks: one for the reason, that the terms go down by 6 each time (a common difference of $-6$), in any words, or shown on the terms (such as $-6$ written between 12 and 6 and again between 6 and 0); one for the next term, 0. The reason has to say why 6 is taken away, not only take it away: a bare 0, or $6 - 6 = 0$ with nothing linking the 6 to the given terms, earns 1, for the next term. A correct reason with an arithmetic slip in the next term also earns 1.",
  },
  {
    questionNumber: 4,
    partLabel: "b",
    maxMarks: 2,
    stemText: Q4_CONTEXT,
    questionText: "If the sequence is geometric: give the next term and explain your reasoning.",
    markschemeText:
      "A full-mark response gives 3, with the common ratio as the reason: a geometric sequence is multiplied by the same number each time, $6 \\div 12 = \\frac{1}{2}$, so the next term is $6 \\times \\frac{1}{2} = 3$. Answer: 3. 2 marks: one for the reason, that each term is half the one before (a common ratio of $\\frac{1}{2}$, \"divide by 2\", \"halve it\"), in any words or shown on the terms; one for the next term, 3. Mark the idea, not the vocabulary: calling the ratio 2 while dividing by 2 is the same reasoning and earns the mark. The reason has to say why the term is halved (12 halved is 6), not only halve it: a bare 3, or $6 \\div 2 = 3$ with nothing linking it to the given terms, earns 1, for the next term. Subtracting 6 again (giving 0) treats the sequence as arithmetic and earns 0.",
  },
  // -- Q5: geometric sequence [3] ---------------------------------------------
  {
    questionNumber: 5,
    partLabel: "",
    maxMarks: 3,
    stemText: null,
    questionText:
      "The 10th and 12th terms of a geometric sequence are 16 and 256, respectively. The common ratio is positive. What is the common ratio?",
    markschemeText:
      "A full-mark response uses the fact that the 12th term is two steps on from the 10th, so the ratio is applied twice: $16 \\times r \\times r = 256$, so $r^2 = 256 \\div 16 = 16$ and $r = 4$, the positive value the question asks for. Answer: 4. 3 marks: one for finding how much the sequence grows from the 10th term to the 12th, $256 \\div 16 = 16$; one for recognising that this growth is two ratios, $r^2 = 16$ (or $16r^2 = 256$, or $16 \\times r \\times r = 256$); one for $r = 4$. Checking a ratio by multiplying twice ($16 \\times 4 = 64$, then $64 \\times 4 = 256$) is a complete method and earns all three marks. Taking $256 \\div 16 = 16$ as the ratio itself (one step instead of two) earns 1. Treating the sequence as arithmetic, as in $(256 - 16) \\div 2 = 120$, earns 0. Giving $-4$, or $\\pm 4$ without choosing the positive value, loses only the last mark. The paper's instructions say \"Show all work\", so a bare 4 earns 1, for the value.",
  },
  // -- Q6: dessert packs [4] ----------------------------------------------------
  {
    questionNumber: 6,
    partLabel: "a",
    maxMarks: 2,
    stemText: Q6_CONTEXT,
    questionText:
      "Give one possible number of donut packs and cookie packs she could buy. Show that your choice gives 42 desserts.",
    markschemeText:
      "A full-mark response gives a combination that makes exactly 42 with at least one pack of each, and shows the total. There are two, and either earns full marks: 4 packs of donuts and 2 packs of cookies, $4 \\times 6 + 2 \\times 9 = 24 + 18 = 42$; or 1 pack of donuts and 4 packs of cookies, $1 \\times 6 + 4 \\times 9 = 6 + 36 = 42$. 2 marks: one for a valid combination; one for showing that it gives 42 (each number of packs times its pack size, added). Giving the choice as desserts rather than packs (24 donuts and 18 cookies) is the same choice and is accepted. 7 packs of donuts and no cookies makes 42 but breaks the condition \"at least one pack of each\": it earns 1, for showing the 42. A combination that does not make 42 (such as $3 \\times 6 + 3 \\times 9 = 45$) earns 0: it is not a choice she could buy. A valid combination with no total shown earns 1.",
  },
  {
    questionNumber: 6,
    partLabel: "b",
    maxMarks: 2,
    stemText: Q6_CONTEXT,
    questionText:
      "How many possible ways are there to purchase exactly 42 desserts under these conditions? Show enough work to justify that you found them all.",
    markschemeText:
      "A full-mark response finds exactly two ways, 4 donut packs with 2 cookie packs and 1 donut pack with 4 cookie packs, and shows that there are no others. Answer: 2 ways. 2 marks: one for the answer, 2; one for the justification that no way has been missed, which has to be systematic: every possible number of cookie packs tried (1, 2, 3 and 4 packs leave 33, 24, 15 and 6 desserts, and only 24 and 6 can be made from packs of 6; 5 packs of cookies is already 45), or every possible number of donut packs tried (1 to 6), in a list or a table; or an argument that rules the rest out (six times any number of donut packs is even, and so is 42, so nine times the number of cookie packs must be even: the cookie packs can only be 2 or 4). Naming the two ways without showing why there are no more earns 1: saying they are the only ones is not a justification. Counting 7 packs of donuts with no cookies as a third way ignores the condition and loses the answer mark; a systematic check that includes it still earns the justification mark.",
  },
];

export const FA2_RUBRIC: StandardsRubric = {
  version: 1,
  source:
    "Formative Assessment 2. Strands, standards and descriptors drafted from the paper's questions; no teacher rubric was supplied",
  bands: { exceeding: 0.85, meeting: 0.65, approaching: 0.4 },
  strands: [
    {
      code: "A",
      name: "Expressions: evaluate, write and rewrite",
      standards: [
        "6.EE.A.2c Evaluate expressions at given values, using the order of operations.",
        "7.EE.A.1 Use properties of operations to expand and simplify linear expressions.",
        "A-SSE.A.2 Use the structure of an expression to rewrite it in an equivalent form.",
        "6.EE.A.2a Write expressions that record operations with numbers and with letters standing for numbers.",
        "A-SSE.A.1 Interpret an expression, and its parts, in terms of a context.",
      ],
      parts: ["1a", "1b", "1c", "2a", "2b"],
      descriptors: {
        exceeding:
          "Evaluates both expressions accurately, including the negative input, with each substitution shown. Expands and simplifies Expression A to 4x + 8 and matches it with Expression B to find a = 2. Takes the chaperones away before sharing into groups, and writes (235 - x) / 4 with grouping that divides all of 235 - x.",
        meeting:
          "Evaluates the expressions with at most one slip in signs or order of operations. Finds a = 2 with at most one small error in the expansion. Finds 55 and writes an expression for the context that is correct, or is missing only its grouping.",
        approaching:
          "Substitutes correctly but makes repeated sign or order-of-operations errors, such as taking -3(-1) as -3. Expands Expression A but cannot match it with Expression B, or states a without showing the comparison. Finds the group size for 15 chaperones but cannot write the general expression, or divides before subtracting.",
        beginning:
          "Substitution is incomplete or incorrect. Makes little or no progress with equivalent expressions. Cannot represent the context with a calculation or an expression.",
      },
    },
    {
      code: "B",
      name: "Arithmetic sequences: explicit rules and representations",
      standards: [
        "F-LE.A.1b Recognise situations where a quantity changes by a constant amount.",
        "F-LE.A.2 Build a linear rule from a table, a graph, or given terms of a sequence.",
        "F-BF.A.2 Write arithmetic sequences with an explicit rule and use the rule to find terms.",
        "F-IF.A.3 Recognise that sequences are functions whose inputs are term positions (whole numbers).",
      ],
      parts: ["3a", "3b", "3c", "3d"],
      descriptors: {
        exceeding:
          "Finds the common difference from terms that are not the first and works back the right number of steps to the first term (-18). Completes the table and the graph consistently, reading the difference of -15 from either. Writes a correct explicit rule (60 - 15n) and uses it to find the 15th term (-165).",
        meeting:
          "Completes the table and the graph with at most one slip. Writes a correct explicit rule, or one with an off-by-one constant (45 - 15n), and uses it correctly, including follow-through from an earlier error. Finds the first term with at most one small error.",
        approaching:
          "Finds the common difference but works back the wrong number of steps (-25). Completes the table but not the graph, or the reverse. Describes the change (\"subtract 15\") but writes no workable explicit rule, or finds the 15th term by listing.",
        beginning:
          "Continues the sequence by listing only, with errors. No workable explicit rule. Cannot use the given terms, table or graph to find missing terms.",
      },
    },
    {
      code: "C",
      name: "Arithmetic and geometric sequences",
      standards: [
        "F-LE.A.1a Show that arithmetic sequences grow by equal differences and geometric sequences by equal factors.",
        "F-BF.A.2 Write arithmetic and geometric sequences and use them to find terms.",
        "F-LE.A.2 Build a geometric sequence from two of its terms.",
        "MP7 Look for and make use of structure.",
      ],
      parts: ["4a", "4b", "5"],
      descriptors: {
        exceeding:
          "Continues the same two terms both ways and says why: 0 because the common difference is -6, and 3 because the common ratio is 1/2. Recognises that the 10th and 12th terms are two ratios apart, so r^2 = 16, and gives the positive ratio 4.",
        meeting:
          "Gives both next terms, with a reason for at least one. Finds the ratio 4 with one step of the method missing, or reaches r^2 = 16 but does not choose the positive ratio.",
        approaching:
          "Gives the next terms without reasons, or continues both sequences the same way. Divides 256 by 16 and takes 16 as the ratio, one step instead of two.",
        beginning: "Cannot continue either sequence. No workable method for the common ratio.",
      },
    },
    {
      code: "D",
      name: "Reasoning and justification",
      standards: [
        "MP1 Make sense of problems and persevere in solving them.",
        "MP3 Construct viable arguments and critique the reasoning of others.",
        "A-CED.A.3 Represent constraints by equations, and interpret solutions as viable or not viable in a context.",
      ],
      parts: ["6a", "6b"],
      descriptors: {
        exceeding:
          "Finds a combination that makes exactly 42 with at least one pack of each, and shows the total. Finds both ways (4 donut packs with 2 cookie packs; 1 donut pack with 4 cookie packs) and shows there are no others, with a systematic check or a general argument.",
        meeting:
          "Finds and checks a valid combination. Finds both ways but does not show there are no others, or checks systematically but counts the combination with no cookies as a third way.",
        approaching:
          "Finds a combination that makes 42 but breaks a condition, or gives one without showing the total. Lists some ways with no check that they are all.",
        beginning: "Cannot find a combination that makes 42, and gives no reasoning.",
      },
    },
  ],
};
