import type { Lesson, LessonSlide } from "./types";

/** Lesson 1.7 -- Connecting Patterns across Multiple Representations.
 *
 *  Written against one worksheet: the "Setting Boundaries" exploration (six
 *  lattice polygons on a coordinate grid, Q1-Q5) and the Check Your
 *  Understanding page that follows it (Q1 graph-versus-table, Q2 bacteria).
 *
 *  WHAT THE EXPLORATION IS ACTUALLY ABOUT, because it is not obvious from
 *  the page and the teacher needs it:
 *
 *  Every figure is a lattice polygon with exactly TWO interior points, which
 *  is a design decision, not an accident. Pick's theorem says
 *  $A = I + \tfrac{1}{2}B - 1$; with $I = 2$ that collapses to
 *  $A = \tfrac{1}{2}B + 1$, and THAT is the relationship students are meant
 *  to find. Checked against all six printed figures:
 *
 *      A  B = 10, area 6      (given on the sheet)
 *      B  B = 8,  area 5
 *      C  B = 9,  area 5.5    (the top-row C)
 *      C  B = 13, area 7.5    (the second-row C -- the sheet prints the
 *                              letter C twice; see openQuestions)
 *      D  B = 12, area 7
 *      E  B = 4,  area 3
 *
 *  The rule therefore BREAKS on any shape a student draws with a different
 *  number of interior points, and a sharp student will find that. It is a
 *  feature, not a problem -- the challenge slide makes it the extension --
 *  but a teacher who does not know it will be ambushed.
 *
 *  SHAPE: three acts, as in 1.6.
 *
 *    LEARN  -- one idea per slide. The `primer` slides teach the TOOLS
 *              (counting points, finding area, building a table) on shapes
 *              that are NOT on the worksheet, and deliberately never state a
 *              boundary count and an area for the same shape, so no pair is
 *              handed over. The `formalise` slides are the debrief.
 *    HINT   -- one slide per worksheet question, one nudge per part.
 *    REVIEW -- after the work.
 */

// ---- Act 1: learn. One idea each, at most one worked example.

