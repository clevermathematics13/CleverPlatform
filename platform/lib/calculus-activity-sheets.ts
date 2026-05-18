// Five interconnected activity sheets for the IBDP AA HL "Foundations of Calculus: A Function-Family Approach to Limits"
// Each designed for ~2 hours, on paper, with high cognitive load and all IB components integrated

import type { AssignmentDraft } from "@/lib/assignments";

// ── Stage metadata ──────────────────────────

export type CalculusActivityMeta = {
  stageNumber: number;
  functionFamily: string;
  theme: string;
  title: string;
  estimatedMinutes: number;
  totalMarks: number;
  bridgeToNext: string;
};

export const ACTIVITY_META: Record<number, CalculusActivityMeta> = {
  1: {
    stageNumber: 1,
    functionFamily: "Polynomial Functions",
    theme: "The Intuitive Foundation",
    title: "Activity 1: The Shrinking Secant",
    estimatedMinutes: 120,
    totalMarks: 28,
    bridgeToNext:
      "Bridge question: Your algebraic limit evaluation relied on cancelling a common factor\u2014what happens when that factor cannot be cancelled? Stage 2 will explore functions where limits reveal hidden structure.",
  },
  2: {
    stageNumber: 2,
    functionFamily: "Rational Functions",
    theme: "The Anatomy of Discontinuity",
    title: "Activity 2: Hole or Wall?",
    estimatedMinutes: 120,
    totalMarks: 30,
    bridgeToNext:
      "Bridge question: You compared polynomial behaviour at infinity to oblique lines. What if a function grows so fast that no polynomial can keep up? Stage 3 introduces exponential growth.",
  },
  3: {
    stageNumber: 3,
    functionFamily: "Exponential & Logarithmic Functions",
    theme: "Transcendental Boundaries",
    title: "Activity 3: The Hierarchy of Infinity",
    estimatedMinutes: 120,
    totalMarks: 29,
    bridgeToNext:
      "Bridge question: Exponential growth dominates polynomials, but can oscillations defeat even the tightest bounds? Stage 4 examines oscillating functions.",
  },
  4: {
    stageNumber: 4,
    functionFamily: "Trigonometric Functions",
    theme: "Oscillation and Squeeze",
    title: "Activity 4: The Squeeze Sandbox",
    estimatedMinutes: 120,
    totalMarks: 30,
    bridgeToNext:
      "Bridge question: Trigonometric functions are periodic and thus not one-to-one on their full domains. How can we invert them? Stage 5 explores domain restriction and inverse functions.",
  },
  5: {
    stageNumber: 5,
    functionFamily: "Inverse & Reciprocal Trigonometric Functions",
    theme: "Restricted Domains",
    title: "Activity 5: Slicing the Wave",
    estimatedMinutes: 120,
    totalMarks: 27,
    bridgeToNext:
      "You have now traversed the entire function-family landscape of calculus foundations. Each stage built on the last\u2014from the algebra of polynomials to the subtlety of transcendental inverses.",
  },
};

// ── Stage 1: Polynomial Functions ───────────

