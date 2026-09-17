import type { Lesson, LessonSlide } from "./types";

/** Lesson 2.1 -- Proportional Reasoning. First lesson of unit 2.
 *
 *  Written against one worksheet: the "How Much Does It Cost to Get Gas?"
 *  exploration (Q1-Q7) and the Check Your Understanding page that follows
 *  it (Q1 a-e rolls, Q2 soup cans, Q3 t-shirt table).
 *
 *  THE NUMBER EVERYTHING HANGS ON. Malik pays \$40.68 for 12 gallons, so
 *  premium is \$3.39 a gallon exactly. Every answer on the exploration comes
 *  out of that one division:
 *
 *      Q1  24 gallons          -> \$81.36
 *      Q2  4 gallons           -> \$13.56
 *      Q3  Zuri's pump reads 17.465 gallons -> \$59.21 (59.20635 exactly)
 *      Q4  \$30.59             -> about 9.02 gallons (9.0236)
 *      Q5  y = 3.39x
 *      Q6  x = 0 gives y = 0, and yes it makes sense: no gas, no charge
 *      Q7  Penny pays 51.15/15 = \$3.41 a gallon, so MALIK's station is cheaper
 *
 *  Q3's figure is a photograph of a pump display; the gallons had to be read
 *  off the rendered page rather than the text layer.
 *
 *  THE TRAP IN CHECK YOUR UNDERSTANDING Q3 is the point of the whole lesson.
 *  The t-shirt table starts at (0, 0), which is the thing students are told
 *  to look for, but the cost per shirt runs \$12, \$12, \$11, \$10. Passing
 *  through the origin is NECESSARY and NOT SUFFICIENT, and this lesson is
 *  built so that a student who only checks the origin gets it wrong.
 *
 *  MONEY IS WRITTEN AS \$ IN PROSE, NEVER INSIDE A MATH SPAN.
 *  splitSegments() closes an inline span on the first bare dollar it meets,
 *  so an escaped dollar inside `$...$` truncates the span and hands KaTeX a
 *  lone backslash. There is a test for it.
 */

// ---- Act 1: learn. One idea each, at most one worked example.
//
// The primer teaches unit rates and scaling on contexts that are NOT gas,
// and never uses the words proportional or origin, because Q5 and Q6 of the
// exploration are exactly that discovery.