const LEARN: LessonSlide[] = [
  {
    id: "shapes-on-a-grid",
    act: "learn",
    title: "Shapes on a Grid",
    phase: "primer",
    minutes: 3,
    core: true,
    purpose: "The vocabulary the whole exploration is written in.",
    body: [
      "A coordinate grid is covered in evenly spaced dots, one at every corner.",
      "A shape drawn so that every corner sits on one of those dots is a GRID SHAPE.",
      "Its edges can be horizontal, vertical or slanted.",
      "One small square of the grid has an area of $1$ square unit.",
    ],
    examples: [],
    table: null,
    plot: null,
    check: {
      question: "A rectangle on the grid is $4$ squares wide and $3$ squares tall. What is its area?",
      answer: "$4 \\cdot 3 = 12$ square units.",
    },
    questionRef: null,
    source: null,
    hints: [],
    teacherNote: "Two minutes. The only job here is that everyone means the same thing by a dot and by one square unit.",
    answers: ["Check: $12$ square units."],
  },
  {
    id: "counting-boundary-points",
    act: "learn",
    title: "Counting Boundary Points",
    phase: "primer",
    minutes: 4,
    core: true,
    purpose: "The first of the two measurements. Taught on a shape that is not on the worksheet.",
    body: [
      "A BOUNDARY POINT is a grid dot that sits ON the edge of the shape.",
      "Corners count. Dots part-way along a straight edge count.",
      "Dots inside the shape do NOT count, and neither do dots outside it.",
      "Count each dot ONCE. It is easy to count a corner twice when you go round.",
      "Work around the outline in one direction and mark each dot as you pass it.",
    ],
    examples: [
      {
        title: "Example",
        steps: [
          "Take a rectangle $4$ squares wide and $2$ squares tall.",
          "Top edge: $5$ dots. Bottom edge: $5$ dots.",
          "The left and right edges each add $1$ more dot in the middle.",
          "The four corners were already counted in the top and bottom rows.",
          "$5 + 5 + 1 + 1 = 12$.",
        ],
        answer: "$12$ boundary points.",
      },
    ],
    table: null,
    plot: null,
    check: {
      question: "A square is $3$ squares wide and $3$ squares tall. How many boundary points?",
      answer: "$4$ along the top, $4$ along the bottom, and $2$ more on each side: $4 + 4 + 2 + 2 = 12$.",
    },
    questionRef: null,
    source: null,
    hints: [],
    teacherNote:
      "Double-counting corners is the commonest slip. The going-round-once routine fixes it. A slanted edge may pass through NO dots between its ends, which surprises students.",
    answers: ["Check: $12$ boundary points."],
  },
  {
    id: "area-by-counting-squares",
    act: "learn",
    title: "Area by Counting Squares",
    phase: "primer",
    minutes: 4,
    core: true,
    purpose: "The second measurement, for shapes with slanted edges.",
    body: [
      "Count the whole squares inside the shape first.",
      "Then look at the part-squares the slanted edges cut.",
      "A slanted edge that runs corner to corner of a square cuts it exactly in HALF.",
      "Two of those halves make one whole square.",
      "An area can end in a half, and that is a perfectly good answer.",
    ],
    examples: [
      {
        title: "Example",
        steps: [
          "A triangle has a base of $3$ along the bottom and a height of $2$.",
          "Area of a triangle is $\\tfrac{1}{2} \\cdot \\text{base} \\cdot \\text{height}$.",
          "$\\tfrac{1}{2} \\cdot 3 \\cdot 2 = 3$.",
        ],
        answer: "$3$ square units.",
      },
    ],
    table: null,
    plot: null,
    check: {
      question: "A triangle has base $5$ and height $3$. What is its area?",
      answer: "$\\tfrac{1}{2} \\cdot 5 \\cdot 3 = 7.5$ square units.",
    },
    questionRef: null,
    source: null,
    hints: [],
    teacherNote:
      "Students resist half answers. Say early that a half is allowed, or they will round and break the pattern they are about to look for.",
    answers: ["Check: $7.5$ square units."],
  },
  {
    id: "area-by-splitting",
    act: "learn",
    title: "Area by Splitting It Up",
    phase: "primer",
    minutes: 4,
    core: false,
    purpose: "The method for an awkward outline. Still no boundary count stated, so no pair is given away.",
    body: [
      "An awkward shape is easier in pieces.",
      "Split it into rectangles and triangles, find each area, then ADD them.",
      "Or draw the smallest rectangle that contains the shape and SUBTRACT the corners you do not want.",
      "Either way, write down each piece so you can check it later.",
    ],
    examples: [
      {
        title: "Example",
        steps: [
          "A shape is a $3$ by $2$ rectangle with a triangle of base $2$ and height $2$ cut off one corner.",
          "Rectangle: $3 \\cdot 2 = 6$.",
          "Triangle: $\\tfrac{1}{2} \\cdot 2 \\cdot 2 = 2$.",
          "Subtract: $6 - 2 = 4$.",
        ],
        answer: "$4$ square units.",
      },
    ],
    table: null,
    plot: null,
    check: {
      question: "A $4$ by $3$ rectangle has a triangle of base $3$ and height $2$ cut off. What is left?",
      answer: "$4 \\cdot 3 = 12$, and $\\tfrac{1}{2} \\cdot 3 \\cdot 2 = 3$, so $12 - 3 = 9$ square units.",
    },
    questionRef: null,
    source: null,
    hints: [],
    teacherNote: "Subtracting from a bounding rectangle is usually quicker than adding pieces, and is less error-prone with slants.",
    answers: ["Check: $9$ square units."],
  },
  {
    id: "put-it-in-a-table",
    act: "learn",
    title: "Put the Numbers in a Table",
    phase: "primer",
    minutes: 3,
    core: true,
    purpose: "Organising measurements so a pattern can be seen at all. The single most useful primer move.",
    body: [
      "Once you have measured several things, put the numbers in a TABLE.",
      "One column for the thing you changed, one for the thing you measured.",
      "Then put the rows IN ORDER, smallest first.",
      "A pattern that is invisible in a scattered list is usually obvious in an ordered table.",
    ],
    examples: [],
    table: {
      caption: "The same four measurements, scattered and then ordered. Only one of these shows a pattern.",
      headers: ["Scattered", "Ordered"],
      rows: [
        ["$(3, 11)$", "$(1, 5)$"],
        ["$(1, 5)$", "$(2, 8)$"],
        ["$(4, 14)$", "$(3, 11)$"],
        ["$(2, 8)$", "$(4, 14)$"],
      ],
    },
    plot: null,
    check: {
      question: "In the ordered column, what happens to the second number each time the first goes up by $1$?",
      answer: "It goes up by $3$ every time: $5, 8, 11, 14$.",
    },
    questionRef: null,
    source: null,
    hints: [],
    teacherNote:
      "This is the slide that rescues the exploration. Students who measure all six figures and never tabulate will not see anything.",
    answers: ["Check: it goes up by $3$ each time."],
  },
  {
    id: "find-the-pattern",
    act: "learn",
    title: "Finding the Pattern in a Table",
    phase: "formalise",
    minutes: 4,
    core: true,
    purpose: "Differences and ratios, reused from 1.6, now applied to a table of measurements.",
    body: [
      "Look down the second column and ask what is happening.",
      "SUBTRACT each value from the next. Constant difference means the pattern adds.",
      "DIVIDE each value by the one before. Constant ratio means the pattern multiplies.",
      "If the first column does not go up in ones, work out how much it went up by too.",
      "Then ask: how much does the second column move for each ONE step of the first?",
    ],
    examples: [
      {
        title: "Example",
        steps: [
          "First column $1, 2, 3, 4$. Second column $5, 8, 11, 14$.",
          "Differences in the second column: $3, 3, 3$. Constant.",
          "The first column goes up by $1$ each time.",
          "So the second column goes up by $3$ for every $1$ step.",
        ],
        answer: "Adds $3$ per step, so the pattern is arithmetic.",
      },
    ],
    table: null,
    plot: null,
    check: {
      question: "First column $2, 4, 6$; second column $7, 11, 15$. How much does the second move per ONE step of the first?",
      answer: "The second goes up $4$ for every $2$ of the first, so it moves $2$ for each $1$ step.",
    },
    questionRef: null,
    source: null,
    hints: [],
    teacherNote:
      "The per-one-step question is the one that matters. A table whose first column jumps by $2$ hides the rate from anyone who only reads the second column.",
    answers: ["Check: $2$ for each $1$ step."],
  },
  {
    id: "say-the-rule-in-words",
    act: "learn",
    title: "Saying the Rule in Words",
    phase: "formalise",
    minutes: 3,
    core: true,
    purpose: "The bridge between spotting a pattern and writing an equation. Skipping it is why students write the wrong formula.",
    body: [
      "Before you write symbols, say the rule as a SENTENCE.",
      "Use this frame: to get the second number, take the first number, ___, then ___.",
      "Say what you MULTIPLY by first, then what you ADD.",
      "If you cannot say it, you cannot write it, and the equation will be a guess.",
    ],
    examples: [
      {
        title: "Example",
        steps: [
          "The table is first column $1, 2, 3, 4$ and second column $5, 8, 11, 14$.",
          "It goes up $3$ each step, so you multiply the first number by $3$.",
          "$3 \\cdot 1 = 3$, but the answer is $5$, which is $2$ more.",
          "So: multiply by $3$, then add $2$.",
        ],
        answer: "To get the second number, multiply the first by $3$ and then add $2$.",
      },
    ],
    table: null,
    plot: null,
    check: {
      question: "A table goes up $2$ each step, and when the first number is $1$ the second is $9$. Say the rule in words.",
      answer: "Multiply the first number by $2$, then add $7$, because $2 \\cdot 1 = 2$ and $9$ is $7$ more.",
    },
    questionRef: null,
    source: null,
    hints: [],
    teacherNote:
      "The add-on part is what students drop. Getting the step right and the starting value wrong produces a rule that fails every single row.",
    answers: ["Check: multiply by $2$, then add $7$."],
  },
  {
    id: "write-the-equation",
    act: "learn",
    title: "Turning Words into an Equation",
    phase: "formalise",
    minutes: 4,
    core: true,
    purpose: "The symbolic representation. Naming the letters is half the work.",
    body: [
      "Give each quantity a letter, and SAY what the letter means.",
      "Then write the sentence as symbols, in the same order you said it.",
      "Multiply first, then add: $y = (\\text{step}) \\cdot x + (\\text{the add-on})$.",
      "A letter with no meaning written beside it is the commonest reason a correct rule gets no credit.",
    ],
    examples: [
      {
        title: "Example",
        steps: [
          "In words: multiply the first number by $3$, then add $2$.",
          "Let $x$ be the first number and $y$ the second.",
          "$y = 3x + 2$",
          "Test it on a row: $x = 4$ gives $3 \\cdot 4 + 2 = 14$, which matches.",
        ],
        answer: "$y = 3x + 2$, with $x$ the first number and $y$ the second.",
      },
    ],
    table: null,
    plot: null,
    check: {
      question: "Write an equation for: multiply the first number by $2$, then add $7$.",
      answer: "$y = 2x + 7$, where $x$ is the first number and $y$ is the second.",
    },
    questionRef: null,
    source: null,
    hints: [],
    teacherNote: "Insist on the sentence that defines the letters. On the exploration the letters stand for boundary points and area, and saying so is part of the answer.",
    answers: ["Check: $y = 2x + 7$."],
  },
  {
    id: "plot-the-pairs",
    act: "learn",
    title: "Plotting the Pairs",
    phase: "formalise",
    minutes: 4,
    core: false,
    purpose: "The graphical representation, on neutral data so the exploration's own picture is not given away.",
    body: [
      "Every row of the table is a point: first number across, second number up.",
      "Plot them and look at the shape.",
      "A pattern that ADDS the same amount each step gives points on a STRAIGHT line.",
      "A pattern that MULTIPLIES gives points on a curve that gets steeper.",
      "The graph will not give you exact values, but it tells you which kind you have at a glance.",
    ],
    examples: [],
    table: null,
    plot: {
      caption:
        "The table 1, 2, 3, 4 against 5, 8, 11, 14, plotted. The points sit on a straight line, because the pattern adds 3 every step.",
      xLabel: "First number",
      yLabel: "Second number",
      xMax: 5,
      yMax: 15,
      yStep: 5,
      xStep: 1,
      series: [
        {
          label: "Adds 3 each step",
          kind: "linear",
          points: [
            [1, 5],
            [2, 8],
            [3, 11],
            [4, 14],
          ],
        },
      ],
    },
    check: {
      question: "A table's points all lie on one straight line. Does the pattern add or multiply?",
      answer: "It adds. A multiplying pattern bends away from a straight line.",
    },
    questionRef: null,
    source: null,
    hints: [],
    teacherNote: "Watch for axes swapped. The quantity you chose goes across; the one you measured goes up.",
    answers: ["Check: it adds."],
  },
  {
    id: "test-the-rule-on-every-row",
    act: "learn",
    title: "Test the Rule on Every Row",
    phase: "formalise",
    minutes: 3,
    core: true,
    purpose: "The habit that separates a rule from a guess. Directly parallel to 1.6's check-every-pair.",
    body: [
      "A rule that fits the first row is not a rule yet.",
      "Put EVERY row through it and check you get the value in the table.",
      "One row that fails means the rule is wrong, not that the row is wrong.",
      "Write the check down. An unchecked rule earns nothing on paper.",
    ],
    examples: [
      {
        title: "Example",
        steps: [
          "Rule: $y = 3x + 2$. Table: $1 \\to 5$, $2 \\to 8$, $3 \\to 11$, $4 \\to 14$.",
          "$3 \\cdot 1 + 2 = 5$ ok",
          "$3 \\cdot 2 + 2 = 8$ ok",
          "$3 \\cdot 3 + 2 = 11$ ok",
          "$3 \\cdot 4 + 2 = 14$ ok",
        ],
        answer: "All four rows fit, so the rule stands.",
      },
    ],
    table: null,
    plot: null,
    check: {
      question: "Someone says $y = 4x$ fits $1 \\to 4$ and $2 \\to 8$, and stops. What should they do?",
      answer: "Test the remaining rows. Two rows fitting proves nothing on its own.",
    },
    questionRef: null,
    source: null,
    hints: [],
    teacherNote: "Same discipline as checking every ratio in 1.6. Say the connection out loud; students do not make it themselves.",
    answers: ["Check: test the rest of the rows."],
  },
  {
    id: "use-the-rule-to-jump",
    act: "learn",
    title: "Using the Rule to Jump Ahead",
    phase: "formalise",
    minutes: 3,
    core: true,
    purpose: "Why an equation is worth having at all. This is the point of Q4 and Q5 of the exploration.",
    body: [
      "Once the rule is checked, you do not need the picture any more.",
      "Put the number you want straight into the equation.",
      "This is the whole reason for writing a rule: it works for values you could never draw.",
      "Drawing and counting is fine for small cases and hopeless for large ones.",
    ],
    examples: [
      {
        title: "Example",
        steps: [
          "Rule: $y = 3x + 2$. What is $y$ when $x = 50$?",
          "$3 \\cdot 50 + 2$",
          "$= 150 + 2 = 152$",
          "No table and no drawing needed.",
        ],
        answer: "$y = 152$.",
      },
    ],
    table: null,
    plot: null,
    check: {
      question: "With $y = 2x + 7$, what is $y$ when $x = 100$?",
      answer: "$2 \\cdot 100 + 7 = 207$.",
    },
    questionRef: null,
    source: null,
    hints: [],
    teacherNote: "Exploration Q5 asks whether you would use the SAME method for a big case. The honest answer is no, and this slide is why.",
    answers: ["Check: $y = 207$."],
  },
  {
    id: "four-representations",
    act: "learn",
    title: "The Four Ways to Show a Pattern",
    phase: "formalise",
    minutes: 4,
    core: true,
    purpose: "Names the four representations and what each is actually good for. The title idea of the lesson.",
    body: [
      "The same pattern can be shown four ways, and each one is good at something different.",
    ],
    examples: [],
    table: {
      caption: "Four representations of one pattern.",
      headers: ["Representation", "What it is best at"],
      rows: [
        ["Table", "seeing the step between one value and the next"],
        ["Graph", "seeing the shape: straight line or curve"],
        ["Words", "explaining it to someone without symbols"],
        ["Equation", "jumping straight to a far-off value"],
      ],
    },
    plot: null,
    check: {
      question: "You need the $200$th value. Which representation do you want?",
      answer: "The equation. A table would need $200$ rows and a graph would run off the page.",
    },
    questionRef: null,
    source: null,
    hints: [],
    teacherNote:
      "Represent the relationship, in exploration Q3, does not say which way. Any of the four is a valid answer; a strong answer gives more than one and says they agree.",
    answers: ["Check: the equation."],
  },
  {
    id: "do-they-agree",
    act: "learn",
    title: "Do They Agree?",
    phase: "formalise",
    minutes: 5,
    core: true,
    purpose: "Deciding whether two representations show the SAME relationship. This is Check Your Understanding Q1 exactly.",
    body: [
      "If two representations show the same relationship, EVERY value must match.",
      "You cannot tell by glancing. Pull actual numbers out of each and compare.",
      "From a table, read the rows. From a graph, read the coordinates of the points.",
      "Then check the BEHAVIOUR too: does each one add, or does each one multiply?",
      "One mismatch is enough to say no.",
    ],
    examples: [
      {
        title: "Example",
        steps: [
          "A table reads $1 \\to 3$, $2 \\to 6$, $3 \\to 12$, so it multiplies by $2$ each step.",
          "A graph shows points at $(1, 3)$, $(2, 6)$, $(3, 9)$.",
          "The first two points agree.",
          "At $x = 3$ the table says $12$ and the graph says $9$.",
        ],
        answer: "No. They agree on two points and disagree on the third, so they are not the same relationship.",
      },
    ],
    table: null,
    plot: null,
    check: {
      question: "A table doubles each step. On a graph, should the points rise by the same amount each time?",
      answer: "No. Doubling makes each jump bigger than the last, so the points curve upward and get steeper.",
    },
    questionRef: null,
    source: null,
    hints: [],
    teacherNote:
      "The trap in CYU Q1 is that the first points match and the later ones cannot. Push students to check the LAST point as well as the first.",
    answers: ["Check: no, the jumps get bigger and the points curve."],
  },
  {
    id: "line-or-curve-again",
    act: "learn",
    title: "Line or Curve, Table or Graph",
    phase: "formalise",
    minutes: 3,
    core: false,
    purpose: "Ties 1.6's arithmetic and geometric to the representations, so the two lessons are one idea.",
    body: [
      "Arithmetic and geometric look different in every representation.",
      "In a TABLE: constant difference is arithmetic, constant ratio is geometric.",
      "In a GRAPH: a straight line is arithmetic, a curve that steepens is geometric.",
      "In WORDS: you either ADD the same amount or MULTIPLY by the same amount.",
      "In an EQUATION: arithmetic has $x$ on the line, geometric has $x$ in the exponent.",
    ],
    examples: [],
    table: null,
    plot: null,
    check: {
      question: "A graph's points curve upward and get steeper. What will the table's ratios do?",
      answer: "They will be constant, because a steepening curve is a geometric pattern.",
    },
    questionRef: null,
    source: null,
    hints: [],
    teacherNote: "The one-row summary worth having on the board all lesson. It is the bridge back to 1.6.",
    answers: ["Check: the ratios will be constant."],
  },
  {
    id: "doubling-two-rules",
    act: "learn",
    title: "Doubling, Two Ways",
    phase: "formalise",
    minutes: 4,
    core: false,
    purpose: "The recursive and explicit rules for a doubling pattern, which Check Your Understanding Q2 needs.",
    body: [
      "A doubling pattern can be written two ways, and both are valid answers.",
      "RECURSIVE: to get the next value, multiply the one you have by $2$.",
      "EXPLICIT: $a_n = a_1 \\cdot 2^{\\,n-1}$, where $a_1$ is the starting value.",
      "The exponent is $n-1$, not $n$: reaching the $n$th value takes $n-1$ doublings.",
      "Count the gaps, not the labels. Same rule as in 1.6.",
    ],
    examples: [
      {
        title: "Example",
        steps: [
          "A count starts at $5$ and doubles each step. Find the 6th value.",
          "From the 1st to the 6th is $6 - 1 = 5$ doublings.",
          "$a_6 = 5 \\cdot 2^{5}$",
          "$2^{5} = 32$, so $a_6 = 5 \\cdot 32 = 160$.",
          "Check by listing: $5, 10, 20, 40, 80, 160$.",
        ],
        answer: "$a_6 = 160$.",
      },
    ],
    table: null,
    plot: null,
    check: {
      question: "A count starts at $3$ and doubles each step. What is the 5th value?",
      answer: "$3 \\cdot 2^{4} = 3 \\cdot 16 = 48$. Listing: $3, 6, 12, 24, 48$.",
    },
    questionRef: null,
    source: null,
    hints: [],
    teacherNote: "Represent in at least two different ways, in CYU Q2(a), is asking for exactly this pair, or for a table and a graph.",
    answers: ["Check: $48$."],
  },
  {
    id: "which-step-is-it",
    act: "learn",
    title: "Working Out Which Step It Is",
    phase: "formalise",
    minutes: 4,
    core: false,
    purpose: "Going backwards from a value to its position, which Check Your Understanding Q2(b) needs.",
    body: [
      "Sometimes you are given the VALUE and asked which step it is.",
      "Divide out the starting value first. What is left is pure doubling.",
      "Then ask how many doublings that is, by halving until you reach $1$.",
      "Finally remember the off-by-one: that many doublings lands you one step further on.",
    ],
    examples: [
      {
        title: "Example",
        steps: [
          "A count starts at $5$ and doubles. Which step has the value $320$?",
          "Divide out the start: $\\dfrac{320}{5} = 64$.",
          "How many doublings make $64$? Halve it: $64, 32, 16, 8, 4, 2, 1$, which is $6$ halvings.",
          "So $64 = 2^{6}$, meaning $6$ doublings after the start.",
          "$6$ doublings after the 1st step is the 7th step.",
        ],
        answer: "The 7th step. Check: $5 \\cdot 2^{6} = 320$.",
      },
    ],
    table: null,
    plot: null,
    check: {
      question: "A count starts at $3$ and doubles. Which step has the value $96$?",
      answer: "$\\dfrac{96}{3} = 32 = 2^{5}$, so $5$ doublings after the 1st step, which is the 6th step.",
    },
    questionRef: null,
    source: null,
    hints: [],
    teacherNote:
      "Dividing out the starting value FIRST is the move students miss; they try to halve the raw number and get a fraction.",
    answers: ["Check: the 6th step."],
  },
];