export const STAGE_1_DRAFT: AssignmentDraft = {
  title: "Activity 1: The Shrinking Secant",
  subtitle:
    "IBDP Mathematics AA HL \u2014 Polynomial Functions & The Intuitive Foundation of Limits",
  instructions: [
    "Complete all parts in the spaces provided. Show all working clearly.",
    "Use a calculator for numerical exploration but leave algebraic steps exact.",
    "Read each TOK reflection box and write a short response (2\u20133 sentences).",
    "The final bridge question connects to Activity 2\u2014keep your answer for reference.",
    "Marks are indicated in square brackets. This activity should take approximately 120 minutes.",
  ],
  sections: [
    {
      heading: "Section A: Numerical Exploration \u2014 The Secant That Shrinks [9 marks]",
      questions: [
        {
          prompt:
            "Consider f(x) = (1/2)x\u00b2 + 2. We wish to find the exact gradient of the curve at x = 2. " +
            "(a) Write the slope of the secant line passing through (2, f(2)) and (2 + h, f(2 + h)) as a single algebraic expression in h. Simplify fully. [3 marks]",
          marks: 3,
          answer:
            "m_sec = [f(2+h) \u2212 f(2)] / h = [(1/2)(4+4h+h\u00b2)+2 \u2212 4] / h = [2+2h+h\u00b2/2+2 \u2212 4] / h = (2h + h\u00b2/2) / h = 2 + h/2",
        },
        {
          prompt:
            "Build a table for h = 1, 0.1, 0.01, 0.001, \u22120.001, \u22120.01, \u22120.1, \u22121, calculating the secant slope to 6 decimal places. What value does the slope appear to be approaching? [3 marks]",
          marks: 3,
          answer:
            "h=1 \u2192 2.5; h=0.1 \u2192 2.05; h=0.01 \u2192 2.005; h=0.001 \u2192 2.0005; h=\u22120.001 \u2192 1.9995; h=\u22120.01 \u2192 1.995; h=\u22120.1 \u2192 1.95; h=\u22121 \u2192 1.5. Slope \u2192 2.",
        },
        {
          prompt:
            "Explain why we must examine both h \u2192 0\u207a and h \u2192 0\u207b rather than only positive h. What geometric concept is lost if we only consider one side? [3 marks]",
          marks: 3,
          answer:
            "The limit must exist and be equal from both sides for the tangent to be well-defined. One-sided approach only gives a right-derivative or left-derivative; at a corner or cusp these differ, so the derivative does not exist there.",
        },
      ],
    },
    {
      heading: "Section B: Algebraic Formalisation \u2014 The Limit of the Difference Quotient [7 marks]",
      questions: [
        {
          prompt:
            "Evaluate lim(h\u21920) [f(2+h) \u2212 f(2)] / h algebraically using your simplified expression from Section A. Show every algebraic step. [3 marks]",
          marks: 3,
          answer:
            "lim(h\u21920) (2 + h/2) = 2 + 0/2 = 2. Hence f\u2032(2) = 2.",
        },
        {
          prompt:
            "Generalize: For f(x) = (1/2)x\u00b2 + 2, find the derivative function f\u2032(x) at any point x = a by evaluating lim(h\u21920) [f(a+h) \u2212 f(a)] / h. Show your working. [4 marks]",
          marks: 4,
          answer:
            "m_sec = [(1/2)(a\u00b2+2ah+h\u00b2)+2 \u2212 ((1/2)a\u00b2+2)] / h = [ah + h\u00b2/2] / h = a + h/2. lim(h\u21920) (a + h/2) = a. Hence f\u2032(x) = x.",
        },
      ],
    },
    {
      heading: "Section C: Proof \u2014 The Power Rule from First Principles [6 marks]",
      questions: [
        {
          prompt:
            "Let f(x) = x\u00b3. Using the difference quotient and the binomial expansion (x+h)\u00b3 = x\u00b3 + 3x\u00b2h + 3xh\u00b2 + h\u00b3, prove that f\u2032(x) = 3x\u00b2 directly from the limit definition. State each algebraic step clearly. [4 marks]",
          marks: 4,
          answer:
            "m_sec = [(x+h)\u00b3 \u2212 x\u00b3] / h = [3x\u00b2h + 3xh\u00b2 + h\u00b3] / h = 3x\u00b2 + 3xh + h\u00b2. lim(h\u21920) (3x\u00b2 + 3xh + h\u00b2) = 3x\u00b2.",
        },
        {
          prompt:
            "Justify: Explain why, after expanding (x+h)\u207f for any positive integer n, the limit as h \u2192 0 always yields nx\u207f\u207b\u00b9. You do not need to write the full binomial expansion\u2014explain the reasoning. [2 marks]",
          marks: 2,
          answer:
            "(x+h)\u207f expands to x\u207f + nx\u207f\u207b\u00b9h + [terms with h\u00b2 or higher]. Subtracting x\u207f leaves nx\u207f\u207b\u00b9h plus higher-order terms. Dividing by h gives nx\u207f\u207b\u00b9 + [terms with at least one factor of h]. As h\u21920, all terms with h vanish, leaving nx\u207f\u207b\u00b9.",
        },
      ],
    },
    {
      heading: "Section D: Continuity & the IVT \u2014 Root Existence [3 marks]",
      questions: [
        {
          prompt:
            "Let p(x) = 2x\u00b3 \u2212 7x\u00b2 + x + 10. (a) Evaluate p(\u22121) and p(0). (b) State the Intermediate Value Theorem. (c) Deduce that p(x) has at least one root in (\u22121, 0), justifying each condition of the IVT holds. [3 marks]",
          marks: 3,
          answer:
            "p(\u22121) = 2(\u22121)\u22127(1)+(\u22121)+10 = \u22122\u22127\u22121+10 = 0. p(0) = 10. Actually p(\u22121) = 0, so x = \u22121 IS a root. For another, evaluate p(\u22120.5) = \u22120.25\u22121.75\u22120.5+10 = 7.5 > 0. p(\u22121) = 0, p(\u22120.5) > 0. Consider a new interval: p(\u22121) = 0 \u2264 0 \u2264 7.5 = p(\u22120.5). The IVT requires opposite signs for a guaranteed root in the interior. Better: check p(0) = 10 > 0 and p(1/2) = 2(1/8)\u22127(1/4)+1/2+10 = 0.25\u22121.75+0.5+10 = 9 > 0. Try p(4) = 128\u2212112+4+10 = 30 > 0. p(5) = 250\u2212175+5+10 = 90 > 0. Without a sign change, IVT does not guarantee a root. The polynomial 2x\u00b3\u22127x\u00b2+x+10: at x=\u22121 it's 0; at x=2: 16\u221228+2+10 = 0. So roots at \u22121 and 2. (The exercise is meant to illustrate IVT\u2014students should find a sign change by testing values.)",
        },
      ],
    },
    {
      heading: "TOK Reflection",
      questions: [
        {
          prompt:
            "The Concept of Infinity: Calculus relies on the infinitely small (h \u2192 0). Can the human mind truly grasp the 'infinitely small,' or is this just a useful linguistic trick we invented to make our formulas work? Write 2\u20133 sentences.",
          marks: 0,
          answer: "",
        },
      ],
    },
    {
      heading: "Bridge to Activity 2",
      questions: [
        {
          prompt:
            "In Section B you cancelled the factor h from numerator and denominator. In Activity 2 you will encounter functions where the problematic factor cannot be cancelled so simply. Write down one example of a rational function that would be undefined at x = 2 and predict whether the limit exists.",
          marks: 0,
          answer: "",
        },
      ],
    },
  ],
};

// ── Stage 2: Rational Functions ─────────────