const LEARN: LessonSlide[] = [
  {
    id: "scaling-two-quantities",
    act: "learn",
    title: "When Two Amounts Scale Together",
    phase: "primer",
    minutes: 3,
    core: true,
    purpose: "The intuition first: doubling one doubles the other. No formal language yet.",
    body: [
      "Some pairs of amounts move together in a very simple way.",
      "Buy twice as much, pay twice as much. Buy half as much, pay half as much.",
      "Three times the tickets means three times the money.",
      "If you can get from one case to another by multiplying, you can often skip the hard work.",
    ],
    examples: [
      {
        title: "Example",
        steps: [
          "$6$ apples cost $4$ dollars. What do $12$ apples cost?",
          "$12$ is $2$ times $6$.",
          "So the cost is $2$ times $4$ dollars.",
        ],
        answer: "$8$ dollars.",
      },
    ],
    table: null,
    plot: null,
    check: {
      question: "$5$ pens cost $3$ dollars. What do $15$ pens cost?",
      answer: "$15$ is $3$ times $5$, so the cost is $3 \\cdot 3 = 9$ dollars.",
    },
    questionRef: null,
    source: null,
    hints: [],
    teacherNote: "Scaling by a whole number first. The unit rate comes next and is more powerful, but this is the move students already own.",
    answers: ["Check: $9$ dollars."],
  },
  {
    id: "finding-the-unit-rate",
    act: "learn",
    title: "Finding the Unit Rate",
    phase: "primer",
    minutes: 4,
    core: true,
    purpose: "The single most useful move in the lesson: divide to get the per-one amount.",
    body: [
      "The UNIT RATE is how much you get, or pay, for exactly ONE.",
      "Find it by DIVIDING the total by the number of items.",
      "Say it with the word per: dollars per ticket, grams per roll, inches per can.",
      "Once you have the unit rate, every other case is one multiplication away.",
    ],
    examples: [
      {
        title: "Example",
        steps: [
          "$7$ cinema tickets cost $91$ dollars. Find the cost of one ticket.",
          "Divide the total by the number of tickets.",
          "$\\dfrac{91}{7} = 13$",
        ],
        answer: "$13$ dollars per ticket.",
      },
    ],
    table: null,
    plot: null,
    check: {
      question: "$8$ notebooks cost $20$ dollars. What is the cost of one notebook?",
      answer: "$\\dfrac{20}{8} = 2.5$, so $2.50$ dollars per notebook.",
    },
    questionRef: null,
    source: null,
    hints: [],
    teacherNote:
      "Which way round to divide is the slip. Ask what ONE of them costs, and the words tell you the total goes on top.",
    answers: ["Check: $2.50$ dollars per notebook."],
  },
  {
    id: "using-the-unit-rate",
    act: "learn",
    title: "Using the Unit Rate",
    phase: "primer",
    minutes: 3,
    core: true,
    purpose: "Forwards: rate times amount. Works for any amount, tidy or not.",
    body: [
      "Once you know the amount for ONE, multiply to get the amount for any number.",
      "total $=$ unit rate $\\cdot$ how many",
      "This works for awkward numbers, where scaling by doubling or halving will not reach.",
      "Keep the full unit rate in your calculator; round only the answer you write down.",
    ],
    examples: [
      {
        title: "Example",
        steps: [
          "Tickets are $13$ dollars each. What do $23$ tickets cost?",
          "$13 \\cdot 23$",
          "$= 299$",
        ],
        answer: "$299$ dollars.",
      },
    ],
    table: null,
    plot: null,
    check: {
      question: "Rope costs $2.40$ dollars per metre. What do $6.5$ metres cost?",
      answer: "$2.40 \\cdot 6.5 = 15.60$, so $15.60$ dollars.",
    },
    questionRef: null,
    source: null,
    hints: [],
    teacherNote: "The point of the unit rate is that it handles the ugly cases. Make sure at least one check uses a decimal amount.",
    answers: ["Check: $15.60$ dollars."],
  },
  {
    id: "working-backwards-from-a-total",
    act: "learn",
    title: "Working Backwards from a Total",
    phase: "primer",
    minutes: 4,
    core: true,
    purpose: "Backwards: given the total, divide by the rate. Students reach for multiplication here and get it upside down.",
    body: [
      "Sometimes you are told the TOTAL and asked how many you got.",
      "That is the reverse, so DIVIDE the total by the unit rate.",
      "how many $=$ total $\\div$ unit rate",
      "Check your answer by multiplying back. It should land on the total you started with.",
    ],
    examples: [
      {
        title: "Example",
        steps: [
          "Tickets are $13$ dollars each. Someone spent $208$ dollars. How many tickets?",
          "$\\dfrac{208}{13}$",
          "$= 16$",
          "Check: $13 \\cdot 16 = 208$.",
        ],
        answer: "$16$ tickets.",
      },
    ],
    table: null,
    plot: null,
    check: {
      question: "Rope costs $2.40$ dollars per metre. How much rope for $18$ dollars?",
      answer: "$\\dfrac{18}{2.40} = 7.5$ metres. Check: $2.40 \\cdot 7.5 = 18$.",
    },
    questionRef: null,
    source: null,
    hints: [],
    teacherNote:
      "Multiplying by the rate instead of dividing is the predictable error. The multiply-back check catches it every time, so make it compulsory.",
    answers: ["Check: $7.5$ metres."],
  },
  {
    id: "sensible-answers",
    act: "learn",
    title: "What Kind of Answer Makes Sense?",
    phase: "primer",
    minutes: 3,
    core: true,
    purpose: "Rounding rules that decide several answers on this worksheet. Cheap to teach, expensive to omit.",
    body: [
      "Money is written to the CENT, so round to two decimal places.",
      "A measurement can be a decimal: $7.5$ metres or $2.4$ litres is a fine answer.",
      "But a COUNT of whole things cannot. You cannot bake $57.12$ rolls.",
      "For whole things you must round DOWN, because you cannot finish the last one.",
      "Say which kind of quantity you have BEFORE you round.",
    ],
    examples: [
      {
        title: "Example",
        steps: [
          "Boxes hold $12$ eggs. You have $100$ eggs. How many full boxes?",
          "$\\dfrac{100}{12} \\approx 8.33$",
          "Boxes are whole things, and the ninth box is not full.",
        ],
        answer: "$8$ full boxes.",
      },
    ],
    table: null,
    plot: null,
    check: {
      question: "A recipe needs $150$ g of flour per cake. You have $700$ g. How many whole cakes?",
      answer: "$\\dfrac{700}{150} \\approx 4.67$, and a cake is a whole thing, so $4$ cakes.",
    },
    questionRef: null,
    source: null,
    hints: [],
    teacherNote:
      "Rounding $4.66$ up to $5$ is the instinct drilled in from every other rounding lesson. Name the difference out loud: this is not rounding, it is asking how many fit.",
    answers: ["Check: $4$ cakes."],
  },
  {
    id: "what-proportional-means",
    act: "learn",
    title: "What Proportional Means",
    phase: "formalise",
    minutes: 4,
    core: true,
    purpose: "The definition, after students have met it in the exploration. Constant ratio is the whole test.",
    body: [
      "Two quantities are PROPORTIONAL when the ratio between them never changes.",
      "That means the unit rate is the SAME no matter which pair you look at.",
      "Divide $y$ by $x$ for one pair, then for another. Same answer both times?",
      "Same every time means proportional. One different answer means not.",
      "The constant you get is called the CONSTANT OF PROPORTIONALITY, written $k$.",
    ],
    examples: [
      {
        title: "Example",
        steps: [
          "Pairs: $2$ items cost $7$ dollars, $5$ items cost $17.50$ dollars.",
          "$\\dfrac{7}{2} = 3.5$",
          "$\\dfrac{17.50}{5} = 3.5$",
          "Both give the same number.",
        ],
        answer: "Proportional, with $k = 3.5$ dollars per item.",
      },
    ],
    table: null,
    plot: null,
    check: {
      question: "Is $3$ for $12$ dollars and $5$ for $22$ dollars proportional?",
      answer: "$\\dfrac{12}{3} = 4$ but $\\dfrac{22}{5} = 4.4$. Different, so NOT proportional.",
    },
    questionRef: null,
    source: null,
    hints: [],
    teacherNote: "$k$ IS the unit rate, in the same units. Say that plainly; students treat them as two separate ideas otherwise.",
    answers: ["Check: not proportional, $4$ against $4.4$."],
  },
  {
    id: "write-it-as-an-equation",
    act: "learn",
    title: "Writing It as an Equation",
    phase: "formalise",
    minutes: 4,
    core: true,
    purpose: "Turning the constant into $y = kx$, with the letters defined. This is exploration Q5.",
    body: [
      "Every proportional relationship has the same shape: $y = kx$.",
      "$k$ is the constant of proportionality, which is the unit rate.",
      "Say what your letters MEAN, in words, beside the equation.",
      "An equation with undefined letters is not an answer to describe the relationship.",
    ],
    examples: [
      {
        title: "Example",
        steps: [
          "Items cost $3.50$ dollars each.",
          "Let $x$ be the number of items and $y$ the total cost in dollars.",
          "$y = 3.5x$",
          "Test it: $x = 5$ gives $y = 17.50$, which matches.",
        ],
        answer: "$y = 3.5x$, where $x$ is items and $y$ is cost in dollars.",
      },
    ],
    table: null,
    plot: null,
    check: {
      question: "Rope is $2.40$ dollars per metre. Write the equation.",
      answer: "$y = 2.4x$, where $x$ is metres of rope and $y$ is cost in dollars.",
    },
    questionRef: null,
    source: null,
    hints: [],
    teacherNote:
      "Two things earn the marks: the right $k$, and the sentence defining the letters. Students who skip the sentence lose half of it.",
    answers: ["Check: $y = 2.4x$, with the letters defined."],
  },
  {
    id: "through-the-origin",
    act: "learn",
    title: "What Happens at Zero",
    phase: "formalise",
    minutes: 4,
    core: true,
    purpose: "Exploration Q6. Also sets up the CYU Q3 trap, so it must say NOT SUFFICIENT out loud.",
    body: [
      "Put $x = 0$ into $y = kx$ and you always get $y = 0$.",
      "In a story that usually makes sense: buy none, pay nothing.",
      "So the graph of a proportional relationship goes through the point $(0, 0)$.",
      "But be careful. Passing through $(0, 0)$ is NOT enough on its own.",
      "A relationship can start at zero and still change its rate later.",
      "You must check the ratio at EVERY pair, not just at the start.",
    ],
    examples: [],
    table: null,
    plot: null,
    check: {
      question: "A table starts at $(0, 0)$. Is it definitely proportional?",
      answer: "No. You still have to check that $y$ divided by $x$ gives the same number for every other row.",
    },
    questionRef: null,
    source: null,
    hints: [],
    teacherNote:
      "This is the hinge of the lesson. CYU Q3 is a table that starts at zero and is NOT proportional, and a student who stops at the origin will get it wrong.",
    answers: ["Check: no, the origin is necessary but not enough."],
  },
  {
    id: "testing-a-table",
    act: "learn",
    title: "Testing a Table",
    phase: "formalise",
    minutes: 4,
    core: true,
    purpose: "The routine for CYU Q3. Divide every row, compare, then answer with the numbers.",
    body: [
      "To test a table, work out $\\dfrac{y}{x}$ for EVERY row.",
      "Skip the row where $x = 0$; you cannot divide by zero.",
      "Write the answers in a line so you can compare them at a glance.",
      "All the same means proportional. Any one different means not.",
      "Then answer in a sentence that QUOTES the numbers you found.",
    ],
    examples: [
      {
        title: "Example",
        steps: [
          "Table: $x$ of $0, 2, 4, 6$ against $y$ of $0, 9, 18, 30$.",
          "$\\dfrac{9}{2} = 4.5$",
          "$\\dfrac{18}{4} = 4.5$",
          "$\\dfrac{30}{6} = 5$",
          "The last one is different.",
        ],
        answer: "Not proportional: the rate is $4.5$, $4.5$, then $5$.",
      },
    ],
    table: null,
    plot: null,
    check: {
      question: "Test $x$ of $2, 5, 10$ against $y$ of $5, 12.5, 25$.",
      answer: "$\\dfrac{5}{2} = 2.5$, $\\dfrac{12.5}{5} = 2.5$, $\\dfrac{25}{10} = 2.5$. All the same, so proportional with $k = 2.5$.",
    },
    questionRef: null,
    source: null,
    hints: [],
    teacherNote: "Insist the answer quotes the rates. A bare yes or no is not an explanation and earns nothing.",
    answers: ["Check: proportional, $k = 2.5$."],
  },
  {
    id: "not-every-straight-line",
    act: "learn",
    title: "Not Every Steady Rate Is Proportional",
    phase: "formalise",
    minutes: 4,
    core: false,
    purpose: "The other failure mode: a fixed charge on top. Prepares unit 2 and guards against over-applying $y = kx$.",
    body: [
      "Some relationships go up by the same amount each step but still are not proportional.",
      "That happens when there is a FIXED charge before you buy anything.",
      "A plumber charging a call-out fee plus an hourly rate is the usual example.",
      "At zero hours you still owe the fee, so the relationship does not pass through $(0, 0)$.",
      "Doubling the hours does NOT double the bill, because the fee does not double.",
    ],
    examples: [
      {
        title: "Example",
        steps: [
          "A plumber charges $40$ dollars to turn up, plus $30$ dollars an hour.",
          "$1$ hour: $40 + 30 = 70$ dollars.",
          "$2$ hours: $40 + 60 = 100$ dollars.",
          "Doubling the hours did not double the bill: $100$ is not $140$.",
          "Rates: $\\dfrac{70}{1} = 70$ but $\\dfrac{100}{2} = 50$.",
        ],
        answer: "Not proportional, because of the fixed $40$ dollar fee.",
      },
    ],
    table: null,
    plot: null,
    check: {
      question: "A gym charges a joining fee plus a monthly rate. Is the total proportional to the months?",
      answer: "No. At zero months you have still paid the joining fee, so it does not start at $(0, 0)$.",
    },
    questionRef: null,
    source: null,
    hints: [],
    teacherNote:
      "Two distinct failure modes are now on the table: a fixed charge (fails at the origin) and a changing rate (fails the ratio test). CYU Q3 is the second kind, which is the harder one to spot.",
    answers: ["Check: no, the joining fee breaks it."],
  },
  {
    id: "comparing-two-rates",
    act: "learn",
    title: "Comparing Two Deals",
    phase: "formalise",
    minutes: 4,
    core: true,
    purpose: "Exploration Q7. The comparison only works once both are per ONE of the same thing.",
    body: [
      "To compare two deals, work out the unit rate for EACH.",
      "You cannot compare two totals for different amounts. Get both down to per one.",
      "Then say which is cheaper, and by how much.",
      "Watch the direction: for a price, the SMALLER number per unit is the better deal.",
    ],
    examples: [
      {
        title: "Example",
        steps: [
          "Shop A: $6$ for $15$ dollars. Shop B: $10$ for $23$ dollars.",
          "Shop A: $\\dfrac{15}{6} = 2.50$ dollars each.",
          "Shop B: $\\dfrac{23}{10} = 2.30$ dollars each.",
          "$2.30$ is less than $2.50$.",
        ],
        answer: "Shop B is cheaper, by $20$ cents an item.",
      },
    ],
    table: null,
    plot: null,
    check: {
      question: "Shop A: $4$ for $9$ dollars. Shop B: $7$ for $14$ dollars. Which is cheaper?",
      answer: "$\\dfrac{9}{4} = 2.25$ and $\\dfrac{14}{7} = 2$. Shop B is cheaper at $2$ dollars each.",
    },
    questionRef: null,
    source: null,
    hints: [],
    teacherNote:
      "A bigger total is not a worse deal. Students who compare $15$ with $23$ directly reach the wrong answer and feel sure about it.",
    answers: ["Check: Shop B, at $2$ dollars each."],
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
    "24 gallons for the RV",
    ["Malik's order is the only information you have. Use it."],
    [
      {
        part: "",
        hint: "There are two ways in. Either notice how $24$ compares with Malik's $12$, or work out what ONE gallon costs first.",
        backTo: "finding-the-unit-rate",
      },
    ],
    ["One gallon is $\\dfrac{40.68}{12} = 3.39$ dollars, so $24$ gallons cost \\$81.36.", "Doubling works too: $2 \\cdot 40.68 = 81.36$."],
    "Both routes are worth putting on the board. Doubling is quicker here; the unit rate is what survives to Q3 and Q4.",
  ),
  hintSlide(
    "hint-exp-q2",
    "exploration",
    "Exploration Q2",
    "Just 4 gallons",
    ["How does $4$ compare with the $12$ gallons Malik bought?"],
    [
      {
        part: "",
        hint: "You can divide Malik's order into three equal parts, or multiply the cost of one gallon by $4$. Both should agree.",
        backTo: "scaling-two-quantities",
      },
    ],
    ["$\\dfrac{40.68}{3} = 13.56$, so \\$13.56.", "Or $4 \\cdot 3.39 = 13.56$."],
  ),
  hintSlide(
    "hint-exp-q3",
    "exploration",
    "Exploration Q3",
    "Zuri's pump",
    ["Read the number of gallons off the pump display first."],
    [
      {
        part: "",
        hint: "The gallons are not a whole number, so scaling by doubling will not reach it. Multiply by the cost of one gallon.",
        backTo: "using-the-unit-rate",
      },
    ],
    ["The pump reads $17.465$ gallons.", "$17.465 \\cdot 3.39 = 59.20635$, so \\$59.21 to the nearest cent."],
    "This is the question that forces the unit rate. Expect students who only doubled and halved on Q1 and Q2 to stall here, which is the intended moment.",
  ),
  hintSlide(
    "hint-exp-q4",
    "exploration",
    "Exploration Q4",
    "Jack paid 30.59 dollars",
    ["This one runs the other way: you are given the money and want the gallons."],
    [
      {
        part: "",
        hint: "You know what ONE gallon costs. Should you multiply by it or divide by it? Check your answer by multiplying back.",
        backTo: "working-backwards-from-a-total",
      },
    ],
    [
      "$\\dfrac{30.59}{3.39} \\approx 9.0236$, so about $9.02$ gallons.",
      "Check: $3.39 \\cdot 9.02 = 30.5778$, which rounds to the \\$30.58 on the till.",
    ],
    "The answer is deliberately not tidy. Gallons are a measurement, so a decimal is the right kind of answer; do not let students round to $9$.",
  ),
  hintSlide(
    "hint-exp-q5",
    "exploration",
    "Exploration Q5",
    "Describe the relationship",
    ["You have worked out several pairs of gallons and costs by now."],
    [
      {
        part: "",
        hint: "Ask what you did to the gallons EVERY time to get the cost. Then write it as an equation and say what $x$ and $y$ stand for.",
        backTo: "write-it-as-an-equation",
      },
    ],
    ["$y = 3.39x$, where $x$ is gallons bought and $y$ is the cost in dollars.", "In words: multiply the gallons by \\$3.39."],
    "Insist on the sentence defining the letters. Describe the relationship is not answered by a bare formula.",
  ),
  hintSlide(
    "hint-exp-q6",
    "exploration",
    "Exploration Q6",
    "What happens when x is 0?",
    ["Put $x = 0$ into the relationship you just wrote."],
    [
      {
        part: "",
        hint: "Work out the number first, then ask what it means in the story: what would you pay if you pumped no gas at all?",
        backTo: "through-the-origin",
      },
    ],
    ["$y = 3.39 \\cdot 0 = 0$.", "Yes, it makes sense: buy no gas and you pay nothing, so the graph starts at $(0, 0)$."],
    "Do not let this pass as a triviality. It is the fact that Check Your Understanding Q3 will punish them for over-trusting.",
  ),
  hintSlide(
    "hint-exp-q7",
    "exploration",
    "Exploration Q7",
    "Which gas station is cheaper?",
    ["Penny bought a different number of gallons, so the totals cannot be compared directly."],
    [
      {
        part: "",
        hint: "Work out what ONE gallon costs at Penny's station, then compare that with Malik's. Smaller per gallon is the better deal.",
        backTo: "comparing-two-rates",
      },
    ],
    [
      "Penny: $\\dfrac{51.15}{15} = 3.41$ dollars a gallon.",
      "Malik's station is \\$3.39 a gallon, so MALIK'S station is cheaper, by $2$ cents a gallon.",
    ],
    "Penny paid more in total AND more per gallon, so the wrong method happens to point the same way here. Ask why comparing \\$51.15 with \\$40.68 proves nothing.",
  ),
  hintSlide(
    "hint-cyu-q1",
    "check-your-understanding",
    "Check Your Understanding Q1",
    "Crosby's dinner rolls",
    ["$1000$ grams of flour makes $24$ rolls."],
    [
      { part: "(a)", hint: "How does $72$ compare with $24$? You can scale without finding the unit rate first.", backTo: "scaling-two-quantities" },
      { part: "(b)", hint: "How does $6$ compare with $24$? This time you are scaling DOWN.", backTo: "scaling-two-quantities" },
      { part: "(c)", hint: "One roll means dividing. Keep the exact value rather than a rounded one; you need it in (d) and (e).", backTo: "finding-the-unit-rate" },
      { part: "(d)", hint: "Use your answer to (c) as the multiplier, and say which letter means what.", backTo: "write-it-as-an-equation" },
      { part: "(e)", hint: "You have the total and want the number of rolls, so divide. Then ask what kind of thing a roll is before you round.", backTo: "sensible-answers" },
    ],
    [
      "(a) $72 = 3 \\cdot 24$, so $3 \\cdot 1000 = 3000$ g.",
      "(b) $6 = \\tfrac{24}{4}$, so $\\dfrac{1000}{4} = 250$ g.",
      "(c) $\\dfrac{1000}{24} = \\dfrac{125}{3} \\approx 41.67$ g per roll.",
      "(d) $f = \\dfrac{125}{3} r$, or about $f = 41.67r$, with $f$ grams of flour and $r$ rolls.",
      "(e) $\\dfrac{2380}{125/3} = 2380 \\cdot \\dfrac{3}{125} = 57.12$, and rolls are whole, so $57$ rolls.",
    ],
    "Part (e) is where a rounded (c) bites: using $41.7$ gives $57.07$ and using $42$ gives $56.7$, so a student who rounded early may answer $56$. Keep the fraction.",
  ),
  hintSlide(
    "hint-cyu-q2",
    "check-your-understanding",
    "Check Your Understanding Q2",
    "A stack of soup cans",
    ["$3$ cans stand $12.75$ inches tall."],
    [
      {
        part: "",
        hint: "Find the height of ONE can first, then multiply. Scaling from $3$ to $5$ directly is awkward because $5$ is not a multiple of $3$.",
        backTo: "using-the-unit-rate",
      },
    ],
    ["$\\dfrac{12.75}{3} = 4.25$ inches per can.", "$5 \\cdot 4.25 = 21.25$ inches."],
    "Worth a sentence: real cans nest slightly, so a real stack would be shorter. The question asks us to assume the height is proportional, which is an assumption worth naming.",
  ),
  hintSlide(
    "hint-cyu-q3",
    "check-your-understanding",
    "Check Your Understanding Q3",
    "The t-shirt printing table",
    ["The table starts at $0$ shirts for $0$ dollars, which is tempting."],
    [
      {
        part: "",
        hint: "Starting at zero is not enough on its own. Work out the cost per shirt for EVERY column and compare them.",
        backTo: "testing-a-table",
      },
    ],
    [
      "Cost per shirt: $\\dfrac{120}{10} = 12$, $\\dfrac{240}{20} = 12$, $\\dfrac{330}{30} = 11$, $\\dfrac{400}{40} = 10$.",
      "NOT proportional. The rate starts at $12$ dollars a shirt and falls to $10$, so the ratio is not constant.",
      "It does pass through $(0, 0)$, which is exactly why the origin alone proves nothing.",
    ],
    "This is the assessment item for the whole lesson. A student who answers yes because it starts at the origin has learned the wrong half; expect several and plan to surface it.",
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
      "Find a unit rate by dividing, and say it with the word per.",
      "Use the unit rate forwards to find a total, and backwards to find an amount.",
      "Decide whether a table is proportional by checking the ratio at every row.",
      "Write a proportional relationship as $y = kx$ with the letters defined.",
      "Compare two deals by getting both down to a price per one.",
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
    id: "review-the-relationship",
    act: "review",
    title: "The Relationship You Found",
    phase: "formalise",
    minutes: 4,
    core: true,
    purpose: "Consolidates the exploration's result in all four representations.",
    body: [
      "In words: multiply the number of gallons by \\$3.39.",
      "As an equation: $y = 3.39x$, where $x$ is gallons and $y$ is cost in dollars.",
      "As a graph: a straight line through $(0, 0)$, climbing $3.39$ for every $1$ across.",
      "As a table: see below. The cost per gallon is the same in every column.",
    ],
    examples: [],
    table: {
      caption: "Malik's gas station. Every column gives the same cost per gallon.",
      headers: ["Gallons", "Cost in dollars", "Cost per gallon"],
      rows: [
        ["$4$", "$13.56$", "$3.39$"],
        ["$12$", "$40.68$", "$3.39$"],
        ["$17.465$", "$59.21$", "$3.39$"],
        ["$24$", "$81.36$", "$3.39$"],
      ],
    },
    plot: {
      caption:
        "Cost against gallons. The points sit on one straight line through the origin, which is what makes the relationship proportional.",
      xLabel: "Gallons",
      yLabel: "Cost in dollars",
      xMax: 24,
      yMax: 90,
      yStep: 30,
      xStep: 4,
      series: [
        {
          label: "Cost at 3.39 a gallon",
          kind: "linear",
          points: [
            [0, 0],
            [4, 13.56],
            [12, 40.68],
            [24, 81.36],
          ],
        },
      ],
    },
    check: null,
    questionRef: null,
    source: null,
    hints: [],
    teacherNote:
      "The third row is rounded for the table; the exact product is $59.20635$. Point at the right-hand column: a constant there is the definition, and it is the column the t-shirt table fails.",
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
      "1. Thinking $(0, 0)$ settles it. Necessary, but you still have to check every ratio.",
      "2. Multiplying when you should divide. Given the total, divide by the rate, then multiply back to check.",
      "3. Comparing two totals for different amounts. Get both to a price per ONE first.",
      "4. Rounding a count up. You cannot bake part of a roll, so round DOWN.",
    ],
    examples: [],
    table: null,
    plot: null,
    check: {
      question: "A table starts at $(0, 0)$ and its rates are $12$, $12$, $11$. Proportional?",
      answer: "No. The origin is fine, but $11$ is not $12$, so the ratio is not constant.",
    },
    questionRef: null,
    source: null,
    hints: [],
    teacherNote: "Trap 1 is the one this lesson exists to break. It is also the one students are most confident about.",
    answers: ["Check: no, the rate changes."],
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
      "A printer charges $18$ dollars for $3$ posters and $48$ dollars for $8$ posters.",
      "Work out the cost of ONE poster.",
      "Say whether the relationship is proportional, and prove it with numbers.",
      "Then write the equation, saying what your letters mean.",
    ],
    examples: [],
    table: {
      caption: "How it is marked, out of $3$.",
      headers: ["Mark", "For"],
      rows: [
        ["$1$", "the unit rate is correct, with the word per"],
        ["$1$", "BOTH ratios are written out and compared, not just asserted"],
        ["$1$", "the equation matches, and the letters are defined"],
      ],
    },
    plot: null,
    check: null,
    questionRef: null,
    source: null,
    hints: [],
    teacherNote:
      "Answers: $\\dfrac{18}{3} = 6$ and $\\dfrac{48}{8} = 6$, so $6$ dollars per poster; proportional because both ratios are $6$; $y = 6x$ with $x$ posters and $y$ cost in dollars.",
    answers: ["$6$ dollars per poster.", "Proportional: both ratios are $6$.", "$y = 6x$, with $x$ posters and $y$ cost in dollars."],
  },
  {
    id: "review-challenge",
    act: "review",
    title: "If You Finished Early",
    phase: "formalise",
    minutes: 6,
    core: false,
    purpose: "Two extensions that push on the lesson's own edges.",
    body: [
      "1. The t-shirt printer charges less per shirt as you order more.",
      "Work out what it would cost for $50$ shirts if the pattern continued, and say why you cannot be sure.",
      "2. Find the fixed fee. Suppose a printer charges a set-up fee plus a price per shirt.",
      "If $10$ shirts cost $130$ dollars and $30$ shirts cost $330$ dollars, find both the fee and the price per shirt.",
    ],
    examples: [],
    table: null,
    plot: null,
    check: null,
    questionRef: null,
    source: null,
    hints: [],
    teacherNote:
      "Task 2 answers: $20$ extra shirts cost $200$ dollars, so $10$ dollars a shirt; then $10$ shirts of printing is $100$ dollars, so the fee is $30$ dollars, giving $y = 10x + 30$. That is the shape unit 2 moves to next, and it is NOT proportional.",
    answers: [
      "Task 2: $10$ dollars a shirt, a $30$ dollar set-up fee, so $y = 10x + 30$.",
      "Task 1: the pattern is not a rule, so extending it is a guess, not a calculation.",
    ],
  },
];