// ---- Act 2: hints. One slide per worksheet question, one nudge per part.

function hintSlide(
  id: string,
  source: NonNullable<LessonSlide["source"]>,
  questionRef: string,
  title: string,
  body: string[],
  hints: LessonSlide["hints"],
  answers: string[],
  teacherNote = "",
): LessonSlide {
  return {
    id,
    act: "hint",
    title,
    phase: "formalise",
    minutes: 1,
    core: false,
    purpose: `Hints for ${questionRef}.`,
    body,
    examples: [],
    table: null,
    plot: null,
    check: null,
    questionRef,
    source,
    hints,
    teacherNote,
    answers,
  };
}

const HINTS: LessonSlide[] = [
  hintSlide(
    "hint-exp-q1",
    "exploration",
    "Exploration Q1",
    "Boundary points and area for each figure",
    ["Figure A is done for you. Do the other five the same way."],
    [
      {
        part: "counting the points",
        hint: "Go around the outline once and mark every dot as you pass it, so no corner gets counted twice.",
        backTo: "counting-boundary-points",
      },
      {
        part: "finding the area",
        hint: "Count whole squares first, then deal with the slanted edges. Splitting the shape or cutting a triangle off a rectangle is usually quickest.",
        backTo: "area-by-splitting",
      },
    ],
    [
      "A: $10$ points, area $6$ (given). B: $8$ points, area $5$.",
      "C (top row): $9$ points, area $5.5$. C (second row): $13$ points, area $7.5$.",
      "D: $12$ points, area $7$. E: $4$ points, area $3$.",
    ],
    "Two of the six areas are halves, which students will want to round. Let them stand, or the pattern in Q3 disappears.",
  ),
  hintSlide(
    "hint-exp-q2",
    "exploration",
    "Exploration Q2",
    "What do you notice? What do you wonder?",
    ["There is no wrong answer here, but a vague one is no use to you in Q3."],
    [
      {
        part: "",
        hint: "Put your six pairs of numbers in a table and order them by boundary points. Then say what you notice about the two columns.",
        backTo: "put-it-in-a-table",
      },
    ],
    [
      "Expect: the more boundary points, the bigger the area; areas go up by $1$ for every $2$ extra boundary points; odd point counts give half areas.",
    ],
    "Accept anything specific. Push back on I notice they are all different, which is a way of not looking.",
  ),
  hintSlide(
    "hint-exp-q3",
    "exploration",
    "Exploration Q3",
    "Represent the relationship",
    ["Represent does not say how. A table, a graph, words or an equation all count."],
    [
      {
        part: "",
        hint: "Work out how much the area moves for each ONE extra boundary point. Then say the rule as a sentence before you write any symbols.",
        backTo: "say-the-rule-in-words",
      },
    ],
    [
      "In words: halve the number of boundary points, then add $1$.",
      "As an equation: $A = \\tfrac{1}{2}B + 1$, with $B$ the boundary points and $A$ the area.",
      "Check on D: $\\tfrac{1}{2} \\cdot 12 + 1 = 7$, which matches.",
    ],
    "A strong answer gives two representations and says they agree. Insist the letters are defined; an unlabelled formula is not a representation of anything.",
  ),
  hintSlide(
    "hint-exp-q4",
    "exploration",
    "Exploration Q4",
    "Figure F has 11 boundary points",
    ["You are not shown figure F, and you do not need to be."],
    [
      {
        part: "",
        hint: "Put $11$ into the rule you wrote in Q3. Then check your rule still works on one of the figures you can see.",
        backTo: "use-the-rule-to-jump",
      },
    ],
    ["$A = \\tfrac{1}{2} \\cdot 11 + 1 = 6.5$ square units."],
    "An odd boundary count gives a half area, which is correct and worth saying out loud before students assume they have gone wrong.",
  ),
  hintSlide(
    "hint-exp-q5",
    "exploration",
    "Exploration Q5",
    "What about 100 boundary points?",
    ["The question is about METHOD, not about the answer."],
    [
      {
        part: "",
        hint: "Imagine actually drawing a shape with $100$ boundary points and counting its squares. Then compare that with using your rule.",
        backTo: "use-the-rule-to-jump",
      },
    ],
    [
      "No. Drawing and counting would be slow and easy to get wrong.",
      "The rule gives it at once: $\\tfrac{1}{2} \\cdot 100 + 1 = 51$ square units.",
    ],
    "This is the payoff of the whole lesson. Make the comparison explicit: the picture was how we FOUND the rule, and the rule is how we USE it.",
  ),
  hintSlide(
    "hint-cyu-q1",
    "check-your-understanding",
    "Check Your Understanding Q1",
    "Could the graph and the table be the same relationship?",
    ["Two points are labelled on the graph. Use them."],
    [
      {
        part: "",
        hint: "Work out what the table does from each row to the next, then check whether the plotted points do the same thing. Look at the LAST point, not just the first two.",
        backTo: "do-they-agree",
      },
    ],
    [
      "No. The table multiplies by $2$ each row, so the jumps grow: $+2, +4, +8, +16, +32$.",
      "The plotted points rise by roughly the same amount each time, which is a constant difference, not a constant ratio.",
      "Also, $(1, 2)$ and $(3, 8)$ fix the scale, and at that scale $x = 6$ would need $y = 64$, far above the top of the grid shown.",
    ],
    "Both reasons are worth having. The scale argument is the one that settles it for a student who says you cannot tell without axis numbers.",
  ),
  hintSlide(
    "hint-cyu-q2",
    "check-your-understanding",
    "Check Your Understanding Q2",
    "Bacteria doubling from 7",
    ["It starts at $7$ on day $1$ and doubles every day."],
    [
      {
        part: "(a)",
        hint: "Pick two of the four representations. A table and a rule is the quickest pair, and the rule can be the recursive one or the explicit one.",
        backTo: "doubling-two-rules",
      },
      {
        part: "(b)",
        hint: "Divide $3584$ by the starting value first. What is left is pure doubling, so halve it until you reach $1$ and count the halvings.",
        backTo: "which-step-is-it",
      },
    ],
    [
      "(a) Table: $7, 14, 28, 56, 112, 224, \\ldots$ Recursive: double the previous day. Explicit: $a_n = 7 \\cdot 2^{\\,n-1}$.",
      "(b) $\\dfrac{3584}{7} = 512 = 2^{9}$, so $9$ doublings after day $1$, which is DAY $10$.",
      "Check: $7 \\cdot 2^{9} = 7 \\cdot 512 = 3584$.",
    ],
    "Day $9$ is the predictable wrong answer, from counting doublings instead of days. The check line catches it.",
  ),
];