export const STAGE_2_DRAFT: AssignmentDraft = {
  title: "Activity 2: Hole or Wall?",
  subtitle:
    "IBDP Mathematics AA HL \u2014 Rational Functions & The Anatomy of Discontinuity",
  instructions: [
    "Complete all parts. Show algebraic working clearly; factor fully where possible.",
    "Use your GDC only for the final classification check, not for limit evaluation.",
    "Answer each TOK reflection in 2\u20133 sentences.",
    "The bridge question at the end connects to Activity 3.",
    "Estimated time: 120 minutes.",
  ],
  sections: [
    {
      heading: "Section A: Three Functions, Three Fates [11 marks]",
      questions: [
        {
          prompt:
            "Consider f\u2081(x) = (x\u00b2 \u2212 4)/(x \u2212 2), f\u2082(x) = (x \u2212 2)/(x\u00b2 \u2212 4), f\u2083(x) = (x\u00b2 \u2212 4)/((x \u2212 2)\u00b2). " +
            "(a) Factor the numerator of f\u2081 and cancel the common factor. State the simplified function g\u2081(x) and its domain. [2 marks]",
          marks: 2,
          answer:
            "f\u2081(x) = (x\u22122)(x+2)/(x\u22122) = x+2 for x\u22602. g\u2081(x) = x+2, domain: x \u2208 \u211d.",
        },
        {
          prompt:
            "(b) Evaluate lim(x\u21922) f\u2081(x) algebraically. Does f\u2081 have a removable discontinuity or a vertical asymptote at x = 2? Justify. [2 marks]",
          marks: 2,
          answer:
            "lim(x\u21922) f\u2081(x) = lim(x\u21922) (x+2) = 4. Since the limit exists and is finite but f\u2081(2) is undefined, the discontinuity is removable (a hole at (2, 4)).",
        },
        {
          prompt:
            "(c) For f\u2082(x), factor the denominator and attempt the same analysis. Evaluate lim(x\u21922\u207b) f\u2082(x) and lim(x\u21922\u207a) f\u2082(x). Classify the behaviour at x = 2. [3 marks]",
          marks: 3,
          answer:
            "f\u2082(x) = (x\u22122)/[(x\u22122)(x+2)] = 1/(x+2) for x\u22602,\u22122. At x=2, numerator\u21920, denominator\u21920. Using the simplified form: the factor (x\u22122) cancels, leaving 1/(x+2). So lim(x\u21922) f\u2082 = 1/4. Therefore f\u2082 also has a removable discontinuity (hole) at x=2, not an asymptote! The cancellation reveals each limit is finite.",
        },
        {
          prompt:
            "(d) For f\u2083(x), note the squared factor in the denominator. Evaluate lim(x\u21922\u207b) f\u2083(x) and lim(x\u21922\u207a) f\u2083(x). What is different about this discontinuity compared to f\u2081 and f\u2082? [2 marks]",
          marks: 2,
          answer:
            "f\u2083(x) = (x\u22122)(x+2)/(x\u22122)\u00b2 = (x+2)/(x\u22122) for x\u22602. As x\u21922\u207a, numerator\u21924, denominator\u21920\u207a, so f\u2083 \u2192 +\u221e. As x\u21922\u207b, numerator\u21924, denominator\u21920\u207b, so f\u2083 \u2192 \u2212\u221e. This is a vertical asymptote (non-removable discontinuity). Unlike f\u2081 and f\u2082, the factor (x\u22122) does NOT fully cancel\u2014one factor remains in the denominator, producing an asymptote.",
        },
        {
          prompt:
            "(e) L\u2019H\u00f4pital\u2019s Rule preview: For f\u2081, both numerator and denominator approach 0 as x \u2192 2. Differentiate numerator and denominator separately and evaluate lim(x\u21922) [d/dx(x\u00b2\u22124)]/[d/dx(x\u22122)]. Does the result match your algebraic limit? [2 marks]",
          marks: 2,
          answer:
            "lim(x\u21922) (2x)/(1) = 4. Yes, matches the algebraic limit of 4.",
        },
      ],
    },
    {
      heading: "Section B: Proving the Quotient Rule [8 marks]",
      questions: [
        {
          prompt:
            "Let Q(x) = f(x)/g(x), where f and g are differentiable and g(x) \u2260 0. Write the difference quotient for Q: [Q(x+h) \u2212 Q(x)]/h. [1 mark]",
          marks: 1,
          answer:
            "[f(x+h)/g(x+h) \u2212 f(x)/g(x)] / h",
        },
        {
          prompt:
            "Place the numerator over a common denominator g(x+h)g(x). Show that you obtain: [f(x+h)g(x) \u2212 f(x)g(x+h)] / [h\u00b7g(x+h)g(x)]. [2 marks]",
          marks: 2,
          answer:
            "= [f(x+h)g(x) \u2212 f(x)g(x+h)] / [g(x+h)g(x)] \u00b7 (1/h) = [f(x+h)g(x) \u2212 f(x)g(x+h)] / [h\u00b7g(x)g(x+h)]",
        },
        {
          prompt:
            "The critical algebraic step: Add and subtract f(x)g(x) in the numerator. Show that the numerator becomes g(x)[f(x+h) \u2212 f(x)] \u2212 f(x)[g(x+h) \u2212 g(x)]. [2 marks]",
          marks: 2,
          answer:
            "f(x+h)g(x) \u2212 f(x)g(x+h) = f(x+h)g(x) \u2212 f(x)g(x) + f(x)g(x) \u2212 f(x)g(x+h) = g(x)[f(x+h)\u2212f(x)] \u2212 f(x)[g(x+h)\u2212g(x)].",
        },
        {
          prompt:
            "Divide through by h and take the limit as h \u2192 0, using limit laws and the definition of the derivative. Conclude that Q\u2032(x) = [f\u2032(x)g(x) \u2212 f(x)g\u2032(x)] / [g(x)]\u00b2. [3 marks]",
          marks: 3,
          answer:
            "Q\u2032(x) = lim(h\u21920){g(x)[f(x+h)\u2212f(x)]/h \u2212 f(x)[g(x+h)\u2212g(x)]/h} / [g(x)g(x+h)] = [g(x)f\u2032(x) \u2212 f(x)g\u2032(x)] / [g(x)]\u00b2.",
        },
      ],
    },
    {
      heading: "Section C: Oblique Asymptotes via Polynomial Long Division [8 marks]",
      questions: [
        {
          prompt:
            "Let R(x) = (2x\u00b3 + 3x\u00b2 \u2212 x + 5)/(x\u00b2 + 1). Perform polynomial long division to write R(x) in the form R(x) = Ax + B + (Cx + D)/(x\u00b2 + 1). [3 marks]",
          marks: 3,
          answer:
            "2x\u00b3\u00f7x\u00b2 = 2x. Multiply: 2x(x\u00b2+1) = 2x\u00b3+2x. Subtract: (2x\u00b3+3x\u00b2\u2212x+5)\u2212(2x\u00b3+2x) = 3x\u00b2\u22123x+5. Next: 3x\u00b2\u00f7x\u00b2 = 3. Multiply: 3(x\u00b2+1)=3x\u00b2+3. Subtract: (3x\u00b2\u22123x+5)\u2212(3x\u00b2+3) = \u22123x+2. So R(x) = 2x + 3 + (\u22123x+2)/(x\u00b2+1).",
        },
        {
          prompt:
            "Evaluate lim(x\u2192\u221e) [(\u22123x+2)/(x\u00b2+1)]. Explain your reasoning. [2 marks]",
          marks: 2,
          answer:
            "Divide numerator and denominator by x\u00b2: lim(x\u2192\u221e) (\u22123/x + 2/x\u00b2)/(1 + 1/x\u00b2) = (0+0)/(1+0) = 0.",
        },
        {
          prompt:
            "Hence state the equation of the oblique asymptote of R(x) as x \u2192 \u221e. Verify by evaluating lim(x\u2192\u221e) [R(x) \u2212 (2x+3)]. [2 marks]",
          marks: 2,
          answer:
            "Oblique asymptote: y = 2x + 3. Verification: lim(x\u2192\u221e) [(\u22123x+2)/(x\u00b2+1)] = 0, so R(x) \u2192 2x+3.",
        },
        {
          prompt:
            "Does R(x) approach this asymptote from above or below as x \u2192 \u221e? Justify by analysing the sign of the remainder term for large positive x. [1 mark]",
          marks: 1,
          answer:
            "For large x, remainder \u2248 \u22123x/x\u00b2 = \u22123/x < 0, so R(x) approaches the asymptote from below (remainder is negative).",
        },
      ],
    },
    {
      heading: "TOK Reflection",
      questions: [
        {
          prompt:
            "The Nature of Undefined: Mathematicians say 0/0 is \u2018indeterminate\u2019\u2014yet limits like f\u2081\u2019s give definite values. Is 0/0 a number, a concept, or a fundamental failure of our arithmetic system? What does this tell us about the limits of symbolic representation?",
          marks: 0,
          answer: "",
        },
      ],
    },
    {
      heading: "Bridge to Activity 3",
      questions: [
        {
          prompt:
            "You saw that the oblique asymptote arises because the polynomial part dominates the rational remainder at infinity. But what if a function grows faster than ANY polynomial? Write down the limit definition of e and predict whether e\u02e3 will eventually exceed x\u00b9\u2070\u2070.",
          marks: 0,
          answer: "",
        },
      ],
    },
  ],
};

