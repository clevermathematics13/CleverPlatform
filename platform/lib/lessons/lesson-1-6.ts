import type { Lesson } from "./types";

/** Lesson 1.6 -- Describing Geometric Patterns.
 *
 *  Written against two worksheets: the "How Many Teams?" exploration (March
 *  Madness, 64 teams halving each round) with its Check Your Understanding
 *  page, and the four-page A1 Lesson 1.6 homework.
 *
 *  Two things this lesson is careful about, because a review caught both:
 *
 *  1. GROWING AND SHRINKING ARE SIGN-AWARE. "$0<r<1$ means decreasing" is
 *     false when the terms are negative: $-100, -60, -36$ climbs toward
 *     zero. Every statement about direction here says what the terms' sign
 *     is doing as well as what $r$ is.
 *  2. THE PRIMER DOES NOT SOLVE THE EXPLORATION. No `primer` slide uses a
 *     knockout tournament or halves 64 of anything -- that is exploration
 *     Q1, Q2, Q4 and Q5, and a primer that works it has answered it. The
 *     tournament appears only on `formalise` slides, in the debrief. */
export const lesson16: Lesson = {
  slug: "1-6-describing-geometric-patterns",
  code: "1.6",
  title: "Describing Geometric Patterns",
  courseLabel: "Algebra 1",
  bigIdea:
    "A geometric sequence is built by multiplying by the same number every step, so one number, the common ratio $r$, controls the whole pattern: it gives you the next term, any term, whether the sequence grows or shrinks, what the percent change is, and whether the graph is a line or a curve.",
  pacing:
    "This is a two-day lesson, not a one-period lesson. The core spine is slides 1, 2, 5, 9 and 13 (about 24 minutes) plus the exploration. Teach slides 1, 2 and 5 as the primer before students explore, run the exploration, then take slides 3, 4 and 6 in the debrief. Day two is slides 7 through 12, which is where the percent, table, graph and working-backwards questions on the homework live. Slides 4, 10 and 11 are the ones to cut first if you are short.",
  materials: [
    "the How Many Teams? exploration and its Check Your Understanding page",
    "the A1 Lesson 1.6 homework, questions 1 to 10",
  ],
  prerequisites: [
    "Multiplying and dividing whole numbers, fractions and decimals",
    "Dividing a fraction by a fraction, by multiplying by the reciprocal",
    "Raising a fraction or a decimal to a power, for example $\\left(\\tfrac{1}{2}\\right)^{3}$ and $1.1^{4}$",
    "Using the power key on a calculator, written $x^y$ or $\\wedge$ on most models",
    "Multiplying a negative number by a positive one",
    "Subtracting a negative number, for example $-6-(-1)=-5$",
    "Dividing a negative number by a negative number, for example $\\tfrac{-12}{-3}=4$",
    "Finding a percent of a number, for example $10\\%$ of $3400$",
    "Reading a double inequality such as $0<r<1$",
    "Plotting points on a grid and choosing a scale for an axis",
  ],
  warmUp: [
    {
      question: "1. Work out $\\dfrac{2/3}{1/3}$.",
      answer: "Answer: $2$, because dividing by $\\tfrac{1}{3}$ is the same as multiplying by $3$.",
    },
    {
      question: "2. Work out $\\left(\\tfrac{1}{2}\\right)^{3}$.",
      answer: "Answer: $\\tfrac{1}{8}$, because $\\tfrac{1}{2}\\cdot\\tfrac{1}{2}\\cdot\\tfrac{1}{2}=\\tfrac{1}{8}$.",
    },
    { question: "3. Work out $-6-(-1)$.", answer: "Answer: $-5$, because subtracting $-1$ adds $1$." },
    { question: "4. Work out $\\dfrac{-12}{-3}$.", answer: "Answer: $4$, because a negative divided by a negative is positive." },
    { question: "5. Find $10\\%$ of $3400$.", answer: "Answer: $340$, because $10\\%$ means one tenth." },
  ],
  learningTargets: [
    "I can decide whether a sequence is arithmetic, geometric or neither, and show the numbers that prove it.",
    "I can find the common ratio $r$ by dividing a term by the term before it, and I check every consecutive pair, not just the first.",
    "I can use $r$ to write the next term, and to jump straight to a far-off term with $a_n = a_1 \\cdot r^{\\,n-1}$.",
    "I can say whether a sequence is increasing or decreasing, using both the sign of the terms and the size of $r$.",
    "I can turn percent language into a common ratio, and a common ratio back into a percent change.",
    "I can fill in a table of terms and count the steps correctly, without an off-by-one error.",
    "I can plot a sequence and tell an arithmetic picture from a geometric one.",
    "I can work backwards from two later terms to find $r$, and from $r$ to find the first term.",
  ],
  vocabulary: [
    {
      term: "Term",
      definition: "One number in a sequence. Its position in the list is the term number.",
      example: "In $5, 8, 11, 14$ the third term is $11$.",
    },
    {
      term: "Consecutive",
      definition: "Sitting next to each other in the list, with nothing in between.",
      example: "In $2, 4, 8, 16$ the consecutive pairs are $2$ and $4$, then $4$ and $8$, then $8$ and $16$.",
    },
    {
      term: "Arithmetic sequence",
      definition: "A sequence where you ADD the same number every step. That number is the common difference $d$.",
      example: "$5, 8, 11, 14, 17$ has $d = 3$.",
    },
    {
      term: "Geometric sequence",
      definition:
        "A sequence where you MULTIPLY by the same number every step. That number is the common ratio $r$. The first term and $r$ must both be nonzero, so no term is ever $0$.",
      example: "$2, 4, 8, 16, 32$ has $r = 2$.",
    },
    {
      term: "Common ratio",
      definition:
        "The number you multiply by each step. Find it by dividing any term by the term before it, always LATER divided by EARLIER.",
      example: "In $100, 60, 36$ the common ratio is $r = \\dfrac{60}{100} = \\dfrac{3}{5}$.",
    },
    {
      term: "Reciprocal",
      definition: "The fraction turned upside down. Dividing by a fraction is the same as multiplying by its reciprocal.",
      example: "$\\dfrac{3}{4} \\div \\dfrac{2}{5} = \\dfrac{3}{4} \\cdot \\dfrac{5}{2} = \\dfrac{15}{8}$.",
    },
    {
      term: "Recursive rule",
      definition: "A rule that tells you how to get the NEXT term from the one you already have.",
      example: "$a_{n+1} = a_n \\cdot r$. If $a_n$ is the 5th term, $a_{n+1}$ is the 6th.",
    },
    {
      term: "Explicit rule",
      definition: "A rule that jumps straight to any term without listing the ones before it.",
      example: "Geometric: $a_n = a_1 \\cdot r^{\\,n-1}$. Arithmetic: $a_n = a_1 + (n-1)d$.",
    },
    {
      term: "Increasing and decreasing",
      definition:
        "Increasing means every term is bigger than the one before it. Decreasing means every term is smaller. Compare the terms themselves, not how far they are from zero.",
      example: "$-100, -60, -36$ is INCREASING, because $-60$ is bigger than $-100$.",
    },
    {
      term: "Percent change",
      definition: "How much a quantity grows or falls each step, written as a percent of what it was.",
      example: "Multiplying by $r = 1.1$ each step is a $10\\%$ rise; multiplying by $r = 0.9$ is a $10\\%$ fall.",
    },
  ],
  slides: [
    {
      id: "what-a-sequence-is",
      title: "What a Sequence Is",
      phase: "primer",
      minutes: 4,
      core: true,
      purpose:
        "Gives students the words term, term number and the notation $a_n$, which every later question depends on. Needed before exploration Q1 and before any homework question.",
      body: [
        "A sequence is just a list of numbers in a set order.",
        "Each number is a TERM. Where it sits in the list is its TERM NUMBER.",
        "Think of the lockers along a hallway. The locker number is the position; the person who uses it is the value. Two different things, and you need both.",
        "We write terms like this:",
        "$a_1$ is the first term.",
        "$a_2$ is the second term.",
        "$a_n$ is the $n$th term, whichever one you want.",
        "So if the sequence is $5, 8, 11, 14$, then $a_1 = 5$ and $a_3 = 11$.",
        "The small number is the POSITION. It is not something you multiply by.",
      ],
      examples: [
        {
          title: "Example A - naming terms",
          steps: [
            "Take the sequence $7, 14, 28, 56$.",
            "The first term is $7$, so $a_1 = 7$.",
            "The second term is $14$, so $a_2 = 14$.",
            "The fourth term is $56$, so $a_4 = 56$.",
          ],
          answer: "Answer: $a_1 = 7$, $a_2 = 14$, $a_4 = 56$.",
        },
      ],
      table: null,
      plot: null,
      check: {
        question: "In the sequence $3, 6, 12, 24, 48$, what is $a_4$? And which term number has the value $12$?",
        answer: "$a_4 = 24$. The value $12$ is the third term, so it is $a_3$.",
      },
      teacherNote:
        "The single most common slip all lesson is reading the subscript as a multiplier. Say out loud once that $a_3$ is not $3a$. If students write $a_3 = 3 \\cdot a$, stop and fix it here rather than on slide 9 where it costs them the exponent too.",
      answers: ["Check: $a_4 = 24$, and $12$ is $a_3$."],
    },
    {
      id: "add-or-multiply",
      title: "Add or Multiply?",
      phase: "primer",
      minutes: 5,
      core: true,
      purpose:
        "Separates arithmetic from geometric. This is the whole point of the unit and is what CYU Q1 and homework Q4 ask directly.",
      body: [
        "There are two ordinary ways to build a sequence.",
        "ADD the same number every step. That is an ARITHMETIC sequence, and the number you add is the common difference $d$.",
        "MULTIPLY by the same number every step. That is a GEOMETRIC sequence, and the number you multiply by is the common ratio $r$.",
        "To find $d$, subtract: later term minus earlier term.",
        "To find $r$, divide: later term divided by earlier term.",
        "One more rule for geometric sequences: the first term and $r$ are never $0$. So a geometric sequence never contains $0$ anywhere.",
        "If neither test gives the same answer every time, the sequence is NEITHER. That is a real answer, not a failure.",
      ],
      examples: [
        {
          title: "Example A - an arithmetic sequence",
          steps: [
            "Take $5, 8, 11, 14, 17$.",
            "Subtract each consecutive pair: $8-5 = 3$, then $11-8 = 3$, then $14-11 = 3$, then $17-14 = 3$.",
            "Every difference is the same, so it is arithmetic with $d = 3$.",
            "Now try dividing instead: $\\tfrac{8}{5} = 1.6$ but $\\tfrac{11}{8} = 1.375$.",
            "Those are different, so it is not geometric.",
          ],
          answer: "Answer: arithmetic, $d = 3$.",
        },
        {
          title: "Example B - a geometric sequence",
          steps: [
            "Take $2, 4, 8, 16, 32$.",
            "Divide each consecutive pair: $\\tfrac{4}{2} = 2$, then $\\tfrac{8}{4} = 2$, then $\\tfrac{16}{8} = 2$, then $\\tfrac{32}{16} = 2$.",
            "Every ratio is the same, so it is geometric with $r = 2$.",
            "The differences are $2, 4, 8, 16$, which are not the same, so it is not arithmetic.",
          ],
          answer: "Answer: geometric, $r = 2$.",
        },
      ],
      table: null,
      plot: null,
      check: {
        question: "Is $12, 7, 2, -3$ arithmetic, geometric or neither? Show the numbers that prove it.",
        answer:
          "Arithmetic with $d = -5$: $7-12 = -5$, $2-7 = -5$, $-3-2 = -5$. The ratios $\\tfrac{7}{12}$ and $\\tfrac{2}{7}$ are different, so it is not geometric.",
      },
      teacherNote:
        "This is homework Q2(b) and Q4(a) in advance. Insist on written evidence from the start: a bare label with no subtraction or division on the page earns nothing later, and the habit is easier to build now than to repair.",
      answers: ["Check: arithmetic, $d = -5$."],
    },
    {
      id: "testing-for-a-common-ratio",
      title: "Testing for a Common Ratio",
      phase: "formalise",
      minutes: 6,
      core: false,
      purpose:
        "The actual test for $r$: divide, and check EVERY consecutive pair. This is what CYU Q1 and homework Q4 are marking, and where the two commonest errors live.",
      body: [
        "To test whether a sequence is geometric, divide each term by the one before it.",
        "Always LATER divided by EARLIER. Write $\\dfrac{a_2}{a_1}$, never $\\dfrac{a_1}{a_2}$.",
        "A quick self-check: if the sequence is shrinking, $r$ must come out LESS than $1$. If you got something bigger than $1$, you divided the wrong way round.",
        "Then check EVERY consecutive pair, not just the first one.",
        "Some sequences start out looking geometric and then stop following the pattern. One matching pair proves nothing.",
        "If a sequence contains $0$ anywhere, it cannot be geometric, because no term of a geometric sequence is ever $0$.",
      ],
      examples: [
        {
          title: "Example A - it really is geometric",
          steps: [
            "Take $8, 12, 18, 27$.",
            "First pair: $\\dfrac{12}{8} = \\dfrac{3}{2}$.",
            "Second pair: $\\dfrac{18}{12} = \\dfrac{3}{2}$.",
            "Third pair: $\\dfrac{27}{18} = \\dfrac{3}{2}$.",
            "All three agree.",
          ],
          answer: "Answer: geometric, $r = \\dfrac{3}{2}$.",
        },
        {
          title: "Example B - fractions, and the answer is neither",
          steps: [
            "Take $\\dfrac{1}{2}, \\dfrac{3}{2}, \\dfrac{5}{2}, \\dfrac{15}{2}$.",
            "Test the ratios. First pair: $\\dfrac{3/2}{1/2} = \\dfrac{3}{2}\\cdot\\dfrac{2}{1} = 3$.",
            "Second pair: $\\dfrac{5/2}{3/2} = \\dfrac{5}{2}\\cdot\\dfrac{2}{3} = \\dfrac{5}{3}$.",
            "$3$ and $\\dfrac{5}{3}$ are different, so it is NOT geometric.",
            "Now test the differences: $\\dfrac{3}{2}-\\dfrac{1}{2} = 1$, then $\\dfrac{5}{2}-\\dfrac{3}{2} = 1$, then $\\dfrac{15}{2}-\\dfrac{5}{2} = 5$.",
            "$1, 1, 5$ are not all the same, so it is NOT arithmetic either.",
          ],
          answer: "Answer: neither. Both tests had to be run before that could be said.",
        },
        {
          title: "Example C - the one that fools people",
          steps: [
            "Take $4, 8, 16, 48$.",
            "First pair: $\\dfrac{8}{4} = 2$. Second pair: $\\dfrac{16}{8} = 2$. So far so good.",
            "Third pair: $\\dfrac{48}{16} = 3$.",
            "The pattern broke at the last step.",
          ],
          answer: "Answer: not geometric. Stopping after two pairs would have got this wrong.",
        },
      ],
      table: null,
      plot: null,
      check: {
        question: "Test $15, 10, 5, 0, -5$. Is it arithmetic, geometric or neither?",
        answer:
          "Arithmetic with $d = -5$. It cannot be geometric for two separate reasons: the ratios $\\tfrac{10}{15} = \\tfrac{2}{3}$ and $\\tfrac{5}{10} = \\tfrac{1}{2}$ are different, and the sequence contains $0$, which a geometric sequence never does.",
      },
      teacherNote:
        "This is CYU Q1(a) and Q1(b). Watch for the reversed ratio: a student who writes $\\tfrac{15}{10}$ gets $r$ upside down and then calls a shrinking sequence a growing one. The fraction work in Example B is the prerequisite most likely to fail, so have the reciprocal rule visible.",
      answers: ["Check: arithmetic, $d = -5$; not geometric, and it contains $0$."],
    },
    {
      id: "arithmetic-geometric-or-neither",
      title: "Arithmetic, Geometric, or Neither?",
      phase: "formalise",
      minutes: 5,
      core: false,
      purpose:
        "Packages the two tests into a routine, and makes neither a legitimate answer with a reason. CYU Q1 and homework Q4 and Q5.",
      body: [
        "Here is the routine. Run it on any sequence.",
        "Step 1. Subtract each consecutive pair. All the same? Arithmetic, and $d$ is that number.",
        "Step 2. Divide each consecutive pair, later over earlier. All the same? Geometric, and $r$ is that number.",
        "Step 3. Neither test worked? The answer is NEITHER, and you say which test failed and where.",
        "You can also run the routine backwards, to BUILD a sequence instead of labelling one.",
        "If you are given two terms and asked for a third, pick the third term to make the test you want come out even.",
      ],
      examples: [
        {
          title: "Example A - building a third term three ways",
          steps: [
            "The first two terms are $2$ and $6$. Give a third term for each case.",
            "Arithmetic: the difference is $6-2 = 4$, so add $4$ again. The third term is $10$.",
            "Geometric: the ratio is $\\tfrac{6}{2} = 3$, so multiply by $3$ again. The third term is $18$.",
            "Neither: pick anything that is not $10$ and not $18$. Say $7$.",
            "Prove the neither case: differences $4$ and $1$ are different, ratios $3$ and $\\tfrac{7}{6}$ are different. Both tests fail, which is what neither requires.",
          ],
          answer: "Answer: arithmetic $10$, geometric $18$, neither $7$ (or any other value except $10$ and $18$).",
        },
      ],
      table: null,
      plot: null,
      check: {
        question:
          "The first two terms are $1$ and $5$. Give a third term that makes the sequence arithmetic, one that makes it geometric, and one that makes it neither. Prove each with numbers.",
        answer:
          "Arithmetic: $d = 4$, so the third term is $9$. Geometric: $r = 5$, so the third term is $25$. Neither: anything except $9$ and $25$, for example $12$, where the differences $4$ and $7$ differ and the ratios $5$ and $\\tfrac{12}{5}$ differ.",
      },
      teacherNote:
        "This is homework Q5 exactly. One family of sequences is BOTH: a constant sequence like $7, 7, 7, 7$ has $d = 0$ and $r = 1$ at the same time. A student who notices is right, and should be told so out loud, because the routine's one-label output otherwise looks broken to them. For the neither case, insist that BOTH tests are shown failing; showing only one is the commonest lost mark.",
      answers: [
        "Check: arithmetic $9$, geometric $25$, neither anything else with both tests shown.",
        "Note: $7, 7, 7, 7$ is both arithmetic ($d = 0$) and geometric ($r = 1$).",
      ],
    },
    {
      id: "step-forward-recursive",
      title: "Step Forward: the Recursive Rule",
      phase: "primer",
      minutes: 5,
      core: true,
      purpose:
        "The step-by-step engine of a geometric sequence. Needed before students explore, and behind exploration Q1, Q2 and Q5 and homework Q7(b) and Q9(a). Its examples deliberately avoid tournaments so the exploration is not solved in advance.",
      body: [
        "Once you know $r$, getting the next term is one multiplication.",
        "$a_{n+1}$ means the term right after $a_n$. If $a_n$ is the 5th term, $a_{n+1}$ is the 6th.",
        "The recursive rule is $a_{n+1} = a_n \\cdot r$.",
        "In words: to get the next term, multiply the one you have by $r$.",
        "The important idea is that the same FRACTION or the same MULTIPLE is applied each time, even when the amount added or taken away changes every step.",
      ],
      examples: [
        {
          title: "Example A - a bouncing ball",
          steps: [
            "A ball is dropped from $200$ cm and bounces back to half its previous height each time.",
            "Half means $r = \\dfrac{1}{2}$.",
            "First bounce: $200 \\cdot \\tfrac{1}{2} = 100$ cm.",
            "Second bounce: $100 \\cdot \\tfrac{1}{2} = 50$ cm.",
            "Third bounce: $50 \\cdot \\tfrac{1}{2} = 25$ cm.",
            "Look at how much height was LOST each time: $100$, then $50$, then $25$ cm. Not the same amount.",
            "But the FRACTION lost is the same every bounce: half.",
          ],
          answer: "Answer: $200, 100, 50, 25$, geometric with $r = \\dfrac{1}{2}$.",
        },
        {
          title: "Example B - folding a paper strip",
          steps: [
            "Fold a strip of paper in half, then in half again, and count the layers.",
            "Start: $1$ layer. Each fold doubles it, so $r = 2$.",
            "After one fold: $1 \\cdot 2 = 2$ layers.",
            "After two folds: $2 \\cdot 2 = 4$ layers.",
            "After three folds: $4 \\cdot 2 = 8$ layers.",
          ],
          answer: "Answer: $1, 2, 4, 8$, geometric with $r = 2$.",
        },
      ],
      table: null,
      plot: null,
      check: {
        question: "A sequence starts at $81$ and has $r = \\dfrac{1}{3}$. Write the next three terms.",
        answer: "$81 \\cdot \\tfrac{1}{3} = 27$, then $27 \\cdot \\tfrac{1}{3} = 9$, then $9 \\cdot \\tfrac{1}{3} = 3$. So $27, 9, 3$.",
      },
      teacherNote:
        "Do NOT swap these examples for a knockout tournament. Exploration Q1, Q2, Q4 and Q5 are exactly the question of whether the same NUMBER or the same FRACTION is removed each round, in the tournament context, and a primer that works that context has answered the exploration before students reach it. The bouncing ball makes the same point in a context the worksheet never uses. Save the tournament for the debrief.",
      answers: ["Check: $27, 9, 3$."],
    },
    {
      id: "what-r-tells-you",
      title: "What r Tells You",
      phase: "formalise",
      minutes: 6,
      core: false,
      purpose:
        "Why a geometric sequence grows or shrinks. Homework Q3 (is $r = \\tfrac{3}{5}$ increasing or decreasing), Q2 (describe in words) and Q7(a).",
      body: [
        "The size of $r$ tells you what happens to the SIZE of the terms.",
        "The sign of the TERMS then tells you whether that counts as increasing or decreasing.",
        "You need both. Getting this wrong is the single commonest error on this topic.",
        "Multiplying by $r$ with $0<r<1$ pulls every term TOWARD zero. (Read $0<r<1$ as: $r$ is bigger than $0$ but smaller than $1$, so a proper fraction or a decimal below $1$.)",
        "If the terms are positive, moving toward zero means getting SMALLER, so the sequence decreases.",
        "If the terms are negative, moving toward zero means getting BIGGER, so the sequence INCREASES.",
        "Multiplying by $r>1$ pushes every term AWAY from zero. Positive terms then increase; negative terms decrease.",
        "A negative $r$ flips the sign every step, so the terms alternate above and below zero and the sequence is neither increasing nor decreasing.",
      ],
      table: {
        caption: "What r does to the terms. The right-hand column assumes the terms are POSITIVE.",
        headers: ["Common ratio", "What happens to the size", "If the terms are positive"],
        rows: [
          ["$r>1$", "terms move away from zero", "increasing"],
          ["$r=1$", "terms never change", "constant, like $7, 7, 7, 7$"],
          ["$0<r<1$", "terms move toward zero", "decreasing"],
          ["$r<0$", "the sign flips every step", "alternating, neither"],
        ],
      },
      plot: null,
      examples: [
        {
          title: "Example A - positive terms, r between 0 and 1",
          steps: [
            "First term $100$, $r = \\dfrac{3}{5}$.",
            "$100 \\cdot \\tfrac{3}{5} = 60$, then $60 \\cdot \\tfrac{3}{5} = 36$, then $36 \\cdot \\tfrac{3}{5} = 21.6$.",
            "The terms are positive and each one is smaller than the last.",
          ],
          answer: "Answer: $100, 60, 36, 21.6$, DECREASING.",
        },
        {
          title: "Example B - negative terms, the same r",
          steps: [
            "First term $-100$, $r = \\dfrac{3}{5}$.",
            "$-100 \\cdot \\tfrac{3}{5} = -60$, then $-60 \\cdot \\tfrac{3}{5} = -36$, then $-36 \\cdot \\tfrac{3}{5} = -21.6$.",
            "Ask which is bigger, $-100$ or $-60$. On a number line $-60$ sits to the RIGHT of $-100$, so $-60$ is bigger.",
            "Same $r$ as Example A, opposite answer.",
          ],
          answer: "Answer: $-100, -60, -36, -21.6$, INCREASING.",
        },
        {
          title: "Example C - negative terms, r bigger than 1",
          steps: [
            "Take $-3, -12, -48$.",
            "Ratio: $\\dfrac{-12}{-3} = 4$, and $\\dfrac{-48}{-12} = 4$, so $r = 4$.",
            "The terms get further from zero, and they are negative, so each one is SMALLER than the last.",
          ],
          answer: "Answer: geometric with $r = 4$, DECREASING, even though $r$ is large.",
        },
      ],
      check: {
        question: "A sequence has first term $-80$ and $r = \\dfrac{1}{2}$. Write three more terms and say whether it is increasing or decreasing.",
        answer:
          "$-80 \\cdot \\tfrac{1}{2} = -40$, then $-20$, then $-10$. The terms are negative and climbing toward zero, so the sequence is INCREASING.",
      },
      teacherNote:
        "Example C is homework Q2(a) and Example A is Q3. The check question is deliberately the hard case rather than a fourth positive one: negative terms with a fraction ratio is the combination that no amount of pattern-spotting gets right. If a student answers decreasing, put $-80$ and $-40$ on a number line and ask which is further right.",
      answers: ["Check: $-40, -20, -10$, INCREASING."],
    },
    {
      id: "percent-change-in-words",
      title: "Percent Change Hidden in Words",
      phase: "formalise",
      minutes: 6,
      core: false,
      purpose:
        "Turns percent language into $r$ and back. Homework Q9 (grow by $10\\%$ a month), Q7(c) (percent of change) and CYU Q2 (two-thirds of the previous week).",
      body: [
        "Word problems almost never hand you $r$. They describe it.",
        "GROWS BY $10\\%$ means you keep all of it and add a tenth, so $r = 1 + 0.10 = 1.1$.",
        "FALLS BY $10\\%$ means you keep nine tenths, so $r = 1 - 0.10 = 0.9$.",
        "TWO-THIRDS OF THE PREVIOUS AMOUNT is already the multiplier, so $r = \\dfrac{2}{3}$.",
        "Going the other way, the percent change is $(r - 1)$ written as a percent.",
        "So $r = 1.1$ gives $(1.1 - 1)\\cdot 100\\% = +10\\%$, and $r = 0.9$ gives $(0.9 - 1)\\cdot 100\\% = -10\\%$.",
        "Careful: $r = 0.9$ is NOT a $90\\%$ fall. The $90\\%$ is what is LEFT. The CHANGE is the $10\\%$ that went.",
        "Careful again: growing by $10\\%$ is $r = 1.1$, not $r = 0.1$. Using $0.1$ would throw away nine tenths of what you had.",
      ],
      examples: [
        {
          title: "Example A - percent into r",
          steps: [
            "An account has $3400$ followers and grows by $10\\%$ each month.",
            "Keep all of it, then add a tenth: $r = 1.1$.",
            "Month 1: $3400 \\cdot 1.1 = 3740$.",
            "Check it against the words: $10\\%$ of $3400$ is $340$, and $3400 + 340 = 3740$. Same answer.",
          ],
          answer: "Answer: $r = 1.1$, and month 1 is $3740$ followers.",
        },
        {
          title: "Example B - r back into a percent",
          steps: [
            "A population is modelled with $r = \\dfrac{9}{10} = 0.9$.",
            "Percent change is $(r - 1)$ as a percent: $(0.9 - 1) \\cdot 100\\% = -10\\%$.",
            "The minus sign means a fall.",
            "It is a $10\\%$ fall per step, not a $90\\%$ one.",
          ],
          answer: "Answer: a $10\\%$ decrease each step.",
        },
        {
          title: "Example C - a fraction in the words",
          steps: [
            "Gramma Fletcher bakes $243$ cookies in week 1, then two-thirds of the previous week each time.",
            "Two-thirds of the previous amount is the multiplier itself, so $r = \\dfrac{2}{3}$.",
            "Week 2: $243 \\cdot \\tfrac{2}{3} = 162$.",
            "As a percent change: $\\left(\\tfrac{2}{3} - 1\\right) \\cdot 100\\% = -\\tfrac{1}{3} \\cdot 100\\% \\approx -33.3\\%$.",
          ],
          answer: "Answer: $r = \\dfrac{2}{3}$, week 2 is $162$ cookies, about a $33.3\\%$ fall each week.",
        },
      ],
      table: null,
      plot: null,
      check: {
        question: "A price falls by $25\\%$ each year. What is $r$? If it starts at $80$, what is it after two years?",
        answer: "$r = 1 - 0.25 = 0.75$. After one year $80 \\cdot 0.75 = 60$; after two years $60 \\cdot 0.75 = 45$.",
      },
      teacherNote:
        "Homework Q7(c) asks for the percent change per YEAR, but the table is in DECADES, so the question as printed does not match its own data. The intended answer is $-10\\%$ per decade. If a student presses, the honest per-year figure is $0.9^{1/10} \\approx 0.9895$, about a $1.05\\%$ fall per year, which is beyond this course. Noticing the mismatch deserves full credit. Worth getting the worksheet reprinted as from one decade to the next.",
      answers: [
        "Check: $r = 0.75$; after two years the price is $45$.",
        "Q7(c) intended: $-10\\%$ per decade. Literal per-year reading: about $-1.05\\%$.",
      ],
    },
    {
      id: "building-a-table-of-terms",
      title: "Building a Table of Terms",
      // Not a primer, although the exploration opens with a table. Its Q3
      // ("how many rounds BEFORE the championship") is the off-by-one this
      // slide settles, and settling it in advance removes the one thing the
      // exploration is there to make students argue about. Slide 5 gives
      // them the multiplication they need to fill the table; this slide
      // formalises the counting afterwards, which is also where homework
      // Q7(b) and Q9(a) need it.
      phase: "formalise",
      minutes: 5,
      core: false,
      purpose:
        "How to fill a table of terms without an off-by-one error, and how to handle rounding. Settles exploration Q3 in the debrief, and equips homework Q7(b) and Q9(a).",
      body: [
        "A table of terms is just the recursive rule written across a row.",
        "Fill it left to right, multiplying by $r$ each time.",
        "COUNT THE ARROWS, NOT THE LABELS. The number of multiplications is how many gaps you crossed, not the number in the heading.",
        "Going from Month $0$ to Month $4$ is four multiplications, because there are four gaps between five columns.",
        "Going from Round $1$ to Round $6$ is five multiplications, for the same reason.",
        "When a question says to round, keep the FULL value in your calculator for the next multiplication and round only the number you write down.",
      ],
      examples: [
        {
          title: "Example A - a table with rounding",
          steps: [
            "An account starts at $3400$ followers with $r = 1.1$. Fill Months $0$ to $4$, rounded to whole followers.",
            "Month $0$: $3400$.",
            "Month $1$: $3400 \\cdot 1.1 = 3740$.",
            "Month $2$: $3740 \\cdot 1.1 = 4114$.",
            "Month $3$: $4114 \\cdot 1.1 = 4525.4$, written as $4525$.",
            "Month $4$: keep $4525.4$ in the calculator, so $4525.4 \\cdot 1.1 = 4977.94$, written as $4978$.",
          ],
          answer: "Answer: $3400, 3740, 4114, 4525, 4978$.",
        },
        {
          title: "Example B - counting the steps",
          steps: [
            "A table runs from Round $1$ to Round $6$.",
            "The columns are $1, 2, 3, 4, 5, 6$, which is six columns.",
            "The gaps between them are $1\\to2$, $2\\to3$, $3\\to4$, $4\\to5$, $5\\to6$, which is five gaps.",
            "So reaching Round $6$ from Round $1$ takes five multiplications, not six.",
          ],
          answer: "Answer: five steps, one fewer than the number of columns.",
        },
      ],
      table: {
        caption: "Deer in a forest, first term $1000$ and $r = \\frac{9}{10}$, by decade.",
        headers: ["Decade", "$1$", "$2$", "$3$", "$4$"],
        rows: [["Number of deer", "$1000$", "$900$", "$810$", "$729$"]],
      },
      plot: null,
      check: {
        question:
          "A tournament table ends at Round $6$ with $2$ teams left, and that is the championship game. How many rounds come BEFORE the championship?",
        answer:
          "Five. Rounds $1$ through $5$ come before it, and Round $6$ IS the championship, so it is not counted as being before itself.",
      },
      teacherNote:
        "This is exploration Q3 and homework Q9(a) and Q7(b). Expect an argument about whether the championship counts, and let it run: the maths is settled and the disagreement is about the English, which is worth naming as such. On rounding, tell students to compute exact and round only when writing; a student who rounds at every step and lands on the same figures is also correct here.",
      answers: [
        "Check: five rounds come before the championship.",
        "Deer table: $1000, 900, 810, 729$.",
        "Followers table: $3400, 3740, 4114, 4525, 4978$.",
      ],
    },
    {
      id: "jump-ahead-explicit-rule",
      title: "Jump Ahead: the Explicit Rule",
      phase: "formalise",
      minutes: 7,
      core: true,
      purpose:
        "The nth-term formulas, so a far-off term needs no listing. Homework Q1, Q6(b), Q8, Q9(b) and Q10. Both rules are here because Q6(a) leaves it open which kind of sequence Q6 shows.",
      body: [
        "Listing every term is fine for the 4th. It is useless for the 12th.",
        "For a GEOMETRIC sequence the explicit rule is $a_n = a_1 \\cdot r^{\\,n-1}$.",
        "For an ARITHMETIC sequence the explicit rule is $a_n = a_1 + (n-1)d$.",
        "Both have $n-1$ in them, and for the same reason: from the 1st term to the $n$th term you take $n-1$ steps, not $n$. Count the arrows, not the labels.",
        "If the exponent is the part you keep getting wrong, write it as: value $=$ start $\\cdot\\; r^{\\text{steps}}$.",
        "Underneath that, write: steps $=$ how many multiplications away from the start you are.",
        "On a calculator, use the power key, written $x^y$ or $\\wedge$. Work out the power FIRST, then multiply by the first term.",
      ],
      examples: [
        {
          title: "Example A - geometric, the 4th term",
          steps: [
            "First term $40$, common ratio $r = \\dfrac{1}{2}$. Find the 4th term.",
            "From the 1st to the 4th is $4 - 1 = 3$ steps.",
            "$a_4 = 40 \\cdot \\left(\\tfrac{1}{2}\\right)^{3}$.",
            "$\\left(\\tfrac{1}{2}\\right)^{3} = \\tfrac{1}{8}$.",
            "$40 \\cdot \\tfrac{1}{8} = 5$.",
            "Check by listing: $40, 20, 10, 5$. The 4th term is $5$.",
          ],
          answer: "Answer: $a_4 = 5$.",
        },
        {
          title: "Example B - geometric, a long jump",
          steps: [
            "An account starts at $3400$ followers with $r = 1.1$. How many after $12$ months?",
            "Month $0$ is the start, so month $12$ is $12$ multiplications away.",
            "Value $= 3400 \\cdot 1.1^{12}$.",
            "Work out the power first: $1.1^{12} \\approx 3.1384$.",
            "Then multiply: $3400 \\cdot 3.1384 \\approx 10670.7$.",
            "Rounded to whole followers, that is $10671$.",
          ],
          answer: "Answer: about $10671$ followers.",
        },
        {
          title: "Example C - arithmetic, the same idea",
          steps: [
            "A sequence starts at $2$ with common difference $d = 3$. Find the 7th term.",
            "From the 1st to the 7th is $7 - 1 = 6$ steps.",
            "$a_7 = 2 + 6 \\cdot 3$.",
            "$a_7 = 2 + 18 = 20$.",
            "Check by listing: $2, 5, 8, 11, 14, 17, 20$.",
          ],
          answer: "Answer: $a_7 = 20$.",
        },
      ],
      table: null,
      plot: null,
      check: {
        question: "A geometric sequence has first term $3$ and $r = 2$. Find the 6th term.",
        answer: "$a_6 = 3 \\cdot 2^{5} = 3 \\cdot 32 = 96$. Check by listing: $3, 6, 12, 24, 48, 96$.",
      },
      teacherNote:
        "The exponent is the whole lesson here. A student writing $r^n$ instead of $r^{\\,n-1}$ gets every answer one step too far along, and it is invisible unless they check by listing, so make listing-to-check the habit on short sequences. On the calculator, a student who computes $3400 \\cdot 1.1$ and then raises the result to the 12th power is out by a factor of over a thousand.",
      answers: ["Check: $a_6 = 96$."],
    },
    {
      id: "working-backwards-to-find-r",
      title: "Working Backwards to Find r",
      phase: "formalise",
      minutes: 6,
      core: false,
      purpose:
        "Recovering $r$ when the two known terms are not next to each other. This is homework Q10 (2nd term $6$, 4th term $150$).",
      body: [
        "Sometimes you are given two terms that are not consecutive, and asked for $r$.",
        "Dividing them does NOT give $r$. It gives $r$ multiplied by itself once for each step between them.",
        "Count the steps first. From the 2nd term to the 4th term is $4 - 2 = 2$ steps.",
        "So dividing the later by the earlier gives $r^{2}$, and you undo that with a square root.",
        "A square root has TWO answers, one positive and one negative, and both can be genuine.",
        "Use the context to choose. A count of people, a population or a length cannot be negative, so a story problem usually forces the positive one.",
        "With no context, both are correct and you should write both sequences out.",
      ],
      examples: [
        {
          title: "Example A - two steps apart, both roots",
          steps: [
            "The 2nd term is $6$ and the 4th term is $150$.",
            "Steps between them: $4 - 2 = 2$.",
            "So $6 \\cdot r^{2} = 150$, which gives $r^{2} = \\dfrac{150}{6} = 25$.",
            "Square rooting: $r = 5$ or $r = -5$.",
            "Check $r = 5$: $6, 30, 150$. The 4th term is $150$.",
            "Check $r = -5$: $6, -30, 150$. The 4th term is also $150$.",
            "The question gives no context, so neither can be ruled out.",
          ],
          answer: "Answer: $r = 5$ or $r = -5$, and both sequences work.",
        },
      ],
      table: null,
      plot: null,
      check: {
        question: "The 1st term of a geometric sequence is $2$ and the 3rd term is $18$. Find $r$.",
        answer:
          "Two steps apart, so $2 \\cdot r^{2} = 18$ and $r^{2} = 9$, giving $r = 3$ or $r = -3$. Check: $2, 6, 18$ and $2, -6, 18$ both work.",
      },
      teacherNote:
        "A bare answer of $-5$ on homework Q10 is correct and should be marked so. Students almost always find only the positive root, so ask directly whether a negative value could also square to $25$. This is also a good place to say that the same counting rule is at work as on slide 9: the exponent is the number of GAPS.",
      answers: ["Check: $r = 3$ or $r = -3$.", "Q10: $r = 5$ or $r = -5$."],
    },
    {
      id: "working-backwards-to-the-first-term",
      title: "Working Backwards to the First Term",
      phase: "formalise",
      minutes: 5,
      core: false,
      purpose:
        "Reversing a geometric sequence to recover $a_1$. This is homework Q8 (4th term $9$, 5th term $27$, find the 1st).",
      body: [
        "To step BACKWARDS through a geometric sequence, divide by $r$ instead of multiplying.",
        "If you are not given $r$, find it first from two consecutive terms you do have.",
        "Then divide your way back, one step at a time, counting the gaps as you go.",
        "Always check by walking forwards again from your answer. It should land on the term you started from.",
      ],
      examples: [
        {
          title: "Example A - find r first, then walk back",
          steps: [
            "The 4th term is $9$ and the 5th term is $27$. Find the 1st term.",
            "These two ARE consecutive, so $r = \\dfrac{27}{9} = 3$.",
            "From the 4th back to the 1st is $4 - 1 = 3$ steps backwards, so divide by $3$ three times.",
            "3rd term: $\\dfrac{9}{3} = 3$.",
            "2nd term: $\\dfrac{3}{3} = 1$.",
            "1st term: $\\dfrac{1}{3}$.",
            "Check forwards: $\\tfrac{1}{3}, 1, 3, 9, 27$. The 4th term is $9$ and the 5th is $27$.",
          ],
          answer: "Answer: the 1st term is $\\dfrac{1}{3}$.",
        },
      ],
      table: null,
      plot: null,
      check: {
        question: "The 3rd term of a geometric sequence is $18$ and the 4th term is $54$. Find the 1st term.",
        answer:
          "They are consecutive, so $r = \\tfrac{54}{18} = 3$. Back two steps: 2nd term $\\tfrac{18}{3} = 6$, 1st term $\\tfrac{6}{3} = 2$. Check forwards: $2, 6, 18, 54$.",
      },
      teacherNote:
        "The check question makes students find $r$ themselves before walking back, which is the chaining that Q8 actually demands. Students who are handed $r$ never rehearse the first half. An answer that is a fraction unsettles some students; say plainly that $\\tfrac{1}{3}$ is a perfectly ordinary first term.",
      answers: ["Check: the 1st term is $2$.", "Q8: the 1st term is $\\dfrac{1}{3}$."],
    },
    {
      id: "sequences-on-a-graph",
      title: "Sequences on a Graph",
      phase: "formalise",
      minutes: 6,
      core: false,
      purpose:
        "Plotting a sequence and reading one off a graph, including choosing a scale. Exploration Q6 and Q7, homework Q6(a) and Q6(b).",
      body: [
        "To plot a sequence, put the TERM NUMBER across the bottom and the TERM VALUE up the side.",
        "So the sequence $2, 6, 18$ gives the points $(1, 2)$, $(2, 6)$ and $(3, 18)$.",
        "Plot points only. Do not join them with a line: a sequence exists only at whole term numbers, and there is no term $2.5$.",
        "When $r$ is positive and not equal to $1$, geometric points lie on a CURVE that bends away from or toward the axis.",
        "Arithmetic points lie on a STRAIGHT line, because you add the same amount for each step across.",
        "Two warnings. If $r$ is negative the points jump above and below the axis, so the picture alternates and the shape tells you nothing: use the ratios instead.",
        "And $7, 7, 7, 7$ is a flat straight line but is BOTH arithmetic ($d = 0$) and geometric ($r = 1$), so a straight line alone never settles the question.",
        "Choosing the scale matters. Look at your biggest value first, then pick an interval that fits it on the grid you have.",
      ],
      plot: {
        caption:
          "Two sequences on the same axes. The geometric one, 1, 2, 4, 8, 16, bends upward; the arithmetic one, 2, 5, 8, 11, 14, stays on a straight line. They cross, which is why the shape and not the height is what you read.",
        xLabel: "Term Number",
        yLabel: "Term Value",
        xMax: 5,
        yMax: 16,
        yStep: 4,
        series: [
          {
            label: "Geometric, r = 2",
            kind: "geometric",
            points: [
              [1, 1],
              [2, 2],
              [3, 4],
              [4, 8],
              [5, 16],
            ],
          },
          {
            label: "Arithmetic, d = 3",
            kind: "arithmetic",
            points: [
              [1, 2],
              [2, 5],
              [3, 8],
              [4, 11],
              [5, 14],
            ],
          },
        ],
      },
      examples: [
        {
          title: "Example A - choosing a scale",
          steps: [
            "Plot a tournament that starts with $64$ teams and halves each round, down to $2$.",
            "The points are $(1, 64)$, $(2, 32)$, $(3, 16)$, $(4, 8)$, $(5, 4)$ and $(6, 2)$.",
            "The biggest value is $64$, so the vertical axis must reach at least $64$.",
            "In steps of $1$ that needs $64$ grid lines and runs off the page.",
            "In steps of $10$ the axis stops at $70$, but then $8$, $4$ and $2$ all sit almost on top of each other.",
            "Steps of $8$ give nine grid lines from $0$ to $64$, and every point lands on or near a line.",
          ],
          answer: "Answer: label the vertical axis $0, 8, 16, 24, ..., 64$, in steps of $8$.",
        },
        {
          title: "Example B - reading a sequence off a graph",
          steps: [
            "Suppose a graph shows points at $(1, 2)$, $(2, 6)$, $(3, 18)$ and $(4, 54)$.",
            "Read the values off first: $2, 6, 18, 54$.",
            "Test the differences: $4, 12, 36$. Not the same, so not arithmetic.",
            "Test the ratios: $\\tfrac{6}{2} = 3$, $\\tfrac{18}{6} = 3$, $\\tfrac{54}{18} = 3$. All the same, so geometric with $r = 3$.",
            "Now the 7th term is reachable: $a_7 = 2 \\cdot 3^{6} = 2 \\cdot 729 = 1458$.",
          ],
          answer: "Answer: geometric with $r = 3$, and $a_7 = 1458$.",
        },
      ],
      table: null,
      check: {
        question:
          "A graph shows points at $(1, 3)$, $(2, 7)$, $(3, 11)$ and $(4, 15)$. Is the sequence arithmetic or geometric, and what is the 6th term?",
        answer:
          "Differences $4, 4, 4$ are constant, so it is arithmetic with $d = 4$. Then $a_6 = 3 + 5 \\cdot 4 = 23$.",
      },
      teacherNote:
        "Homework Q6(a) asks students to DECIDE arithmetic or geometric from the printed grid, so Q6(b) branches: if it is geometric use $a_n = a_1 \\cdot r^{\\,n-1}$, and if arithmetic use $a_n = a_1 + (n-1)d$. Read the four plotted coordinates off the printed worksheet and say them aloud before students start, because they are not legible in the digital copy. The check question is deliberately the arithmetic branch, since that is the one slide 9 could leave under-rehearsed.",
      answers: [
        "Check: arithmetic with $d = 4$, and $a_6 = 23$.",
        "Example B: geometric, $r = 3$, $a_7 = 1458$.",
      ],
    },
    {
      id: "saying-it-in-words",
      title: "Saying It in Words",
      phase: "formalise",
      minutes: 5,
      core: true,
      purpose:
        "Sentence frames so written explanations carry evidence. Every Explain and Describe part: exploration Q1, Q4, Q5 and Q7, CYU Q1 and Q2(c), homework Q2, Q3, Q4, Q5, Q7(a) and Q9(c).",
      body: [
        "Most marks on this homework are for the EXPLANATION, not the number.",
        "The word explain earns nothing on its own. A calculation has to be on the page next to it.",
        "Use these frames.",
        "To describe a sequence: It starts at ___ and each term is ___ times the one before it, so it is geometric with $r = $ ___.",
        "To classify: It is ___ because the ___ between consecutive terms is always ___, and I checked every pair.",
        "To say it is neither: It is neither, because the differences are ___ and the ratios are ___, and neither list is all the same.",
        "To say which way it goes: It is ___ because the terms are ___ and $r$ is ___.",
        "That last frame needs BOTH blanks. Saying only what $r$ is will get the negative cases wrong.",
      ],
      examples: [
        {
          title: "Example A - describing a sequence in words",
          steps: [
            "Take $-3, -12, -48$.",
            "Ratios: $\\dfrac{-12}{-3} = 4$ and $\\dfrac{-48}{-12} = 4$, so $r = 4$.",
            "Now fill the frame, both blanks.",
          ],
          answer:
            "Answer: It starts at $-3$ and each term is $4$ times the one before it, so it is geometric with $r = 4$. It is decreasing, because the terms are negative and $r$ is greater than $1$, so each term is further below zero.",
        },
        {
          title: "Example B - the same frame, positive terms",
          steps: [
            "Take $100, 60, 36$ with $r = \\dfrac{3}{5}$.",
            "Fill the frame with both blanks again.",
          ],
          answer:
            "Answer: It is decreasing, because the terms are positive and $r$ is between $0$ and $1$, so each term is closer to zero than the last.",
        },
      ],
      table: null,
      plot: null,
      check: {
        question: "Describe $-2, -8, -32$ in words, using the frames. Say what kind of sequence it is and which way it goes.",
        answer:
          "Ratios $\\tfrac{-8}{-2} = 4$ and $\\tfrac{-32}{-8} = 4$, so it is geometric with $r = 4$. It starts at $-2$ and each term is $4$ times the one before it. It is decreasing, because the terms are negative and $r$ is greater than $1$.",
      },
      teacherNote:
        "Use this as the exit ticket. Hold the line that the word explain earns nothing without a calculation on the page, and show students the three-point rubric before they write, not after. Both blanks in the direction frame are load-bearing: a student who fills only the $r$ blank will get every negative-term question wrong and will not know why.",
      answers: ["Check: geometric with $r = 4$, decreasing, terms negative and $r > 1$."],
    },
  ],
  misconceptions: [
    {
      misconception: "Dividing the wrong way round, so $r$ comes out upside down.",
      whyItHappens:
        "Divide to get $r$ is remembered, but which over which is not. On $100, 60, 36$ that gives $\\tfrac{100}{60} = \\tfrac{5}{3}$, and a shrinking sequence is then called growing.",
      howToFixIt:
        "Always LATER divided by EARLIER: $\\dfrac{a_2}{a_1}$, never $\\dfrac{a_1}{a_2}$. Self-check: if the sequence is shrinking, $r$ must be less than $1$.",
    },
    {
      misconception: "Checking only the first pair of terms.",
      whyItHappens: "The first ratio works, so the label is written down before the rest are tested.",
      howToFixIt:
        "Every consecutive pair, every time. $4, 8, 16, 48$ passes twice and fails on the third, and stopping early gets it wrong.",
    },
    {
      misconception: "Grows by $10\\%$, so $r = 0.1$.",
      whyItHappens: "The percent in the sentence is copied straight in as the multiplier.",
      howToFixIt:
        "Growing means you KEEP what you had and add to it, so $r = 1 + 0.10 = 1.1$. Using $0.1$ would throw away nine tenths.",
    },
    {
      misconception: "$r = 0.9$, so it fell by $90\\%$.",
      whyItHappens: "The $0.9$ is read as the change rather than as what is left.",
      howToFixIt:
        "The $90\\%$ is what SURVIVES. The change is $(0.9 - 1)\\cdot 100\\% = -10\\%$. This is the likeliest wrong answer on homework Q7(c).",
    },
    {
      misconception: "A fraction ratio always means the sequence is decreasing.",
      whyItHappens: "Every classroom example of $0<r<1$ happens to have positive terms.",
      howToFixIt:
        "$-100, -60, -36$ has $r = \\tfrac{3}{5}$ and is INCREASING. Ask what the terms' SIGN is before answering, every time.",
    },
    {
      misconception: "A big $r$ always means the sequence is increasing.",
      whyItHappens: "Size and direction get treated as the same thing.",
      howToFixIt:
        "$-3, -12, -48$ has $r = 4$ and is DECREASING. Compare the terms on a number line, not their distance from zero.",
    },
    {
      misconception: "The same AMOUNT is removed each step, so it must be arithmetic.",
      whyItHappens:
        "In a halving sequence something is clearly being taken away each step, and it looks like subtraction.",
      howToFixIt:
        "Check the amounts. From $200$ they are $100$, then $50$, then $25$: different every time. It is the FRACTION that is constant.",
    },
    {
      misconception: "Using $r^{n}$ instead of $r^{\\,n-1}$ in the explicit rule.",
      whyItHappens: "The term number is copied into the exponent without thinking about where the counting starts.",
      howToFixIt:
        "Count the arrows, not the labels: reaching the $n$th term from the 1st takes $n-1$ multiplications. Check a short case by listing.",
    },
    {
      misconception: "Counting the column headings instead of the gaps between them.",
      whyItHappens: "Month $0$ to Month $12$ looks like $13$ things, and Round $1$ to Round $6$ looks like $6$ steps.",
      howToFixIt:
        "The number of multiplications is the number of GAPS. Five columns have four gaps. This is exploration Q3 and homework Q9(b).",
    },
    {
      misconception: "Geometric means a curve, so a straight line rules it out.",
      whyItHappens: "The shape rule is learned without its conditions.",
      howToFixIt:
        "It holds only for $r>0$ and $r \\ne 1$. $7, 7, 7, 7$ is a flat line and is geometric with $r = 1$; a negative $r$ alternates instead of curving.",
    },
    {
      misconception: "$15, 0, 0, 0$ is geometric with $r = 0$.",
      whyItHappens: "Multiplying by zero does produce the next term, so the rule seems to hold.",
      howToFixIt:
        "The first term and $r$ are both nonzero by definition, so no term of a geometric sequence is ever $0$. This is the clean reason CYU Q1(a) is not geometric.",
    },
  ],
  exitTicket: {
    task: "Take the sequence $-2, -8, -32$. Say whether it is arithmetic, geometric or neither and prove it with numbers; then say whether it is increasing or decreasing and why. Use the sentence frames from the last slide.",
    rubric: [
      "The classification is correct, with $r$ or $d$ named.",
      "At least TWO ratios or TWO differences are written out on the page, not just the label.",
      "The direction sentence names BOTH the sign of the terms and the size of $r$.",
    ],
  },
  challenge: [
    {
      task: "Homework Q10 has two answers, $r = 5$ and $r = -5$. Write out both sequences from the 1st term to the 5th, plot both on the same axes, and describe in words how the two pictures differ.",
      answer:
        "With $r = 5$: $\\tfrac{6}{5}, 6, 30, 150, 750$, all positive, curving steeply upward. With $r = -5$: $\\tfrac{-6}{5}, 6, -30, 150, -750$, alternating above and below the axis with the size growing each step.",
    },
    {
      task: "Homework Q7 drops the deer population by $10\\%$ every DECADE. What single yearly ratio, applied ten times, would give the same $10\\%$ drop? What percent change is that per year?",
      answer:
        "The yearly ratio is $0.9^{1/10} \\approx 0.9895$, which is about a $1.05\\%$ fall per year. Ten of those compound to $0.9$, not ten lots of $1\\%$, which is why it is not simply $-1\\%$.",
    },
  ],
  coverageMap: [
    { source: "exploration", question: "Q1", demand: "Halve $64$ to get round 2, and say that halving is what the rule does", slideId: "step-forward-recursive" },
    { source: "exploration", question: "Q2", demand: "Apply the same halving again to reach round 3", slideId: "step-forward-recursive" },
    { source: "exploration", question: "Q3", demand: "Build the round-by-round table and count rounds without an off-by-one error", slideId: "building-a-table-of-terms" },
    { source: "exploration", question: "Q4", demand: "See that the AMOUNT eliminated changes every round even though the rule does not", slideId: "add-or-multiply" },
    { source: "exploration", question: "Q5", demand: "Describe the change as multiplying by $\\tfrac{1}{2}$, not as subtracting a fixed number", slideId: "saying-it-in-words" },
    { source: "exploration", question: "Q6", demand: "Plot round against teams remaining, choosing an axis scale that fits $64$ down to $2$", slideId: "sequences-on-a-graph" },
    { source: "exploration", question: "Q7", demand: "Name the shape as a curve rather than a straight line, and say why", slideId: "sequences-on-a-graph" },
    { source: "check-your-understanding", question: "Q1(a)", demand: "Classify $15, 10, 5, 0, -5$: arithmetic, and not geometric because it contains $0$", slideId: "testing-for-a-common-ratio" },
    { source: "check-your-understanding", question: "Q1(b)", demand: "Test a strip of fractions by BOTH ratio and difference, dividing fractions correctly", slideId: "testing-for-a-common-ratio" },
    { source: "check-your-understanding", question: "Q1(c)", demand: "Classify $1, 4, 9, 16, 25, 36$ as neither, showing both tests fail", slideId: "arithmetic-geometric-or-neither" },
    { source: "check-your-understanding", question: "Q1(d)", demand: "Classify $4, 6, 9, 13.5$ as geometric with $r = \\tfrac{3}{2}$, including the decimal pair", slideId: "testing-for-a-common-ratio" },
    { source: "check-your-understanding", question: "Q2(a)", demand: "Turn two-thirds of the previous amount into $r = \\tfrac{2}{3}$ and step from $243$ to weeks 2 and 4", slideId: "percent-change-in-words" },
    { source: "check-your-understanding", question: "Q2(b)", demand: "Step forward until the value reaches $32$, and report the week number", slideId: "building-a-table-of-terms" },
    { source: "check-your-understanding", question: "Q2(c)", demand: "Justify that it is geometric, naming the constant ratio as the reason", slideId: "saying-it-in-words" },
    { source: "homework", question: "Q1", demand: "Apply $a_n = a_1 \\cdot r^{\\,n-1}$ with $a_1 = 40$, $r = \\tfrac{1}{2}$, $n = 4$", slideId: "jump-ahead-explicit-rule" },
    { source: "homework", question: "Q2(a)", demand: "Describe $-3, -12, -48$: geometric with $r = 4$, and decreasing because the terms are negative", slideId: "what-r-tells-you" },
    { source: "homework", question: "Q2(b)", demand: "Describe $12, 7, 2, -3$ as arithmetic with $d = -5$", slideId: "add-or-multiply" },
    { source: "homework", question: "Q3", demand: "Decide direction for $a_1 = 100$, $r = \\tfrac{3}{5}$: positive terms with $0<r<1$, so decreasing", slideId: "what-r-tells-you" },
    { source: "homework", question: "Q4(a)", demand: "Classify $5, 8, 11, 14, 17$ as arithmetic and give $d = 3$", slideId: "add-or-multiply" },
    { source: "homework", question: "Q4(b)", demand: "Classify $2, 4, 8, 16, 32$ as geometric and give $r = 2$", slideId: "add-or-multiply" },
    { source: "homework", question: "Q5(a)", demand: "GENERATE a third term after $1$ and $5$ making it arithmetic, and justify it", slideId: "arithmetic-geometric-or-neither" },
    { source: "homework", question: "Q5(b)", demand: "Generate a third term making it geometric, and justify it", slideId: "arithmetic-geometric-or-neither" },
    { source: "homework", question: "Q5(c)", demand: "Generate a third term making it neither, showing BOTH tests fail", slideId: "arithmetic-geometric-or-neither" },
    { source: "homework", question: "Q6(a)", demand: "Read four points off a grid and decide arithmetic or geometric from the values, not the shape alone", slideId: "sequences-on-a-graph" },
    { source: "homework", question: "Q6(b)", demand: "Find the 7th term using whichever explicit rule Q6(a) settled on, geometric or arithmetic", slideId: "jump-ahead-explicit-rule" },
    { source: "homework", question: "Q7(a)", demand: "Decide direction for $a_1 = 1000$, $r = \\tfrac{9}{10}$: positive terms, so declining", slideId: "what-r-tells-you" },
    { source: "homework", question: "Q7(b)", demand: "Fill the decade table $1000, 900, 810, 729$ by repeated multiplication", slideId: "building-a-table-of-terms" },
    { source: "homework", question: "Q7(c)", demand: "Convert $r = \\tfrac{9}{10}$ into a percent change of $-10\\%$ per step", slideId: "percent-change-in-words" },
    { source: "homework", question: "Q8", demand: "Find $r$ from two consecutive terms, then divide back three steps to the 1st term", slideId: "working-backwards-to-the-first-term" },
    { source: "homework", question: "Q9(a)", demand: "Turn $10\\%$ growth into $r = 1.1$ and fill months $0$ to $4$, rounding only what is written", slideId: "building-a-table-of-terms" },
    { source: "homework", question: "Q9(b)", demand: "Jump $12$ months with $3400 \\cdot 1.1^{12}$, computing the power before multiplying", slideId: "jump-ahead-explicit-rule" },
    { source: "homework", question: "Q9(c)", demand: "Justify that constant percent growth is a geometric sequence", slideId: "percent-change-in-words" },
    { source: "homework", question: "Q10", demand: "Two terms two steps apart give $r^{2} = 25$, so $r = 5$ or $r = -5$", slideId: "working-backwards-to-find-r" },
  ],
  openQuestions: [
    {
      item: "Check Your Understanding Q1(b) - the strip of fractions",
      whyUnresolved:
        "The numerators did not survive text extraction from the PDF, so the exact sequence could not be read. Nothing was invented in its place.",
      whatWasDone:
        "Slide 3 Example B teaches the skill the item assesses on a fraction strip whose answer is NEITHER, so students have met that outcome and the fraction division it needs. Read the printed item before class and check the answer matches what Example B trains.",
    },
    {
      item: "Homework Q6 - the four plotted points",
      whyUnresolved:
        "The grid is an image; only the axis labels and their ranges came through, so the plotted coordinates are unknown.",
      whatWasDone:
        "Slide 12 now teaches BOTH explicit rules and the Q6(b) coverage entry branches on the answer to Q6(a). Read the four coordinates off the printed sheet and say them aloud, so a student with a large-print or reprinted copy is not locked out.",
    },
    {
      item: "Homework Q7(c) - decade versus year",
      whyUnresolved:
        "The table is in decades but the question asks for the percent change from one YEAR to the next. The two do not match on the printed sheet.",
      whatWasDone:
        "Slide 7's teacher note carries both the intended answer ($-10\\%$ per decade) and the honest literal one (about $-1.05\\%$ per year). Worth reprinting the question as from one decade to the next.",
    },
  ],
};