// ---- Act 3: review.

const REVIEW: LessonSlide[] = [
  {
    id: "review-can-you",
    act: "review",
    title: "Can You Do These Now?",
    phase: "formalise",
    minutes: 3,
    core: true,
    purpose: "A self-check against the learning targets.",
    body: [
      "Tick the ones you could do without looking anything up.",
      "Count boundary points without double-counting a corner.",
      "Find an area on a grid, including when the answer ends in a half.",
      "Put measurements in an ordered table and find the step.",
      "Say a rule in words, then write it as an equation with the letters defined.",
      "Decide whether two representations show the same relationship.",
    ],
    examples: [],
    table: null,
    plot: null,
    check: null,
    questionRef: null,
    source: null,
    hints: [],
    teacherNote: "Any box left unticked names the learn slide to go back to; the wording matches those titles.",
    answers: [],
  },
  {
    id: "review-the-rule",
    act: "review",
    title: "The Rule You Found",
    phase: "formalise",
    minutes: 4,
    core: true,
    purpose: "Consolidates the exploration's result in all four representations at once.",
    body: [
      "In words: halve the number of boundary points, then add $1$.",
      "As an equation: $A = \\tfrac{1}{2}B + 1$, where $B$ is boundary points and $A$ is area.",
      "As a graph: the points sit on a straight line that climbs $1$ for every $2$ across.",
      "As a table: see below. Every figure on the sheet fits it.",
    ],
    examples: [],
    table: {
      caption: "Every figure on the worksheet, in order.",
      headers: ["Figure", "Boundary points", "Area"],
      rows: [
        ["E", "$4$", "$3$"],
        ["B", "$8$", "$5$"],
        ["C (top)", "$9$", "$5.5$"],
        ["A", "$10$", "$6$"],
        ["D", "$12$", "$7$"],
        ["C (second)", "$13$", "$7.5$"],
      ],
    },
    plot: {
      caption:
        "The same figures plotted. The points sit on one straight line, climbing 1 for every 2 boundary points, which is what the equation says.",
      xLabel: "Boundary points",
      yLabel: "Area",
      xMax: 14,
      yMax: 8,
      yStep: 2,
      xStep: 2,
      series: [
        {
          label: "Area against boundary points",
          kind: "linear",
          points: [
            [4, 3],
            [8, 5],
            [10, 6],
            [12, 7],
          ],
        },
      ],
    },
    check: null,
    questionRef: null,
    source: null,
    hints: [],
    teacherNote:
      "The plot shows only the four whole-number figures so the points land on gridlines; the two half-area figures sit on the same line between them. WHY the rule works: every figure was built with exactly TWO interior dots, and Pick's theorem $A = I + \\tfrac{1}{2}B - 1$ with $I = 2$ gives exactly this. See the challenge slide.",
    answers: [],
  },
  {
    id: "review-traps",
    act: "review",
    title: "The Four Traps",
    phase: "formalise",
    minutes: 3,
    core: true,
    purpose: "The errors that actually appear on paper.",
    body: [
      "1. Counting a corner twice. Go round the outline once, marking as you go.",
      "2. Rounding a half area away. A half is a real answer and the pattern needs it.",
      "3. Getting the step right and the add-on wrong. Always test the rule on a row.",
      "4. Deciding two representations match from the first point alone. Check the last one too.",
    ],
    examples: [],
    table: null,
    plot: null,
    check: {
      question: "A rule gives the right answer for the first figure and the wrong one for the fourth. What do you change?",
      answer: "The rule. One row that fails means the rule is wrong, not the row.",
    },
    questionRef: null,
    source: null,
    hints: [],
    teacherNote: "Trap 2 is the one that silently ruins the exploration, because a rounded table has no pattern in it.",
    answers: ["Check: change the rule."],
  },
  {
    id: "review-exit-ticket",
    act: "review",
    title: "Exit Ticket",
    phase: "formalise",
    minutes: 5,
    core: true,
    purpose: "Three marks, and students see all three before they write.",
    body: [
      "Here is a table: when $x$ is $1, 2, 3, 4$, then $y$ is $4, 7, 10, 13$.",
      "Write the rule in WORDS.",
      "Write the same rule as an EQUATION, and say what your letters mean.",
      "Then use it to find $y$ when $x = 20$.",
    ],
    examples: [],
    table: {
      caption: "How it is marked, out of $3$.",
      headers: ["Mark", "For"],
      rows: [
        ["$1$", "the words give both the step and the add-on"],
        ["$1$", "the equation matches the words, with the letters defined"],
        ["$1$", "the far-off value is found from the equation, not by extending the table"],
      ],
    },
    plot: null,
    check: null,
    questionRef: null,
    source: null,
    hints: [],
    teacherNote:
      "Answers: multiply $x$ by $3$ then add $1$; $y = 3x + 1$; $y = 3 \\cdot 20 + 1 = 61$. A student who writes out twenty rows gets the first two marks only, and should be told why.",
    answers: ["Words: multiply by $3$, then add $1$.", "Equation: $y = 3x + 1$.", "At $x = 20$: $y = 61$."],
  },
  {
    id: "review-challenge",
    act: "review",
    title: "If You Finished Early",
    phase: "formalise",
    minutes: 6,
    core: false,
    purpose: "The honest extension: why the rule works, and the case that breaks it.",
    body: [
      "1. Draw your own grid shape and test the rule on it. Does it always work?",
      "2. Try one with more dots INSIDE it than the worksheet shapes have.",
      "3. Every figure on the sheet has exactly $2$ dots strictly inside it. Count them and check.",
      "4. Can you find a rule that uses the inside dots as well as the boundary ones?",
    ],
    examples: [],
    table: null,
    plot: null,
    check: null,
    questionRef: null,
    source: null,
    hints: [],
    teacherNote:
      "This is Pick's theorem: $A = I + \\tfrac{1}{2}B - 1$, with $I$ the interior dots. Every worksheet figure has $I = 2$, which is why $A = \\tfrac{1}{2}B + 1$ fits all six. A student who draws a shape with a different $I$ WILL break the rule, and is right to. Be ready for it rather than calling it a mistake.",
    answers: [
      "The general rule is Pick's theorem: $A = I + \\tfrac{1}{2}B - 1$.",
      "With $I = 2$ this becomes $A = \\tfrac{1}{2}B + 1$, the worksheet's rule.",
    ],
  },
];