export const lesson21: Lesson = {
  slug: "2-1-proportional-reasoning",
  code: "2.1",
  title: "Proportional Reasoning",
  courseLabel: "Algebra 1",
  bigIdea:
    "Two quantities are proportional when the amount per one never changes, so a single number, the unit rate, answers every question you can ask about them.",
  pacing:
    "The Learn act is the lesson. Slides 1 to 5 are the primer, safe before the exploration, and run about 17 minutes; they teach unit rates and scaling without naming what proportional means. Take slides 6 to 9 in the debrief, since those are exploration Q5 and Q6 formalised, and slides 10 and 11 before the Check Your Understanding page. The Hint act is not taught. The Review act is the last fifteen minutes, and the exit ticket is on it.",
  materials: ["the How Much Does It Cost to Get Gas? exploration and its Check Your Understanding page"],
  prerequisites: [
    "Dividing a decimal by a whole number",
    "Multiplying a decimal by a decimal",
    "Rounding money to the nearest cent",
    "Reading a number off a digital display, including three decimal places",
    "Writing a ratio as a fraction and simplifying it",
    "Substituting a number into an expression such as $3.39x$",
    "Multiple representations from Lesson 1.7: table, graph, words, equation",
  ],
  warmUp: [
    { question: "1. Work out $\\dfrac{40.68}{12}$.", answer: "Answer: $3.39$." },
    { question: "2. Work out $4 \\cdot 3.39$.", answer: "Answer: $13.56$." },
    { question: "3. Work out $\\dfrac{100}{12}$ and round to two decimal places.", answer: "Answer: $8.33$." },
    { question: "4. How many whole boxes of $12$ can you fill from $100$ items?", answer: "Answer: $8$, because the ninth box would not be full." },
    { question: "5. Which is cheaper: $3$ for $12$ dollars, or $5$ for $19$ dollars?", answer: "Answer: $5$ for $19$, at $3.80$ each against $4$ each." },
  ],
  learningTargets: [
    "I can find a unit rate by dividing, and say it with the word per.",
    "I can use a unit rate forwards to find a total for any amount.",
    "I can use a unit rate backwards to find an amount from a total.",
    "I can decide whether a relationship is proportional by checking the ratio at every pair.",
    "I can write a proportional relationship as $y = kx$ and say what my letters mean.",
    "I can explain what happens at $x = 0$, and why starting there is not enough on its own.",
    "I can compare two deals by getting both down to a price per one.",
    "I can decide whether an answer should be a decimal or a whole number, and round accordingly.",
  ],
  vocabulary: [
    {
      term: "Rate",
      definition: "A comparison of two quantities measured in different units.",
      example: "$40.68$ dollars for $12$ gallons.",
    },
    {
      term: "Unit rate",
      definition: "How much you get, or pay, for exactly ONE. Found by dividing.",
      example: "$\\dfrac{40.68}{12} = 3.39$ dollars per gallon.",
    },
    {
      term: "Proportional",
      definition: "Two quantities are proportional when the ratio between them is the same for every pair.",
      example: "$4$ gallons for $13.56$ and $12$ gallons for $40.68$ both give $3.39$ per gallon.",
    },
    {
      term: "Constant of proportionality",
      definition: "The number the ratio always comes to, written $k$. It is the unit rate.",
      example: "In $y = 3.39x$ the constant is $k = 3.39$.",
    },
    {
      term: "Origin",
      definition: "The point $(0, 0)$ on a graph. Every proportional relationship passes through it.",
      example: "Buy $0$ gallons and you pay $0$ dollars.",
    },
    {
      term: "Fixed charge",
      definition: "An amount you pay before you buy anything, such as a call-out fee. It stops a relationship being proportional.",
      example: "A plumber charging $40$ dollars to turn up, plus an hourly rate.",
    },
  ],
  slides: [...LEARN, ...HINTS, ...REVIEW],
  misconceptions: [
    {
      misconception: "Believing that starting at $(0, 0)$ makes a relationship proportional.",
      whyItHappens: "The origin is the memorable, visual part of the definition, and it is genuinely required.",
      howToFixIt:
        "It is necessary and NOT sufficient. The t-shirt table in CYU Q3 starts at $(0, 0)$ and its rate falls from $12$ to $10$.",
    },
    {
      misconception: "Multiplying by the unit rate when the total was the thing given.",
      whyItHappens: "Multiplication is the move that has worked all lesson, so it gets applied again without reading the question.",
      howToFixIt: "Ask which quantity you are missing. Given money and wanting gallons, divide. Then multiply back to check.",
    },
    {
      misconception: "Comparing two totals when the amounts bought are different.",
      whyItHappens: "One total is plainly bigger, which feels like an answer.",
      howToFixIt: "Penny's \\$51.15 against Malik's \\$40.68 proves nothing. Get both to a price per gallon first.",
    },
    {
      misconception: "Rounding a count of whole things upward.",
      whyItHappens: "Every previous rounding lesson said to round $57.12$ to the nearest whole number.",
      howToFixIt: "Asking how many FIT is not rounding. The last roll cannot be finished, so the answer is $57$.",
    },
    {
      misconception: "Rounding the unit rate early and carrying the rounded value.",
      whyItHappens: "$41.67$ looks like a finished answer, so it gets written down and reused.",
      howToFixIt: "Keep $\\dfrac{125}{3}$ exact. In CYU Q1(e) an early round can move the answer by a whole roll.",
    },
    {
      misconception: "Dividing the wrong way round when finding a unit rate.",
      whyItHappens: "Both numbers are there and neither is obviously the divisor.",
      howToFixIt: "Say the units out loud: dollars PER gallon means dollars divided by gallons.",
    },
    {
      misconception: "Thinking any relationship that goes up steadily is proportional.",
      whyItHappens: "A steady increase looks like the graphs from a proportional example.",
      howToFixIt: "A fixed charge makes a steady increase that is not proportional, because it does not start at $(0, 0)$.",
    },
    {
      misconception: "Answering is it proportional with a bare yes or no.",
      whyItHappens: "The question feels like it wants a verdict.",
      howToFixIt: "Explain means quote the ratios you worked out. A verdict with no numbers earns nothing.",
    },
  ],
  exitTicket: {
    task: "A printer charges $18$ dollars for $3$ posters and $48$ dollars for $8$ posters. Find the cost of one poster, say whether the relationship is proportional and prove it with numbers, then write the equation with your letters defined.",
    rubric: [
      "The unit rate is correct, and said with the word per.",
      "BOTH ratios are written out and compared, not just asserted.",
      "The equation matches the rate, and the letters are defined.",
    ],
  },
  challenge: [
    {
      task: "The t-shirt printer charges less per shirt as the order grows. Work out what $50$ shirts might cost if the pattern continued, and explain why you cannot be certain.",
      answer:
        "The rate falls $12, 12, 11, 10$, so a guess might be $9$ dollars a shirt and $450$ dollars. It is only a guess: a pattern in four rows is not a rule, and the discount could stop.",
    },
    {
      task: "A printer charges a set-up fee plus a price per shirt. If $10$ shirts cost $130$ dollars and $30$ shirts cost $330$ dollars, find both the fee and the price per shirt.",
      answer:
        "The extra $20$ shirts cost $200$ dollars, so $10$ dollars a shirt. Then $10$ shirts of printing is $100$ dollars, so the fee is $30$ dollars, giving $y = 10x + 30$, which is NOT proportional.",
    },
  ],
  openQuestions: [
    {
      item: "Exploration Q4 does not come out tidy",
      whyUnresolved:
        "At \\$3.39 a gallon, \\$30.59 buys about $9.0236$ gallons, and multiplying $9.02$ back gives \\$30.58 rather than \\$30.59.",
      whatWasDone:
        "The answer is given as about $9.02$ gallons with the check shown, since gallons are a measurement and a decimal is the right kind of answer. Worth saying so before students assume they have gone wrong.",
    },
    {
      item: "Zuri's pump reading came from the image, not the text",
      whyUnresolved: "Q3's figure is a photograph of a pump display, so the gallons are not in the PDF text layer.",
      whatWasDone:
        "The page was rendered and the display read as $17.465$ gallons. Check it against your printed copy before class, since the whole of Q3 rests on it.",
    },
    {
      item: "CYU Q2 assumes cans stack without nesting",
      whyUnresolved:
        "Real cans sit slightly into one another, so a stack of $5$ would be a little under $21.25$ inches. The question treats the height as proportional.",
      whatWasDone:
        "The hint's teacher note names the assumption. It is a good thirty seconds of discussion about when a proportional model is a reasonable approximation.",
    },
    {
      item: "No separate homework sheet was supplied for 2.1",
      whyUnresolved: "Only the exploration and its Check Your Understanding page were provided.",
      whatWasDone:
        "The Hint act covers the ten questions that exist. If an A1 2.1 homework exists, its questions can be added as further hint slides without touching anything else.",
    },
  ],
};
