import type { MarkSchemeExplanation } from "../mark-scheme-explanation";

/**
 * Hand-written explanations of real parts of the two released Key Assessment
 * 1 papers (Grade 9 Extended and Grade 9 Standard Level), plus one graph
 * part, in the form lib/mark-scheme-explanation.ts stores. Between them they
 * use every kind of diagram.
 *
 * Not read at runtime. They pin, in lib/mark-scheme-explanation.test.ts,
 * that realistic explanations -- the level of detail the prompt asks for --
 * pass checkExplanation, and they are what a browser check of the student
 * card renders when no written explanation is to hand. Each carries the
 * teacher's own answer and scheme beside it, as the card shows both.
 */
export interface ExplanationFixture {
  label: string;
  maxMarks: number;
  prompt: string;
  answer: string;
  markScheme: string;
  explanation: MarkSchemeExplanation;
}

export const EXPLANATION_FIXTURES: ExplanationFixture[] = [
  {
    label: "3.2(b)",
    maxMarks: 3,
    prompt: "Consider the equation $\\frac{w + 1}{w - 3} + 4 = \\frac{2w + 7}{w - 3}$. Solve the equation. Show every step.",
    answer: "$w = 6$",
    markScheme:
      "M1 for multiplying EVERY term by (w - 3): (w + 1) + 4(w - 3) = 2w + 7. M1 for expanding and collecting to 3w = 18 or equivalent. A1 for the answer w = 6, supported by valid working. Multiplying the fractions but not the 4 is the common error: no mark for the first step, then follow-through, so that route scores 1 of 3. An answer of w = 6 with no working earns no answer mark.",
    explanation: {
      answer: "$w = 6$",
      marks: [
        { marks: 1, text: "Multiply **every** term by $(w - 3)$: $(w + 1) + 4(w - 3) = 2w + 7$" },
        { marks: 1, text: "Expand and collect the terms to get $3w = 18$" },
        { marks: 1, text: "Correct answer $w = 6$, with the working that leads to it" },
      ],
      watch: [
        "Multiply the $4$ by $(w - 3)$ too. Forgetting it is the most common mistake, and it costs the first mark.",
        "The answer $w = 6$ with no working earns no marks.",
      ],
      steps: [
        {
          title: "Spot the shared denominator",
          body: "Both fractions have the same denominator (the bottom of the fraction): $w - 3$. Multiplying **every** term by $w - 3$ clears both fractions at once.",
          diagram: null,
          more: "A term is a piece of the equation separated by $+$, $-$ or $=$. This equation has three terms: $\\frac{w + 1}{w - 3}$, then $4$, then $\\frac{2w + 7}{w - 3}$. All three must be multiplied by $w - 3$, not just the two fractions. That keeps both sides equal.",
        },
        {
          title: "Multiply every term",
          body: "Each fraction loses its denominator. The $4$ becomes $4(w - 3)$. $$(w + 1) + \\blue{4(w - 3)} = 2w + 7$$",
          diagram: null,
          more: "The fraction bar means \"divide by $w - 3$\". Multiplying by $w - 3$ undoes that, so each denominator cancels. The $4$ has no denominator, so it keeps the $(w - 3)$ as a bracket: $4(w - 3)$, shown in blue. Writing just $4$ there is the mistake that loses the first mark.",
        },
        {
          title: "Expand and solve",
          body: "Expand the bracket, collect like terms, then solve.",
          diagram: {
            kind: "working",
            lines: [
              { math: "(w + 1) + 4(w - 3) = 2w + 7", note: "" },
              { math: "w + 1 + 4w - 12 = 2w + 7", note: "expand $4(w - 3)$" },
              { math: "5w - 11 = 2w + 7", note: "collect like terms" },
              { math: "3w = 18", note: "subtract $2w$ and add $11$ on both sides" },
              { math: "w = 6", note: "divide both sides by $3$" },
            ],
            caption: "Five lines of working from (w + 1) + 4(w - 3) = 2w + 7 down to w = 6, with the move made at each line.",
          },
          more: "Expanding means multiplying out the bracket: $4 \\times w = 4w$ and $4 \\times (-3) = -12$. Like terms have the same letter, so $w + 4w = 5w$ and $1 - 12 = -11$. Then move the $w$ terms to one side and the numbers to the other.",
        },
        {
          title: "Check the answer is allowed",
          body: "In part (a) you found the equation is undefined at $w = 3$. Your answer is $6$, not $3$, so it is a real solution.",
          diagram: {
            kind: "number_line",
            min: 0,
            max: 8,
            step: 1,
            points: [
              { value: 3, label: "3", open: true },
              { value: 6, label: "6", open: false },
            ],
            jumps: [],
            ranges: [],
            caption: "A number line with a hollow circle at 3, the value that is not allowed, and a filled dot at 6, the solution.",
          },
          more: "At $w = 3$ the denominator $w - 3$ is $0$, and dividing by $0$ has no answer. So $w = 3$ can never be a solution. You can also check $w = 6$ directly: the left side is $\\frac{7}{3} + 4 = \\frac{19}{3}$ and the right side is $\\frac{19}{3}$.",
        },
      ],
    },
  },
  {
    label: "3.4(a)",
    maxMarks: 2,
    prompt: "Expand and simplify $(5 - x)(x - 3)$.",
    answer: "$-x^{2} + 8x - 15$",
    markScheme:
      "M1 for all four products: 5x - 15 - x^2 + 3x. A single slip in one product still earns the method mark when the other three products are correct. A1 for the answer -x^2 + 8x - 15 exactly (accept 8x - x^2 - 15); a slipped product loses the answer mark, with no follow-through.",
    explanation: {
      answer: "$-x^{2} + 8x - 15$",
      marks: [
        { marks: 1, text: "Write all four products: $5x - 15 - x^{2} + 3x$" },
        { marks: 1, text: "Correct answer: $-x^{2} + 8x - 15$" },
      ],
      watch: [
        "One slip in one product still earns the first mark if the other three are right.",
        "Watch the sign: $-x \\times (-3) = +3x$.",
      ],
      steps: [
        {
          title: "Multiply every pair",
          body: "Each term in the first bracket multiplies each term in the second bracket. That makes $2 \\times 2 = 4$ products.",
          diagram: {
            kind: "area_model",
            rowHeads: ["5", "-x"],
            colHeads: ["x", "-3"],
            cells: [
              ["5x", "-15"],
              ["-x^{2}", "3x"],
            ],
            caption: "A two by two grid: 5 and -x down the side, x and -3 along the top, and their four products inside.",
          },
          more: "Read each cell as \"row times column\". $5 \\times x = 5x$. $5 \\times (-3) = -15$. $-x \\times x = -x^{2}$. $-x \\times (-3) = +3x$, because a negative times a negative is positive.",
        },
        {
          title: "Collect like terms",
          body: "$5x$ and $3x$ are like terms (the same letter to the same power), so add them.",
          diagram: {
            kind: "working",
            lines: [
              { math: "5x - 15 - x^{2} + 3x", note: "" },
              { math: "-x^{2} + \\blue{5x + 3x} - 15", note: "put like terms side by side" },
              { math: "-x^{2} + 8x - 15", note: "add $5x + 3x$" },
            ],
            caption: "Three lines of working that collect 5x and 3x into 8x.",
          },
          more: "$-x^{2}$ and $-15$ have no like terms, so they stay as they are. Writing the $x^{2}$ term first is usual, but $8x - x^{2} - 15$ is the same expression and also gets the mark.",
        },
        {
          title: "Check with a number",
          body: "Put $x = 1$ into both forms. $$(5 - 1)(1 - 3) = -8 \\qquad -1 + 8 - 15 = -8$$ They match, so the expansion is right.",
          diagram: null,
          more: "Any number works for this check, but a small one keeps the arithmetic easy. If the two results are different, one of your four products has a slip, most often a sign.",
        },
      ],
    },
  },
  {
    label: "2(b)",
    maxMarks: 2,
    prompt: "Consider the sequence 88, 82, 76, 70, 64, ... Write an explicit rule to find the $n$th term in the sequence.",
    answer: "",
    markScheme:
      "A full-mark response gives a correct explicit rule: $94 - 6n$ (accept any equivalent, e.g. $88 - 6(n - 1)$ or $-6n + 94$). 2 marks: one for the structure (a linear rule in $n$ with the common difference $-6$ as the coefficient), one for the correct constant so the rule gives 88 at $n = 1$. An off-by-one rule such as $88 - 6n$ earns 1. A recursive description (\"subtract 6 each time\") is not an explicit rule and earns 0.",
    explanation: {
      answer: "$94 - 6n$, or any equal form such as $88 - 6(n - 1)$",
      marks: [
        { marks: 1, text: "A rule in $n$ with $-6n$, because the terms go down by $6$" },
        { marks: 1, text: "The right starting number, so that $n = 1$ gives $88$" },
      ],
      watch: [
        "$88 - 6n$ gives $82$ when $n = 1$, so it earns only 1 mark.",
        "\"Subtract $6$ each time\" is not an explicit rule, and earns 0 marks.",
      ],
      steps: [
        {
          title: "Find the change",
          body: "Each term is $6$ less than the one before. So the rule has $-6n$ in it.",
          diagram: {
            kind: "sequence",
            terms: ["88", "82", "76", "70", "64"],
            jumps: ["-6", "-6", "-6", "-6"],
            caption: "The terms 88, 82, 76, 70, 64 with an arrow marked minus 6 between each pair.",
          },
          more: "The change between neighbouring terms is called the common difference. Here it is $-6$. In an explicit rule the common difference is the number in front of $n$, so the rule starts with $-6n$.",
        },
        {
          title: "Find the starting number",
          body: "Work back one step from the first term: $88 + 6 = 94$. That is the value at position $0$.",
          diagram: {
            kind: "table",
            header: ["Position $n$", "Term"],
            rows: [
              ["$0$", "$94$"],
              ["$1$", "$88$"],
              ["$2$", "$82$"],
              ["$3$", "$76$"],
            ],
            caption: "A table of positions 0 to 3 and their terms, 94, 88, 82 and 76.",
          },
          more: "Position $0$ comes one step before the first term. Going backwards undoes the $-6$, so you add $6$. The rule is \"start at position $0$, then take away $6$ for each step\".",
        },
        {
          title: "Put it together",
          body: "Start at $94$ and take away $6$ for every step: $$94 - 6n$$ Check: $n = 1$ gives $94 - 6 = 88$.",
          diagram: null,
          more: "Always test a rule on the first two positions. $n = 1$ gives $88$ and $n = 2$ gives $94 - 12 = 82$. Both match the sequence, so the rule is right.",
        },
      ],
    },
  },
  {
    label: "9(a)",
    maxMarks: 2,
    prompt: "Look at the pattern made from square tiles. Describe how the visual pattern is changing.",
    answer: "",
    markScheme:
      "A full-mark response describes the change well enough that a reader could draw the next figure: 3 tiles are added each time, one at each of the three growing ends. 2 marks: one for the amount (3 tiles per figure), one for WHERE the new tiles go. A description giving only the total change, with nothing about where, earns 1. An annotated sketch showing the added tiles counts as description.",
    explanation: {
      answer: "Each figure adds $3$ tiles: one at each end of the row, and one at the end of the line below it.",
      marks: [
        { marks: 1, text: "How many are added: $3$ tiles each time" },
        { marks: 1, text: "Where they go: one at each end of the row, one at the end of the line" },
      ],
      watch: [
        "\"It adds $3$ each time\" with nothing about where earns 1 mark.",
        "A sketch with the new tiles marked counts as a description.",
      ],
      steps: [
        {
          title: "Count each figure",
          body: "Figure 1 has $4$ tiles, Figure 2 has $7$ and Figure 3 has $10$. Each figure has $3$ more tiles than the one before.",
          diagram: {
            kind: "tiles",
            figures: [
              {
                label: "Figure 1",
                tiles: [
                  { row: 0, col: 0, isNew: false },
                  { row: 0, col: 1, isNew: false },
                  { row: 0, col: 2, isNew: false },
                  { row: 1, col: 1, isNew: false },
                ],
              },
              {
                label: "Figure 2",
                tiles: [
                  { row: 0, col: 0, isNew: true },
                  { row: 0, col: 1, isNew: false },
                  { row: 0, col: 2, isNew: false },
                  { row: 0, col: 3, isNew: false },
                  { row: 0, col: 4, isNew: true },
                  { row: 1, col: 2, isNew: false },
                  { row: 2, col: 2, isNew: true },
                ],
              },
              {
                label: "Figure 3",
                tiles: [
                  { row: 0, col: 0, isNew: true },
                  { row: 0, col: 1, isNew: false },
                  { row: 0, col: 2, isNew: false },
                  { row: 0, col: 3, isNew: false },
                  { row: 0, col: 4, isNew: false },
                  { row: 0, col: 5, isNew: false },
                  { row: 0, col: 6, isNew: true },
                  { row: 1, col: 3, isNew: false },
                  { row: 2, col: 3, isNew: false },
                  { row: 3, col: 3, isNew: true },
                ],
              },
            ],
            caption: "Figures 1 to 3 of the tile pattern, with 4, 7 and 10 tiles. In Figures 2 and 3 the three new tiles are striped.",
          },
          more: "Count the row first, then the line below it. Figure 1 is $3 + 1$, Figure 2 is $5 + 2$, Figure 3 is $7 + 3$. The row grows by $2$ and the line grows by $1$, so $3$ tiles are added altogether.",
        },
        {
          title: "Say where they go",
          body: "Two new tiles go on the row, one at each end. One new tile goes at the bottom of the line.",
          diagram: null,
          more: "Imagine telling a friend how to draw Figure 4 without showing them. \"Add one tile to each end of the row and one to the bottom of the line\" is enough for them to draw it. Words like \"left\", \"right\" and \"below\" all work.",
        },
      ],
    },
  },
  {
    label: "4.3(a)",
    maxMarks: 2,
    prompt: "A shop takes 20% off the price of a jacket, and then takes a further 10% off the reduced price. The jacket costs $c$ dollars. Write an expression for the price after both reductions, and simplify it.",
    answer: "$0.90(0.80c) = 0.72c$",
    markScheme:
      "M1 for both reductions applied in sequence: 0.90 x 0.80c. A1 for the simplified 0.72c, written down. Subtracting the percentages in one step (c - 0.30c, or 0.70c) earns 0.",
    explanation: {
      answer: "$0.90(0.80c) = 0.72c$",
      marks: [
        { marks: 1, text: "Apply both reductions, one after the other: $0.90 \\times 0.80c$" },
        { marks: 1, text: "Simplify it to $0.72c$" },
      ],
      watch: [
        "Taking $30\\%$ off in one step, $0.70c$, earns 0 marks.",
        "Leaving $0.90(0.80c)$ without simplifying loses the second mark.",
      ],
      steps: [
        {
          title: "First, 20% off",
          body: "$20\\%$ off means you pay the other $80\\%$ of the price. $$0.80c$$",
          diagram: {
            kind: "bar_model",
            bars: [
              {
                label: "The price, $c$ dollars",
                segments: [
                  { value: 80, label: "$80\\%$ you pay", shaded: false },
                  { value: 20, label: "$20\\%$ off", shaded: true },
                ],
              },
            ],
            caption: "A bar for the price c split into 80 percent that you pay and a hatched 20 percent that is taken off.",
          },
          more: "A percentage off leaves $100\\%$ minus that percentage. $100\\% - 20\\% = 80\\%$, and $80\\%$ as a decimal is $0.80$. So the price after the first reduction is $0.80 \\times c$, written $0.80c$.",
        },
        {
          title: "Then 10% off the new price",
          body: "The second $10\\%$ comes off the **reduced** price, so you pay $90\\%$ of $0.80c$. $$0.90 \\times 0.80c = 0.72c$$",
          diagram: {
            kind: "bar_model",
            bars: [
              {
                label: "The price after the first reduction, $0.80c$",
                segments: [
                  { value: 72, label: "$0.72c$ you pay", shaded: false },
                  { value: 8, label: "$10\\%$", shaded: true },
                ],
              },
            ],
            caption: "A bar for 0.80c split into 0.72c that you pay and a hatched 10 percent of 0.80c that is taken off.",
          },
          more: "Multiply the decimals: $0.9 \\times 0.8 = 0.72$. So after both reductions you pay $0.72c$ dollars. That is $72\\%$ of the original price.",
        },
        {
          title: "Why it is not 30% off",
          body: "You pay $72\\%$, so the total saving is $28\\%$, not $30\\%$. The second $10\\%$ was taken from a smaller price.",
          diagram: null,
          more: "Try a price of \\$100. After $20\\%$ off it is \\$80. Then $10\\%$ of \\$80 is \\$8, so it drops to \\$72. You saved \\$28 in all: that is $28\\%$ of \\$100.",
        },
      ],
    },
  },
  {
    label: "5",
    maxMarks: 2,
    prompt: "Sketch the graph of $y = x^2 - 4$ and write down where it crosses the $x$-axis.",
    answer: "$x = -2$ and $x = 2$",
    markScheme: "M1 for setting x^2 - 4 = 0. A1 for both x = -2 and x = 2.",
    explanation: {
      answer: "$x = -2$ and $x = 2$",
      marks: [
        { marks: 1, text: "Set $y = 0$: $x^2 - 4 = 0$" },
        { marks: 1, text: "Both answers: $x = -2$ and $x = 2$" },
      ],
      watch: ["A square root has two answers here: $2$ and $-2$. Giving only one loses the answer mark."],
      steps: [
        {
          title: "Where the graph meets the axis",
          body: "Every point on the $x$-axis has $y = 0$. So solve $$x^2 - 4 = 0$$",
          diagram: {
            kind: "graph",
            xMin: -4,
            xMax: 4,
            yMin: -5,
            yMax: 6,
            curves: [{ expr: "x^2 - 4", label: "y = x^2 - 4" }],
            points: [
              { x: -2, y: 0, label: "(-2, 0)", open: false },
              { x: 2, y: 0, label: "(2, 0)", open: false },
            ],
            caption: "The U-shaped graph of y = x squared minus 4, crossing the x-axis at -2 and at 2.",
          },
          more: "The $x$-axis is the horizontal line where the height $y$ is zero. A graph crosses it wherever its $y$ value is $0$, so you replace $y$ with $0$ and solve for $x$.",
        },
        {
          title: "Solve for x",
          body: "Add $4$ to both sides: $x^2 = 4$. Both $2^2$ and $(-2)^2$ equal $4$. $$x = \\pm 2$$",
          diagram: null,
          more: "The symbol $\\pm$ means \"plus or minus\", so $x = \\pm 2$ is two answers: $x = 2$ and $x = -2$. You can see both on the graph, one on each side of the $y$-axis.",
        },
      ],
    },
  },
];