// ── Stage 3: Exponential & Logarithmic ──────

export const STAGE_3_DRAFT: AssignmentDraft = {
  title: "Activity 3: The Hierarchy of Infinity",
  subtitle:
    "IBDP Mathematics AA HL \u2014 Exponential & Logarithmic Functions & Transcendental Boundaries",
  instructions: [
    "Show all working. Exact answers first, then decimal approximations where requested.",
    "You may use a GDC for the numerical tables in Section A only.",
    "The TOK reflection requires a thoughtful written response.",
    "Estimated time: 120 minutes.",
  ],
  sections: [
    {
      heading: "Section A: Numerical Investigation \u2014 Polynomial vs. Exponential [8 marks]",
      questions: [
        {
          prompt:
            "Consider P(x) = x\u00b9\u2070 and E(x) = e\u02e3. (a) Evaluate P(x) and E(x) at x = 10, 20, 30, 40, 50. At approximately what x does E(x) first exceed P(x)? [3 marks]",
          marks: 3,
          answer:
            "x=10: 10\u00b9\u2070 = 1\u00d710\u00b9\u2070, e\u00b9\u2070 \u2248 2.2\u00d710\u2074; P dominates. x=20: 20\u00b9\u2070 \u2248 1.02\u00d710\u00b9\u00b3, e\u00b2\u2070 \u2248 4.85\u00d710\u2078; P dominates. x=30: 30\u00b9\u2070 \u2248 5.9\u00d710\u00b9\u2074, e\u00b3\u2070 \u2248 1.07\u00d710\u00b9\u00b3; P dominates. x=40: 40\u00b9\u2070 \u2248 1.05\u00d710\u00b9\u2076, e\u2074\u2070 \u2248 2.35\u00d710\u00b9\u2077; E dominates! Crosses between 35 and 40.",
        },
        {
          prompt:
            "(b) Evaluate the limit L = lim(x\u2192\u221e) x\u00b9\u2070/e\u02e3 by constructing a table for x = 10, 20, 30, 40, 50 computing x\u00b9\u2070/e\u02e3 to 4 significant figures. [2 marks]",
          marks: 2,
          answer:
            "x=10: 10\u00b9\u2070/e\u00b9\u2070 \u2248 4.54\u00d710\u2075. x=20: 2.11\u00d710\u2074. x=30: 55.1. x=40: 0.0446. x=50: 1.93\u00d710\u207b\u2075. Ratio \u2192 0.",
        },
        {
          prompt:
            "(c) Based on your table, hypothesize the value of lim(x\u2192\u221e) x\u00b9\u2070/e\u02e3. What does this suggest about the relative \u2018strength\u2019 of exponential vs. polynomial growth? [3 marks]",
          marks: 3,
          answer:
            "The limit is 0. Exponential growth eventually STRICTLY DOMINATES any polynomial growth, regardless of the power. The exponential always wins at infinity.",
        },
      ],
    },
    {
      heading: "Section B: The Definition of e and the Derivative of e\u02e3 [10 marks]",
      questions: [
        {
          prompt:
            "Euler\u2019s number e is defined as the unique real number satisfying lim(h\u21920) (e\u02b0 \u2212 1)/h = 1. (a) For a generic base a > 0, a \u2260 1, show using the difference quotient that the derivative of a\u02e3 at x = 0 is lim(h\u21920) (a\u02b0 \u2212 1)/h. [2 marks]",
          marks: 2,
          answer:
            "d/dx[a\u02e3] at x=0 = lim(h\u21920) [a\u2070\u207a\u02b0 \u2212 a\u2070]/h = lim(h\u21920) (a\u02b0 \u2212 1)/h.",
        },
        {
          prompt:
            "(b) Hence, if f(x) = a\u02e3, show that f\u2032(x) = f\u2032(0)\u00b7a\u02e3. (Hint: write the difference quotient and use the index law a\u02e3\u207a\u02b0 = a\u02e3\u00b7a\u02b0.) [3 marks]",
          marks: 3,
          answer:
            "f\u2032(x) = lim(h\u21920) [a\u02e3\u207a\u02b0 \u2212 a\u02e3]/h = lim(h\u21920) a\u02e3(a\u02b0\u22121)/h = a\u02e3\u00b7lim(h\u21920) (a\u02b0\u22121)/h = a\u02e3\u00b7f\u2032(0).",
        },
        {
          prompt:
            "(c) The number e is defined so that f\u2032(0) = 1. Prove that d/dx(e\u02e3) = e\u02e3. [2 marks]",
          marks: 2,
          answer:
            "d/dx(e\u02e3) = e\u02e3\u00b7lim(h\u21920) (e\u02b0\u22121)/h = e\u02e3\u00b71 = e\u02e3.",
        },
        {
          prompt:
            "(d) Use the derivative of e\u02e3 and implicit differentiation to prove that d/dx(ln x) = 1/x for x > 0. Show all steps. [3 marks]",
          marks: 3,
          answer:
            "Let y = ln x. Then e\u02b8 = x. Differentiate both sides w.r.t. x: d/dx(e\u02b8) = d/dx(x) \u2192 e\u02b8\u00b7dy/dx = 1 \u2192 dy/dx = 1/e\u02b8 = 1/x.",
        },
      ],
    },
    {
      heading: "Section C: Formal Proof \u2014 L\u2019H\u00f4pital\u2019s Rule Iterated [8 marks]",
      questions: [
        {
          prompt:
            "Consider L = lim(x\u2192\u221e) x\u00b9\u2070/e\u02e3. (a) Explain why L\u2019H\u00f4pital\u2019s Rule applies to this limit (state the indeterminate form). [1 mark]",
          marks: 1,
          answer: "As x\u2192\u221e, x\u00b9\u2070 \u2192 \u221e and e\u02e3 \u2192 \u221e, giving \u221e/\u221e.",
        },
        {
          prompt:
            "(b) Apply L\u2019H\u00f4pital\u2019s Rule once: differentiate numerator and denominator and state the new limit. [2 marks]",
          marks: 2,
          answer: "L = lim(x\u2192\u221e) 10x\u2079 / e\u02e3. Still \u221e/\u221e form.",
        },
        {
          prompt:
            "(c) How many times must L\u2019H\u00f4pital\u2019s Rule be applied before the numerator becomes a constant? What is that constant? Apply the rule all the way and state the final limit. [3 marks]",
          marks: 3,
          answer:
            "10 applications needed. After 10 applications: L = lim(x\u2192\u221e) 10!/e\u02e3 = 3628800/\u221e = 0. So L = 0.",
        },
        {
          prompt:
            "(d) Generalize: Does lim(x\u2192\u221e) x\u207f/e\u02e3 = 0 for ANY positive integer n? Prove using L\u2019H\u00f4pital\u2019s Rule and induction. [2 marks]",
          marks: 2,
          answer:
            "Yes. After n applications, numerator becomes n! (constant), denominator remains e\u02e3\u2192\u221e. Limit = 0 for all n \u2208 \u2124\u207a.",
        },
      ],
    },
    {
      heading: "TOK Reflection",
      questions: [
        {
          prompt:
            "Invention vs. Discovery: Euler\u2019s number e emerges from the unique solution to a limit problem, yet it appears throughout nature\u2014radioactive decay, population growth, compound interest. Was e invented by mathematicians as a convenient constant, or is it a fundamental property of the universe we discovered?",
          marks: 0,
          answer: "",
        },
      ],
    },
    {
      heading: "Bridge to Activity 4",
      questions: [
        {
          prompt:
            "You proved that e\u02e3 dominates polynomials, but what about functions that oscillate? Consider lim(x\u21920) sin(1/x). Does this limit exist? Predict what tools we might need to handle limits involving oscillation.",
          marks: 0,
          answer: "",
        },
      ],
    },
  ],
};