export const lesson17: Lesson = {
  slug: "1-7-connecting-patterns-across-representations",
  code: "1.7",
  title: "Connecting Patterns across Multiple Representations",
  courseLabel: "Algebra 1",
  bigIdea:
    "One pattern can be shown as a table, a graph, a sentence or an equation, and if they really are the same pattern then every one of them must agree.",
  pacing:
    "The Learn act is the lesson. Slides 1 to 5 are the primer, safe before the exploration, and run about 18 minutes; they teach how to measure and tabulate without giving the pattern away. Take slides 6 to 12 in the debrief, and 13 to 16 before the Check Your Understanding page. The Hint act is not taught. The Review act is the last fifteen minutes, and the exit ticket is on it.",
  materials: ["the Setting Boundaries exploration and its Check Your Understanding page"],
  prerequisites: [
    "Plotting and reading coordinates on a grid",
    "Area of a rectangle and area of a triangle, $\\tfrac{1}{2} \\cdot \\text{base} \\cdot \\text{height}$",
    "Working with a half, and accepting an answer such as $5.5$",
    "Multiplying and dividing whole numbers",
    "Powers of $2$ up to $2^{10} = 1024$",
    "Substituting a number into an expression such as $3x + 2$",
    "Arithmetic and geometric sequences from Lesson 1.6",
  ],
  warmUp: [
    { question: "1. A rectangle is $5$ wide and $3$ tall. What is its area?", answer: "Answer: $15$ square units." },
    { question: "2. A triangle has base $4$ and height $3$. What is its area?", answer: "Answer: $6$ square units." },
    { question: "3. Work out $3 \\cdot 7 + 2$.", answer: "Answer: $23$." },
    { question: "4. What is $2^{6}$?", answer: "Answer: $64$." },
    { question: "5. Halve $512$ until you reach $1$. How many halvings?", answer: "Answer: $9$, because $512 = 2^{9}$." },
  ],
  learningTargets: [
    "I can count the boundary points of a grid shape without double-counting a corner.",
    "I can find the area of a grid shape, including when the answer ends in a half.",
    "I can put measurements into an ordered table and find the step between rows.",
    "I can say a rule in words, and then write the same rule as an equation with the letters defined.",
    "I can plot pairs from a table and say whether the pattern adds or multiplies.",
    "I can test a rule on every row rather than just the first.",
    "I can use an equation to reach a value far beyond the table.",
    "I can decide whether two representations show the same relationship.",
  ],
  vocabulary: [
    {
      term: "Grid shape",
      definition: "A shape whose corners all sit on the dots of a coordinate grid.",
      example: "A rectangle drawn from $(0,0)$ to $(3,2)$.",
    },
    {
      term: "Boundary point",
      definition: "A grid dot that sits ON the edge of the shape. Corners count; dots inside do not.",
      example: "A $1$ by $1$ square has $4$ boundary points, one at each corner.",
    },
    {
      term: "Interior point",
      definition: "A grid dot strictly INSIDE the shape, not on its edge.",
      example: "A $3$ by $2$ rectangle has $2$ interior points.",
    },
    {
      term: "Square unit",
      definition: "The area of one small square of the grid. Areas are measured in these.",
      example: "A $4$ by $3$ rectangle has an area of $12$ square units.",
    },
    {
      term: "Representation",
      definition: "One of the ways of showing a pattern: a table, a graph, words, or an equation.",
      example: "$y = 3x + 2$ and a table of $x$ and $y$ values are two representations of one pattern.",
    },
    {
      term: "Step",
      definition: "How much the second quantity moves for each ONE increase in the first.",
      example: "In $5, 8, 11, 14$ against $1, 2, 3, 4$, the step is $3$.",
    },
    {
      term: "Recursive rule",
      definition: "How to get the NEXT value from the one you have.",
      example: "Double the previous day's count.",
    },
    {
      term: "Explicit rule",
      definition: "How to jump straight to any value without listing the ones before it.",
      example: "$a_n = 7 \\cdot 2^{\\,n-1}$.",
    },
  ],
  slides: [...LEARN, ...HINTS, ...REVIEW],
  misconceptions: [
    {
      misconception: "Counting a corner dot twice when going round the outline.",
      whyItHappens: "A corner belongs to two edges, so it gets counted once for each.",
      howToFixIt: "Go round once in a single direction, marking each dot as you pass it.",
    },
    {
      misconception: "Counting dots inside the shape as boundary points.",
      whyItHappens: "The word boundary is skipped and the shape's dots all look alike.",
      howToFixIt: "Only dots ON the edge count. The inside dots matter later, in Pick's theorem.",
    },
    {
      misconception: "Rounding an area of $5.5$ up to $6$.",
      whyItHappens: "Areas feel like they ought to be whole numbers.",
      howToFixIt: "A slanted edge cuts squares in half, so halves are expected. Rounding destroys the pattern.",
    },
    {
      misconception: "Finding the step but forgetting the add-on.",
      whyItHappens: "The step is the visible part of the pattern, so the rule feels finished once it is found.",
      howToFixIt: "Substitute one row back into the rule. If it misses by a constant, that constant is the add-on.",
    },
    {
      misconception: "Writing an equation with letters that are never defined.",
      whyItHappens: "The meaning is obvious to the student at the time.",
      howToFixIt: "Write where $B$ is the number of boundary points and $A$ is the area beside every formula.",
    },
    {
      misconception: "Reading the step off the second column when the first column does not go up in ones.",
      whyItHappens: "The differences look constant, so the rate seems obvious.",
      howToFixIt: "Ask how much the first column moved as well, then work out the change per ONE step.",
    },
    {
      misconception: "Deciding two representations match because the first point matches.",
      whyItHappens: "A doubling pattern and a linear one agree at the start and only separate later.",
      howToFixIt: "Check the LAST point too. One mismatch anywhere is enough to say no.",
    },
    {
      misconception: "Extending the table instead of using the equation.",
      whyItHappens: "The table is concrete and the equation feels risky.",
      howToFixIt: "Fine for the next row, hopeless for the hundredth. The equation is the reason for finding a rule at all.",
    },
    {
      misconception: "Counting doublings and reporting that as the day number.",
      whyItHappens: "Nine doublings feels like day $9$.",
      howToFixIt: "Count the gaps, not the labels: $9$ doublings after day $1$ lands on day $10$.",
    },
  ],
  exitTicket: {
    task: "A table shows $y$ as $4, 7, 10, 13$ when $x$ is $1, 2, 3, 4$. Write the rule in words, then as an equation with your letters defined, then use it to find $y$ when $x = 20$.",
    rubric: [
      "The words give BOTH the step and the add-on.",
      "The equation matches the words, and the letters are defined.",
      "The far-off value comes from the equation, not from extending the table.",
    ],
  },
  challenge: [
    {
      task: "Draw your own grid shape with a different number of dots strictly inside it, then test the rule from the exploration on it. Does it still work?",
      answer:
        "No. The worksheet rule works only because every printed figure has exactly $2$ interior dots. Change that and the rule fails, which is the right discovery to make.",
    },
    {
      task: "Find a rule that uses the interior dots as well as the boundary ones.",
      answer:
        "Pick's theorem: $A = I + \\tfrac{1}{2}B - 1$, where $I$ is the number of interior dots. Putting $I = 2$ gives $A = \\tfrac{1}{2}B + 1$, the worksheet's rule.",
    },
  ],
  openQuestions: [
    {
      item: "The worksheet prints the letter C twice",
      whyUnresolved:
        "The top-row shape and the second-row shape are both labelled C. There is no figure labelled with the missing letter, so the sheet has six figures and five distinct labels.",
      whatWasDone:
        "The answer key and the review table distinguish them as C (top) and C (second). Worth relabelling the second one before printing, so students can talk about them.",
    },
    {
      item: "Figure F is not shown, by design",
      whyUnresolved: "Q4 names a figure that is deliberately absent, which some students read as a printing error.",
      whatWasDone:
        "The Q4 hint says outright that you are not shown it and do not need to be. Say the same thing aloud when you hand the sheet out.",
    },
    {
      item: "Why the rule works is not on the worksheet",
      whyUnresolved:
        "The sheet asks for the relationship but never says that every figure was built with exactly $2$ interior dots, which is the only reason a boundary-points-only rule exists.",
      whatWasDone:
        "Recorded in the teacher note on the review slide and made the extension task. A student who draws their own shape will break the rule; that is correct mathematics and should be welcomed, not marked wrong.",
    },
    {
      item: "No separate homework sheet was supplied for 1.7",
      whyUnresolved:
        "Lesson 1.6 came with a ten-question A1 homework as well as the exploration. Only the exploration and its Check Your Understanding page were provided here.",
      whatWasDone:
        "The Hint act covers the seven questions that exist. If an A1 1.7 homework exists, its questions can be added as further hint slides without touching anything else.",
    },
  ],
};