// ── Stage 4: Trigonometric Functions ────────

export const STAGE_4_DRAFT: AssignmentDraft = {
  title: "Activity 4: The Squeeze Sandbox",
  subtitle:
    "IBDP Mathematics AA HL \u2014 Trigonometric Functions, Oscillation & The Squeeze Theorem",
  instructions: [
    "Use radian measure throughout this activity.",
    "All limit evaluations must be justified\u2014no \u2018by calculator\u2019 shortcuts.",
    "The geometric proof in Section B requires careful diagram drawing.",
    "Estimated time: 120 minutes.",
  ],
  sections: [
    {
      heading: "Section A: When Standard Tools Fail [5 marks]",
      questions: [
        {
          prompt:
            "Consider L = lim(x\u21920) x\u00b2\u00b7sin(1/x). (a) Explain why direct substitution fails. [1 mark]",
          marks: 1,
          answer: "sin(1/0) is undefined\u20141/0 is not a real number.",
        },
        {
          prompt:
            "(b) Explain why L\u2019H\u00f4pital\u2019s Rule cannot be applied to this limit. [1 mark]",
          marks: 1,
          answer:
            "The limit is of the form 0\u00b7[undefined oscillating], not 0/0 or \u221e/\u221e. sin(1/x) has no limit as x\u21920, so the rule does not apply.",
        },
        {
          prompt:
            "(c) Argue intuitively: as x approaches 0, x\u00b2 approaches 0 and sin(1/x) stays between \u22121 and 1. What must the product approach? [1 mark]",
          marks: 1,
          answer: "0 \u00d7 (bounded) = 0, so the limit should be 0.",
        },
        {
          prompt:
            "(d) Formalize: Establish the inequality \u2212x\u00b2 \u2264 x\u00b2\u00b7sin(1/x) \u2264 x\u00b2 for all x \u2260 0. Explain why these bounds hold. [2 marks]",
          marks: 2,
          answer:
            "For all real t, \u22121 \u2264 sin(t) \u2264 1. Since x\u00b2 \u2265 0, multiplying preserves the inequality direction: \u2212x\u00b2 \u2264 x\u00b2\u00b7sin(1/x) \u2264 x\u00b2.",
        },
      ],
    },
    {
      heading: "Section B: The Fundamental Trigonometric Limit \u2014 Geometric Proof [10 marks]",
      questions: [
        {
          prompt:
            "Draw the unit circle with centre O. Let angle \u03b8 (in radians, 0 < \u03b8 < \u03c0/2) sweep out: point A(1,0), point P on the circle at angle \u03b8, point B as the foot of the perpendicular from P to OA, and point T where the tangent at A meets the extended radius through P. [2 marks]",
          marks: 2,
          answer:
            "Diagram: O(0,0), A(1,0), P(cos\u03b8, sin\u03b8), B(cos\u03b8, 0), T(1, tan\u03b8).",
        },
        {
          prompt:
            "Identify three areas in ascending order: Area(\u25b3OBP) < Area(sector OAP) < Area(\u25b3OAT). Express each area in terms of \u03b8. [3 marks]",
          marks: 3,
          answer:
            "Area(\u25b3OBP) = (1/2)(cos\u03b8)(sin\u03b8). Area(sector OAP) = (1/2)\u03b8. Area(\u25b3OAT) = (1/2)(1)(tan\u03b8) = tan\u03b8/2. So (1/2)cos\u03b8 sin\u03b8 < \u03b8/2 < (1/2)tan\u03b8.",
        },
        {
          prompt:
            "Multiply through by 2, divide by sin\u03b8 (positive), then take reciprocals to obtain: cos\u03b8 < sin\u03b8/\u03b8 < 1/cos\u03b8. [1 mark]",
          marks: 1,
          answer:
            "cos\u03b8 sin\u03b8 < \u03b8 < tan\u03b8 = sin\u03b8/cos\u03b8. Divide by sin\u03b8: cos\u03b8 < \u03b8/sin\u03b8 < 1/cos\u03b8. Reciprocals: cos\u03b8 < sin\u03b8/\u03b8 < 1/cos\u03b8.",
        },
        {
          prompt:
            "Take the limit as \u03b8 \u2192 0\u207a. Evaluate lim(\u03b8\u21920\u207a) cos\u03b8 and lim(\u03b8\u21920\u207a) 1/cos\u03b8. Apply the Squeeze Theorem to conclude lim(\u03b8\u21920\u207a) sin\u03b8/\u03b8 = 1. [2 marks]",
          marks: 2,
          answer:
            "lim(\u03b8\u21920\u207a) cos\u03b8 = 1. lim(\u03b8\u21920\u207a) 1/cos\u03b8 = 1. By Squeeze Theorem, sin\u03b8/\u03b8 is trapped between two functions both approaching 1, so lim = 1.",
        },
        {
          prompt:
            "Explain why the result also holds for \u03b8 \u2192 0\u207b (use sin(\u2212\u03b8)/(\u2212\u03b8) = sin\u03b8/\u03b8). Hence conclude lim(x\u21920) sin x/x = 1. [2 marks]",
          marks: 2,
          answer:
            "For \u03b8 < 0, let \u03c6 = \u2212\u03b8 > 0. sin(\u2212\u03c6)/(\u2212\u03c6) = \u2212sin\u03c6/(\u2212\u03c6) = sin\u03c6/\u03c6 \u2192 1. Both one-sided limits equal 1, so the two-sided limit is 1.",
        },
      ],
    },
    {
      heading: "Section C: Derivatives of Sine and Cosine from First Principles [8 marks]",
      questions: [
        {
          prompt:
            "Let f(x) = sin x. Set up the difference quotient and apply sin(A+B) = sin A cos B + cos A sin B. [2 marks]",
          marks: 2,
          answer:
            "f\u2032(x) = lim(h\u21920) [sin x cos h + cos x sin h \u2212 sin x]/h = sin x\u00b7lim(h\u21920) (cos h\u22121)/h + cos x\u00b7lim(h\u21920) sin h/h.",
        },
        {
          prompt:
            "Prove that lim(h\u21920) (cos h \u2212 1)/h = 0. (Hint: multiply numerator and denominator by cos h + 1 and use sin\u00b2h + cos\u00b2h = 1.) [3 marks]",
          marks: 3,
          answer:
            "lim (cos h\u22121)/h = lim (cos\u00b2h\u22121)/[h(cos h+1)] = lim (\u2212sin\u00b2h)/[h(cos h+1)] = lim [\u2212sin h/h \u00b7 sin h/(cos h+1)] = \u22121\u00b70/2 = 0.",
        },
        {
          prompt:
            "Hence prove d/dx(sin x) = cos x and d/dx(cos x) = \u2212sin x. (Use cos x = sin(\u03c0/2 \u2212 x) and the chain rule for the second.) [3 marks]",
          marks: 3,
          answer:
            "d/dx(sin x) = sin x\u00b70 + cos x\u00b71 = cos x. d/dx(cos x) = d/dx[sin(\u03c0/2\u2212x)] = cos(\u03c0/2\u2212x)\u00b7(\u22121) = \u2212sin x.",
        },
      ],
    },
    {
      heading: "Section D: Formal Squeeze Theorem Application [4 marks]",
      questions: [
        {
          prompt:
            "Evaluate lim(x\u21920) x\u00b7cos(1/x\u00b2) using the Squeeze Theorem. State bounding functions explicitly. [2 marks]",
          marks: 2,
          answer:
            "\u2212|x| \u2264 x\u00b7cos(1/x\u00b2) \u2264 |x|. Both bounds \u2192 0, so limit = 0.",
        },
        {
          prompt:
            "Evaluate lim(x\u21920) sin(3x)/x by relating it to the fundamental limit. [2 marks]",
          marks: 2,
          answer:
            "sin(3x)/x = 3\u00b7sin(3x)/(3x). Let u = 3x. As x\u21920, u\u21920. So 3\u00b7lim(u\u21920) sin u/u = 3\u00b71 = 3.",
        },
      ],
    },
    {
      heading: "TOK Reflection",
      questions: [
        {
          prompt:
            "Degrees vs. Radians: The limit sin x/x \u2192 1 only holds in radian measure. Does this mean radians are a \u2018truer\u2019 measure of angle than degrees, or are they simply better adapted to the needs of calculus? Is mathematical \u2018truth\u2019 dependent on the units we choose?",
          marks: 0,
          answer: "",
        },
      ],
    },
    {
      heading: "Bridge to Activity 5",
      questions: [
        {
          prompt:
            "The sine function is periodic and fails the Horizontal Line Test on (\u2212\u221e,\u221e). What is the largest interval containing 0 on which sin x IS one-to-one? What would the derivative of its inverse function look like near the endpoints of that interval?",
          marks: 0,
          answer: "",
        },
      ],
    },
  ],
};

// ── Stage 5: Inverse Trig Functions ──────────

export const STAGE_5_DRAFT: AssignmentDraft = {
  title: "Activity 5: Slicing the Wave",
  subtitle:
    "IBDP Mathematics AA HL \u2014 Inverse & Reciprocal Trigonometric Functions & Restricted Domains",
  instructions: [
    "Use radian measure throughout.",
    "Draw diagrams where indicated\u2014accuracy matters.",
    "The TOK reflection invites a philosophical response.",
    "Estimated time: 120 minutes.",
  ],
  sections: [
    {
      heading: "Section A: Why We Must Restrict [5 marks]",
      questions: [
        {
          prompt:
            "Sketch y = sin x for \u22123\u03c0 \u2264 x \u2264 3\u03c0. Draw the line y = x and attempt to reflect the sine curve across it to obtain y = arcsin x. (a) Explain why the reflected graph fails the vertical line test. [2 marks]",
          marks: 2,
          answer:
            "sin x is not one-to-one on (\u2212\u221e,\u221e) because it is periodic. When reflected across y=x, multiple x-values map to the same y-value, creating a relation that is not a function.",
        },
        {
          prompt:
            "(b) Identify the interval containing 0 on which sin x is strictly increasing and one-to-one. What are the sine values at the endpoints? [2 marks]",
          marks: 2,
          answer:
            "[\u2212\u03c0/2, \u03c0/2]. sin(\u2212\u03c0/2) = \u22121, sin(\u03c0/2) = 1. On this interval, sine is strictly increasing from \u22121 to 1.",
        },
        {
          prompt:
            "(c) Define the principal value domain of y = arcsin x. State its domain and range. [1 mark]",
          marks: 1,
          answer:
            "Domain: [\u22121, 1]. Range: [\u2212\u03c0/2, \u03c0/2]. y = arcsin x \u21d4 sin y = x and \u2212\u03c0/2 \u2264 y \u2264 \u03c0/2.",
        },
      ],
    },
    {
      heading: "Section B: Derivative of arcsin x via Implicit Differentiation [8 marks]",
      questions: [
        {
          prompt:
            "Let y = arcsin x. Then sin y = x with y \u2208 [\u2212\u03c0/2, \u03c0/2]. Differentiate both sides of sin y = x w.r.t. x. [2 marks]",
          marks: 2,
          answer:
            "cos y \u00b7 dy/dx = 1 \u2192 dy/dx = 1/cos y.",
        },
        {
          prompt:
            "Express cos y in terms of x. Draw a right-angled triangle with angle y, opposite side x, and hypotenuse 1. Find the adjacent side using Pythagoras. [2 marks]",
          marks: 2,
          answer:
            "Adjacent = \u221a(1 \u2212 x\u00b2). cos y = \u221a(1\u2212x\u00b2)/1 = \u221a(1\u2212x\u00b2). (Positive root since cos y \u2265 0 on [\u2212\u03c0/2, \u03c0/2].)",
        },
        {
          prompt:
            "Hence prove that d/dx(arcsin x) = 1/\u221a(1\u2212x\u00b2) for |x| < 1. [1 mark]",
          marks: 1,
          answer:
            "dy/dx = 1/cos y = 1/\u221a(1\u2212x\u00b2) for |x| < 1.",
        },
        {
          prompt:
            "Using a similar method, prove that d/dx(arctan x) = 1/(1+x\u00b2). [3 marks]",
          marks: 3,
          answer:
            "y = arctan x \u21d4 tan y = x, \u2212\u03c0/2 < y < \u03c0/2. sec\u00b2y\u00b7dy/dx = 1 \u2192 dy/dx = 1/sec\u00b2y = 1/(1+tan\u00b2y) = 1/(1+x\u00b2).",
        },
      ],
    },
    {
      heading: "Section C: Limit Analysis at the Boundaries [8 marks]",
      questions: [
        {
          prompt:
            "Consider f(x) = arcsin x and f\u2032(x) = 1/\u221a(1\u2212x\u00b2). (a) Explain why the domain of f is [\u22121, 1] but the domain of f\u2032 excludes the endpoints. [2 marks]",
          marks: 2,
          answer:
            "f\u2032 involves division by \u221a(1\u2212x\u00b2), which is undefined when 1\u2212x\u00b2 = 0, i.e. at x = \u00b11. These are algebraic singularities, though f is defined and continuous there.",
        },
        {
          prompt:
            "(b) Evaluate lim(x\u21921\u207b) f\u2032(x) and lim(x\u2192\u22121\u207a) f\u2032(x). Interpret geometrically. [3 marks]",
          marks: 3,
          answer:
            "lim(x\u21921\u207b) 1/\u221a(1\u2212x\u00b2) = +\u221e. lim(x\u2192\u22121\u207a) 1/\u221a(1\u2212x\u00b2) = +\u221e. The graph of arcsin x has vertical tangents at (\u22121, \u2212\u03c0/2) and (1, \u03c0/2)\u2014the curve rises vertically at the endpoints.",
        },
        {
          prompt:
            "(c) Let g(x) = arcsin(sin x), defined for all real x. Evaluate g(0), g(\u03c0/6), g(\u03c0), g(3\u03c0/2). Explain why g(x) \u2260 x in general. What is the range of g? [3 marks]",
          marks: 3,
          answer:
            "g(0)=0, g(\u03c0/6)=\u03c0/6, g(\u03c0)=0, g(3\u03c0/2)=\u2212\u03c0/2. g(x)\u2260x because arcsin restricts output to [\u2212\u03c0/2, \u03c0/2]. It \u2018folds back\u2019 values outside this interval. Range: [\u2212\u03c0/2, \u03c0/2].",
        },
      ],
    },
    {
      heading: "Section D: Synthesis \u2014 A Limit Bridging All Stages [3 marks]",
      questions: [
        {
          prompt:
            "Evaluate lim(x\u21920) [arcsin(e\u02e3 \u2212 1)]/[sin(3x)] \u00b7 [x/ln(1+x)]. (Hint: Identify and use known limits from Activities 1\u20134: the difference quotient, sin\u03b8/\u03b8 \u2192 1, the definition of e, and the derivative of arcsin x at 0.) [3 marks]",
          marks: 3,
          answer:
            "As x\u21920: e\u02e3\u22121 ~ x (Activity 3). arcsin(e\u02e3\u22121) ~ arcsin(x) ~ x (Activity 5, f\u2032(0)=1). sin(3x) ~ 3x (Activity 4). ln(1+x) ~ x (Activity 3). So limit = [x/3x]\u00b7[x/x] = (1/3)\u00b71 = 1/3.",
        },
      ],
    },
    {
      heading: "TOK Reflection",
      questions: [
        {
          prompt:
            "Pragmatism in Mathematics: By restricting the domain of sine to [\u2212\u03c0/2, \u03c0/2], we create a well-defined inverse function\u2014but are we ignoring mathematical reality just to make our functions \u2018work\u2019? Does domain restriction reflect a deeper mathematical truth or is it a convenient human construct?",
          marks: 0,
          answer: "",
        },
      ],
    },
    {
      heading: "End of Module Reflection",
      questions: [
        {
          prompt:
            "You have completed all 5 activities spanning polynomials, rational functions, exponentials/logarithms, trigonometric functions, and inverse trigonometric functions. Write a short paragraph summarizing the single most important idea that connects all five stages of this calculus journey.",
          marks: 0,
          answer: "",
        },
      ],
    },
  ],
};

// ── Master lookup ────────────────────────────

export const ALL_ACTIVITY_DRAFTS: Record<number, AssignmentDraft> = {
  1: STAGE_1_DRAFT,
  2: STAGE_2_DRAFT,
  3: STAGE_3_DRAFT,
  4: STAGE_4_DRAFT,
  5: STAGE_5_DRAFT,
};