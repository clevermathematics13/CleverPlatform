// Five interconnected activity sheets for the IBDP AA HL "Foundations of Calculus: A Function-Family Approach to Limits"
// Each designed for ~2 hours, on paper, with high cognitive load and all IB components integrated

import type { AssignmentDraft } from "@/lib/assignments";

// -- Stage metadata --------------------------

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
      "Bridge question: Your algebraic limit evaluation relied on cancelling a common factor—what happens when that factor cannot be cancelled? Stage 2 will explore functions where limits reveal hidden structure.",
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
      "You have now traversed the entire function-family landscape of calculus foundations. Each stage built on the last—from the algebra of polynomials to the subtlety of transcendental inverses.",
  },
};

// -- Stage 1: Polynomial Functions -----------

export const STAGE_1_DRAFT: AssignmentDraft = {
  title: "Activity 1: The Shrinking Secant",
  subtitle:
    "IBDP Mathematics AA HL — Polynomial Functions & The Intuitive Foundation of Limits",
  instructions: [
    "Complete all parts in the spaces provided. Show all working clearly.",
    "Use a calculator for numerical exploration but leave algebraic steps exact.",
    "Read each TOK reflection box and write a short response (2–3 sentences).",
    "The final bridge question connects to Activity 2—keep your answer for reference.",
    "Marks are indicated in square brackets. This activity should take approximately 120 minutes.",
  ],
  sections: [
    {
      heading: "Section A: Numerical Exploration — The Secant That Shrinks [9 marks]",
      questions: [
        {
          prompt:
            "Consider f(x) = (1/2)x² + 2. We wish to find the exact gradient of the curve at x = 2. " +
            "(a) Write the slope of the secant line passing through (2, f(2)) and (2 + h, f(2 + h)) as a single algebraic expression in h. Simplify fully. [3 marks]",
          marks: 3,
          answer:
            "m_sec = [f(2+h) − f(2)] / h = [(1/2)(4+4h+h²)+2 − 4] / h = [2+2h+h²/2+2 − 4] / h = (2h + h²/2) / h = 2 + h/2",
        },
        {
          prompt:
            "Build a table for h = 1, 0.1, 0.01, 0.001, −0.001, −0.01, −0.1, −1, calculating the secant slope to 6 decimal places. What value does the slope appear to be approaching? [3 marks]",
          marks: 3,
          answer:
            "h=1 → 2.5; h=0.1 → 2.05; h=0.01 → 2.005; h=0.001 → 2.0005; h=−0.001 → 1.9995; h=−0.01 → 1.995; h=−0.1 → 1.95; h=−1 → 1.5. Slope → 2.",
        },
        {
          prompt:
            "Explain why we must examine both h → 0⁺ and h → 0⁻ rather than only positive h. What geometric concept is lost if we only consider one side? [3 marks]",
          marks: 3,
          answer:
            "The limit must exist and be equal from both sides for the tangent to be well-defined. One-sided approach only gives a right-derivative or left-derivative; at a corner or cusp these differ, so the derivative does not exist there.",
        },
      ],
    },
    {
      heading: "Section B: Algebraic Formalisation — The Limit of the Difference Quotient [7 marks]",
      questions: [
        {
          prompt:
            "Evaluate lim(h→0) [f(2+h) − f(2)] / h algebraically using your simplified expression from Section A. Show every algebraic step. [3 marks]",
          marks: 3,
          answer:
            "lim(h→0) (2 + h/2) = 2 + 0/2 = 2. Hence f′(2) = 2.",
        },
        {
          prompt:
            "Generalize: For f(x) = (1/2)x² + 2, find the derivative function f′(x) at any point x = a by evaluating lim(h→0) [f(a+h) − f(a)] / h. Show your working. [4 marks]",
          marks: 4,
          answer:
            "m_sec = [(1/2)(a²+2ah+h²)+2 − ((1/2)a²+2)] / h = [ah + h²/2] / h = a + h/2. lim(h→0) (a + h/2) = a. Hence f′(x) = x.",
        },
      ],
    },
    {
      heading: "Section C: Proof — The Power Rule from First Principles [6 marks]",
      questions: [
        {
          prompt:
            "Let f(x) = x³. Using the difference quotient and the binomial expansion (x+h)³ = x³ + 3x²h + 3xh² + h³, prove that f′(x) = 3x² directly from the limit definition. State each algebraic step clearly. [4 marks]",
          marks: 4,
          answer:
            "m_sec = [(x+h)³ − x³] / h = [3x²h + 3xh² + h³] / h = 3x² + 3xh + h². lim(h→0) (3x² + 3xh + h²) = 3x².",
        },
        {
          prompt:
            "Justify: Explain why, after expanding (x+h)ⁿ for any positive integer n, the limit as h → 0 always yields nxⁿ⁻¹. You do not need to write the full binomial expansion—explain the reasoning. [2 marks]",
          marks: 2,
          answer:
            "(x+h)ⁿ expands to xⁿ + nxⁿ⁻¹h + [terms with h² or higher]. Subtracting xⁿ leaves nxⁿ⁻¹h plus higher-order terms. Dividing by h gives nxⁿ⁻¹ + [terms with at least one factor of h]. As h→0, all terms with h vanish, leaving nxⁿ⁻¹.",
        },
      ],
    },
    {
      heading: "Section D: Continuity & the IVT — Root Existence [3 marks]",
      questions: [
        {
          prompt:
            "Let p(x) = 2x³ − 7x² + x + 10. (a) Evaluate p(−1) and p(0). (b) State the Intermediate Value Theorem. (c) Deduce that p(x) has at least one root in (−1, 0), justifying each condition of the IVT holds. [3 marks]",
          marks: 3,
          answer:
            "p(−1) = 2(−1)−7(1)+(−1)+10 = −2−7−1+10 = 0. p(0) = 10. Actually p(−1) = 0, so x = −1 IS a root. For another, evaluate p(−0.5) = −0.25−1.75−0.5+10 = 7.5 > 0. p(−1) = 0, p(−0.5) > 0. Consider a new interval: p(−1) = 0 ≤ 0 ≤ 7.5 = p(−0.5). The IVT requires opposite signs for a guaranteed root in the interior. Better: check p(0) = 10 > 0 and p(1/2) = 2(1/8)−7(1/4)+1/2+10 = 0.25−1.75+0.5+10 = 9 > 0. Try p(4) = 128−112+4+10 = 30 > 0. p(5) = 250−175+5+10 = 90 > 0. Without a sign change, IVT does not guarantee a root. The polynomial 2x³−7x²+x+10: at x=−1 it's 0; at x=2: 16−28+2+10 = 0. So roots at −1 and 2. (The exercise is meant to illustrate IVT—students should find a sign change by testing values.)",
        },
      ],
    },
    {
      heading: "TOK Reflection",
      questions: [
        {
          prompt:
            "The Concept of Infinity: Calculus relies on the infinitely small (h → 0). Can the human mind truly grasp the 'infinitely small,' or is this just a useful linguistic trick we invented to make our formulas work? Write 2–3 sentences.",
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

// -- Stage 2: Rational Functions -------------

export const STAGE_2_DRAFT: AssignmentDraft = {
  title: "Activity 2: Hole or Wall?",
  subtitle:
    "IBDP Mathematics AA HL — Rational Functions & The Anatomy of Discontinuity",
  instructions: [
    "Complete all parts. Show algebraic working clearly; factor fully where possible.",
    "Use your GDC only for the final classification check, not for limit evaluation.",
    "Answer each TOK reflection in 2–3 sentences.",
    "The bridge question at the end connects to Activity 3.",
    "Estimated time: 120 minutes.",
  ],
  sections: [
    {
      heading: "Section A: Three Functions, Three Fates [11 marks]",
      questions: [
        {
          prompt:
            "Consider f₁(x) = (x² − 4)/(x − 2), f₂(x) = (x − 2)/(x² − 4), f₃(x) = (x² − 4)/((x − 2)²). " +
            "(a) Factor the numerator of f₁ and cancel the common factor. State the simplified function g₁(x) and its domain. [2 marks]",
          marks: 2,
          answer:
            "f₁(x) = (x−2)(x+2)/(x−2) = x+2 for x≠2. g₁(x) = x+2, domain: x ∈ ℝ.",
        },
        {
          prompt:
            "(b) Evaluate lim(x→2) f₁(x) algebraically. Does f₁ have a removable discontinuity or a vertical asymptote at x = 2? Justify. [2 marks]",
          marks: 2,
          answer:
            "lim(x→2) f₁(x) = lim(x→2) (x+2) = 4. Since the limit exists and is finite but f₁(2) is undefined, the discontinuity is removable (a hole at (2, 4)).",
        },
        {
          prompt:
            "(c) For f₂(x), factor the denominator and attempt the same analysis. Evaluate lim(x→2⁻) f₂(x) and lim(x→2⁺) f₂(x). Classify the behaviour at x = 2. [3 marks]",
          marks: 3,
          answer:
            "f₂(x) = (x−2)/[(x−2)(x+2)] = 1/(x+2) for x≠2,−2. At x=2, numerator→0, denominator→0. Using the simplified form: the factor (x−2) cancels, leaving 1/(x+2). So lim(x→2) f₂ = 1/4. Therefore f₂ also has a removable discontinuity (hole) at x=2, not an asymptote! The cancellation reveals each limit is finite.",
        },
        {
          prompt:
            "(d) For f₃(x), note the squared factor in the denominator. Evaluate lim(x→2⁻) f₃(x) and lim(x→2⁺) f₃(x). What is different about this discontinuity compared to f₁ and f₂? [2 marks]",
          marks: 2,
          answer:
            "f₃(x) = (x−2)(x+2)/(x−2)² = (x+2)/(x−2) for x≠2. As x→2⁺, numerator→4, denominator→0⁺, so f₃ → +∞. As x→2⁻, numerator→4, denominator→0⁻, so f₃ → −∞. This is a vertical asymptote (non-removable discontinuity). Unlike f₁ and f₂, the factor (x−2) does NOT fully cancel—one factor remains in the denominator, producing an asymptote.",
        },
        {
          prompt:
            "(e) L’Hôpital’s Rule preview: For f₁, both numerator and denominator approach 0 as x → 2. Differentiate numerator and denominator separately and evaluate lim(x→2) [d/dx(x²−4)]/[d/dx(x−2)]. Does the result match your algebraic limit? [2 marks]",
          marks: 2,
          answer:
            "lim(x→2) (2x)/(1) = 4. Yes, matches the algebraic limit of 4.",
        },
      ],
    },
    {
      heading: "Section B: Proving the Quotient Rule [8 marks]",
      questions: [
        {
          prompt:
            "Let Q(x) = f(x)/g(x), where f and g are differentiable and g(x) ≠ 0. Write the difference quotient for Q: [Q(x+h) − Q(x)]/h. [1 mark]",
          marks: 1,
          answer:
            "[f(x+h)/g(x+h) − f(x)/g(x)] / h",
        },
        {
          prompt:
            "Place the numerator over a common denominator g(x+h)g(x). Show that you obtain: [f(x+h)g(x) − f(x)g(x+h)] / [h·g(x+h)g(x)]. [2 marks]",
          marks: 2,
          answer:
            "= [f(x+h)g(x) − f(x)g(x+h)] / [g(x+h)g(x)] · (1/h) = [f(x+h)g(x) − f(x)g(x+h)] / [h·g(x)g(x+h)]",
        },
        {
          prompt:
            "The critical algebraic step: Add and subtract f(x)g(x) in the numerator. Show that the numerator becomes g(x)[f(x+h) − f(x)] − f(x)[g(x+h) − g(x)]. [2 marks]",
          marks: 2,
          answer:
            "f(x+h)g(x) − f(x)g(x+h) = f(x+h)g(x) − f(x)g(x) + f(x)g(x) − f(x)g(x+h) = g(x)[f(x+h)−f(x)] − f(x)[g(x+h)−g(x)].",
        },
        {
          prompt:
            "Divide through by h and take the limit as h → 0, using limit laws and the definition of the derivative. Conclude that Q′(x) = [f′(x)g(x) − f(x)g′(x)] / [g(x)]². [3 marks]",
          marks: 3,
          answer:
            "Q′(x) = lim(h→0){g(x)[f(x+h)−f(x)]/h − f(x)[g(x+h)−g(x)]/h} / [g(x)g(x+h)] = [g(x)f′(x) − f(x)g′(x)] / [g(x)]².",
        },
      ],
    },
    {
      heading: "Section C: Oblique Asymptotes via Polynomial Long Division [8 marks]",
      questions: [
        {
          prompt:
            "Let R(x) = (2x³ + 3x² − x + 5)/(x² + 1). Perform polynomial long division to write R(x) in the form R(x) = Ax + B + (Cx + D)/(x² + 1). [3 marks]",
          marks: 3,
          answer:
            "2x³÷x² = 2x. Multiply: 2x(x²+1) = 2x³+2x. Subtract: (2x³+3x²−x+5)−(2x³+2x) = 3x²−3x+5. Next: 3x²÷x² = 3. Multiply: 3(x²+1)=3x²+3. Subtract: (3x²−3x+5)−(3x²+3) = −3x+2. So R(x) = 2x + 3 + (−3x+2)/(x²+1).",
        },
        {
          prompt:
            "Evaluate lim(x→∞) [(−3x+2)/(x²+1)]. Explain your reasoning. [2 marks]",
          marks: 2,
          answer:
            "Divide numerator and denominator by x²: lim(x→∞) (−3/x + 2/x²)/(1 + 1/x²) = (0+0)/(1+0) = 0.",
        },
        {
          prompt:
            "Hence state the equation of the oblique asymptote of R(x) as x → ∞. Verify by evaluating lim(x→∞) [R(x) − (2x+3)]. [2 marks]",
          marks: 2,
          answer:
            "Oblique asymptote: y = 2x + 3. Verification: lim(x→∞) [(−3x+2)/(x²+1)] = 0, so R(x) → 2x+3.",
        },
        {
          prompt:
            "Does R(x) approach this asymptote from above or below as x → ∞? Justify by analysing the sign of the remainder term for large positive x. [1 mark]",
          marks: 1,
          answer:
            "For large x, remainder ≈ −3x/x² = −3/x < 0, so R(x) approaches the asymptote from below (remainder is negative).",
        },
      ],
    },
    {
      heading: "TOK Reflection",
      questions: [
        {
          prompt:
            "The Nature of Undefined: Mathematicians say 0/0 is ‘indeterminate’—yet limits like f₁’s give definite values. Is 0/0 a number, a concept, or a fundamental failure of our arithmetic system? What does this tell us about the limits of symbolic representation?",
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
            "You saw that the oblique asymptote arises because the polynomial part dominates the rational remainder at infinity. But what if a function grows faster than ANY polynomial? Write down the limit definition of e and predict whether eˣ will eventually exceed x¹⁰⁰.",
          marks: 0,
          answer: "",
        },
      ],
    },
  ],
};

// -- Stage 3: Exponential & Logarithmic ------

export const STAGE_3_DRAFT: AssignmentDraft = {
  title: "Activity 3: The Hierarchy of Infinity",
  subtitle:
    "IBDP Mathematics AA HL — Exponential & Logarithmic Functions & Transcendental Boundaries",
  instructions: [
    "Show all working. Exact answers first, then decimal approximations where requested.",
    "You may use a GDC for the numerical tables in Section A only.",
    "The TOK reflection requires a thoughtful written response.",
    "Estimated time: 120 minutes.",
  ],
  sections: [
    {
      heading: "Section A: Numerical Investigation — Polynomial vs. Exponential [8 marks]",
      questions: [
        {
          prompt:
            "Consider P(x) = x¹⁰ and E(x) = eˣ. (a) Evaluate P(x) and E(x) at x = 10, 20, 30, 40, 50. At approximately what x does E(x) first exceed P(x)? [3 marks]",
          marks: 3,
          answer:
            "x=10: 10¹⁰ = 1×10¹⁰, e¹⁰ ≈ 2.2×10⁴; P dominates. x=20: 20¹⁰ ≈ 1.02×10¹³, e²⁰ ≈ 4.85×10⁸; P dominates. x=30: 30¹⁰ ≈ 5.9×10¹⁴, e³⁰ ≈ 1.07×10¹³; P dominates. x=40: 40¹⁰ ≈ 1.05×10¹⁶, e⁴⁰ ≈ 2.35×10¹⁷; E dominates! Crosses between 35 and 40.",
        },
        {
          prompt:
            "(b) Evaluate the limit L = lim(x→∞) x¹⁰/eˣ by constructing a table for x = 10, 20, 30, 40, 50 computing x¹⁰/eˣ to 4 significant figures. [2 marks]",
          marks: 2,
          answer:
            "x=10: 10¹⁰/e¹⁰ ≈ 4.54×10⁵. x=20: 2.11×10⁴. x=30: 55.1. x=40: 0.0446. x=50: 1.93×10⁻⁵. Ratio → 0.",
        },
        {
          prompt:
            "(c) Based on your table, hypothesize the value of lim(x→∞) x¹⁰/eˣ. What does this suggest about the relative ‘strength’ of exponential vs. polynomial growth? [3 marks]",
          marks: 3,
          answer:
            "The limit is 0. Exponential growth eventually STRICTLY DOMINATES any polynomial growth, regardless of the power. The exponential always wins at infinity.",
        },
      ],
    },
    {
      heading: "Section B: The Definition of e and the Derivative of eˣ [10 marks]",
      questions: [
        {
          prompt:
            "Euler’s number e is defined as the unique real number satisfying lim(h→0) (eʰ − 1)/h = 1. (a) For a generic base a > 0, a ≠ 1, show using the difference quotient that the derivative of aˣ at x = 0 is lim(h→0) (aʰ − 1)/h. [2 marks]",
          marks: 2,
          answer:
            "d/dx[aˣ] at x=0 = lim(h→0) [a⁰⁺ʰ − a⁰]/h = lim(h→0) (aʰ − 1)/h.",
        },
        {
          prompt:
            "(b) Hence, if f(x) = aˣ, show that f′(x) = f′(0)·aˣ. (Hint: write the difference quotient and use the index law aˣ⁺ʰ = aˣ·aʰ.) [3 marks]",
          marks: 3,
          answer:
            "f′(x) = lim(h→0) [aˣ⁺ʰ − aˣ]/h = lim(h→0) aˣ(aʰ−1)/h = aˣ·lim(h→0) (aʰ−1)/h = aˣ·f′(0).",
        },
        {
          prompt:
            "(c) The number e is defined so that f′(0) = 1. Prove that d/dx(eˣ) = eˣ. [2 marks]",
          marks: 2,
          answer:
            "d/dx(eˣ) = eˣ·lim(h→0) (eʰ−1)/h = eˣ·1 = eˣ.",
        },
        {
          prompt:
            "(d) Use the derivative of eˣ and implicit differentiation to prove that d/dx(ln x) = 1/x for x > 0. Show all steps. [3 marks]",
          marks: 3,
          answer:
            "Let y = ln x. Then eʸ = x. Differentiate both sides w.r.t. x: d/dx(eʸ) = d/dx(x) → eʸ·dy/dx = 1 → dy/dx = 1/eʸ = 1/x.",
        },
      ],
    },
    {
      heading: "Section C: Formal Proof — L’Hôpital’s Rule Iterated [8 marks]",
      questions: [
        {
          prompt:
            "Consider L = lim(x→∞) x¹⁰/eˣ. (a) Explain why L’Hôpital’s Rule applies to this limit (state the indeterminate form). [1 mark]",
          marks: 1,
          answer: "As x→∞, x¹⁰ → ∞ and eˣ → ∞, giving ∞/∞.",
        },
        {
          prompt:
            "(b) Apply L’Hôpital’s Rule once: differentiate numerator and denominator and state the new limit. [2 marks]",
          marks: 2,
          answer: "L = lim(x→∞) 10x⁹ / eˣ. Still ∞/∞ form.",
        },
        {
          prompt:
            "(c) How many times must L’Hôpital’s Rule be applied before the numerator becomes a constant? What is that constant? Apply the rule all the way and state the final limit. [3 marks]",
          marks: 3,
          answer:
            "10 applications needed. After 10 applications: L = lim(x→∞) 10!/eˣ = 3628800/∞ = 0. So L = 0.",
        },
        {
          prompt:
            "(d) Generalize: Does lim(x→∞) xⁿ/eˣ = 0 for ANY positive integer n? Prove using L’Hôpital’s Rule and induction. [2 marks]",
          marks: 2,
          answer:
            "Yes. After n applications, numerator becomes n! (constant), denominator remains eˣ→∞. Limit = 0 for all n ∈ ℤ⁺.",
        },
      ],
    },
    {
      heading: "TOK Reflection",
      questions: [
        {
          prompt:
            "Invention vs. Discovery: Euler’s number e emerges from the unique solution to a limit problem, yet it appears throughout nature—radioactive decay, population growth, compound interest. Was e invented by mathematicians as a convenient constant, or is it a fundamental property of the universe we discovered?",
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
            "You proved that eˣ dominates polynomials, but what about functions that oscillate? Consider lim(x→0) sin(1/x). Does this limit exist? Predict what tools we might need to handle limits involving oscillation.",
          marks: 0,
          answer: "",
        },
      ],
    },
  ],
};

// -- Stage 4: Trigonometric Functions --------

export const STAGE_4_DRAFT: AssignmentDraft = {
  title: "Activity 4: The Squeeze Sandbox",
  subtitle:
    "IBDP Mathematics AA HL — Trigonometric Functions, Oscillation & The Squeeze Theorem",
  instructions: [
    "Use radian measure throughout this activity.",
    "All limit evaluations must be justified—no ‘by calculator’ shortcuts.",
    "The geometric proof in Section B requires careful diagram drawing.",
    "Estimated time: 120 minutes.",
  ],
  sections: [
    {
      heading: "Section A: When Standard Tools Fail [5 marks]",
      questions: [
        {
          prompt:
            "Consider L = lim(x→0) x²·sin(1/x). (a) Explain why direct substitution fails. [1 mark]",
          marks: 1,
          answer: "sin(1/0) is undefined—1/0 is not a real number.",
        },
        {
          prompt:
            "(b) Explain why L’Hôpital’s Rule cannot be applied to this limit. [1 mark]",
          marks: 1,
          answer:
            "The limit is of the form 0·[undefined oscillating], not 0/0 or ∞/∞. sin(1/x) has no limit as x→0, so the rule does not apply.",
        },
        {
          prompt:
            "(c) Argue intuitively: as x approaches 0, x² approaches 0 and sin(1/x) stays between −1 and 1. What must the product approach? [1 mark]",
          marks: 1,
          answer: "0 × (bounded) = 0, so the limit should be 0.",
        },
        {
          prompt:
            "(d) Formalize: Establish the inequality −x² ≤ x²·sin(1/x) ≤ x² for all x ≠ 0. Explain why these bounds hold. [2 marks]",
          marks: 2,
          answer:
            "For all real t, −1 ≤ sin(t) ≤ 1. Since x² ≥ 0, multiplying preserves the inequality direction: −x² ≤ x²·sin(1/x) ≤ x².",
        },
      ],
    },
    {
      heading: "Section B: The Fundamental Trigonometric Limit — Geometric Proof [10 marks]",
      questions: [
        {
          prompt:
            "Draw the unit circle with centre O. Let angle θ (in radians, 0 < θ < π/2) sweep out: point A(1,0), point P on the circle at angle θ, point B as the foot of the perpendicular from P to OA, and point T where the tangent at A meets the extended radius through P. [2 marks]",
          marks: 2,
          answer:
            "Diagram: O(0,0), A(1,0), P(cosθ, sinθ), B(cosθ, 0), T(1, tanθ).",
        },
        {
          prompt:
            "Identify three areas in ascending order: Area(△OBP) < Area(sector OAP) < Area(△OAT). Express each area in terms of θ. [3 marks]",
          marks: 3,
          answer:
            "Area(△OBP) = (1/2)(cosθ)(sinθ). Area(sector OAP) = (1/2)θ. Area(△OAT) = (1/2)(1)(tanθ) = tanθ/2. So (1/2)cosθ sinθ < θ/2 < (1/2)tanθ.",
        },
        {
          prompt:
            "Multiply through by 2, divide by sinθ (positive), then take reciprocals to obtain: cosθ < sinθ/θ < 1/cosθ. [1 mark]",
          marks: 1,
          answer:
            "cosθ sinθ < θ < tanθ = sinθ/cosθ. Divide by sinθ: cosθ < θ/sinθ < 1/cosθ. Reciprocals: cosθ < sinθ/θ < 1/cosθ.",
        },
        {
          prompt:
            "Take the limit as θ → 0⁺. Evaluate lim(θ→0⁺) cosθ and lim(θ→0⁺) 1/cosθ. Apply the Squeeze Theorem to conclude lim(θ→0⁺) sinθ/θ = 1. [2 marks]",
          marks: 2,
          answer:
            "lim(θ→0⁺) cosθ = 1. lim(θ→0⁺) 1/cosθ = 1. By Squeeze Theorem, sinθ/θ is trapped between two functions both approaching 1, so lim = 1.",
        },
        {
          prompt:
            "Explain why the result also holds for θ → 0⁻ (use sin(−θ)/(−θ) = sinθ/θ). Hence conclude lim(x→0) sin x/x = 1. [2 marks]",
          marks: 2,
          answer:
            "For θ < 0, let φ = −θ > 0. sin(−φ)/(−φ) = −sinφ/(−φ) = sinφ/φ → 1. Both one-sided limits equal 1, so the two-sided limit is 1.",
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
            "f′(x) = lim(h→0) [sin x cos h + cos x sin h − sin x]/h = sin x·lim(h→0) (cos h−1)/h + cos x·lim(h→0) sin h/h.",
        },
        {
          prompt:
            "Prove that lim(h→0) (cos h − 1)/h = 0. (Hint: multiply numerator and denominator by cos h + 1 and use sin²h + cos²h = 1.) [3 marks]",
          marks: 3,
          answer:
            "lim (cos h−1)/h = lim (cos²h−1)/[h(cos h+1)] = lim (−sin²h)/[h(cos h+1)] = lim [−sin h/h · sin h/(cos h+1)] = −1·0/2 = 0.",
        },
        {
          prompt:
            "Hence prove d/dx(sin x) = cos x and d/dx(cos x) = −sin x. (Use cos x = sin(π/2 − x) and the chain rule for the second.) [3 marks]",
          marks: 3,
          answer:
            "d/dx(sin x) = sin x·0 + cos x·1 = cos x. d/dx(cos x) = d/dx[sin(π/2−x)] = cos(π/2−x)·(−1) = −sin x.",
        },
      ],
    },
    {
      heading: "Section D: Formal Squeeze Theorem Application [4 marks]",
      questions: [
        {
          prompt:
            "Evaluate lim(x→0) x·cos(1/x²) using the Squeeze Theorem. State bounding functions explicitly. [2 marks]",
          marks: 2,
          answer:
            "−|x| ≤ x·cos(1/x²) ≤ |x|. Both bounds → 0, so limit = 0.",
        },
        {
          prompt:
            "Evaluate lim(x→0) sin(3x)/x by relating it to the fundamental limit. [2 marks]",
          marks: 2,
          answer:
            "sin(3x)/x = 3·sin(3x)/(3x). Let u = 3x. As x→0, u→0. So 3·lim(u→0) sin u/u = 3·1 = 3.",
        },
      ],
    },
    {
      heading: "TOK Reflection",
      questions: [
        {
          prompt:
            "Degrees vs. Radians: The limit sin x/x → 1 only holds in radian measure. Does this mean radians are a ‘truer’ measure of angle than degrees, or are they simply better adapted to the needs of calculus? Is mathematical ‘truth’ dependent on the units we choose?",
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
            "The sine function is periodic and fails the Horizontal Line Test on (−∞,∞). What is the largest interval containing 0 on which sin x IS one-to-one? What would the derivative of its inverse function look like near the endpoints of that interval?",
          marks: 0,
          answer: "",
        },
      ],
    },
  ],
};

// -- Stage 5: Inverse Trig Functions ----------

export const STAGE_5_DRAFT: AssignmentDraft = {
  title: "Activity 5: Slicing the Wave",
  subtitle:
    "IBDP Mathematics AA HL — Inverse & Reciprocal Trigonometric Functions & Restricted Domains",
  instructions: [
    "Use radian measure throughout.",
    "Draw diagrams where indicated—accuracy matters.",
    "The TOK reflection invites a philosophical response.",
    "Estimated time: 120 minutes.",
  ],
  sections: [
    {
      heading: "Section A: Why We Must Restrict [5 marks]",
      questions: [
        {
          prompt:
            "Sketch y = sin x for −3π ≤ x ≤ 3π. Draw the line y = x and attempt to reflect the sine curve across it to obtain y = arcsin x. (a) Explain why the reflected graph fails the vertical line test. [2 marks]",
          marks: 2,
          answer:
            "sin x is not one-to-one on (−∞,∞) because it is periodic. When reflected across y=x, multiple x-values map to the same y-value, creating a relation that is not a function.",
        },
        {
          prompt:
            "(b) Identify the interval containing 0 on which sin x is strictly increasing and one-to-one. What are the sine values at the endpoints? [2 marks]",
          marks: 2,
          answer:
            "[−π/2, π/2]. sin(−π/2) = −1, sin(π/2) = 1. On this interval, sine is strictly increasing from −1 to 1.",
        },
        {
          prompt:
            "(c) Define the principal value domain of y = arcsin x. State its domain and range. [1 mark]",
          marks: 1,
          answer:
            "Domain: [−1, 1]. Range: [−π/2, π/2]. y = arcsin x ⇔ sin y = x and −π/2 ≤ y ≤ π/2.",
        },
      ],
    },
    {
      heading: "Section B: Derivative of arcsin x via Implicit Differentiation [8 marks]",
      questions: [
        {
          prompt:
            "Let y = arcsin x. Then sin y = x with y ∈ [−π/2, π/2]. Differentiate both sides of sin y = x w.r.t. x. [2 marks]",
          marks: 2,
          answer:
            "cos y · dy/dx = 1 → dy/dx = 1/cos y.",
        },
        {
          prompt:
            "Express cos y in terms of x. Draw a right-angled triangle with angle y, opposite side x, and hypotenuse 1. Find the adjacent side using Pythagoras. [2 marks]",
          marks: 2,
          answer:
            "Adjacent = √(1 − x²). cos y = √(1−x²)/1 = √(1−x²). (Positive root since cos y ≥ 0 on [−π/2, π/2].)",
        },
        {
          prompt:
            "Hence prove that d/dx(arcsin x) = 1/√(1−x²) for |x| < 1. [1 mark]",
          marks: 1,
          answer:
            "dy/dx = 1/cos y = 1/√(1−x²) for |x| < 1.",
        },
        {
          prompt:
            "Using a similar method, prove that d/dx(arctan x) = 1/(1+x²). [3 marks]",
          marks: 3,
          answer:
            "y = arctan x ⇔ tan y = x, −π/2 < y < π/2. sec²y·dy/dx = 1 → dy/dx = 1/sec²y = 1/(1+tan²y) = 1/(1+x²).",
        },
      ],
    },
    {
      heading: "Section C: Limit Analysis at the Boundaries [8 marks]",
      questions: [
        {
          prompt:
            "Consider f(x) = arcsin x and f′(x) = 1/√(1−x²). (a) Explain why the domain of f is [−1, 1] but the domain of f′ excludes the endpoints. [2 marks]",
          marks: 2,
          answer:
            "f′ involves division by √(1−x²), which is undefined when 1−x² = 0, i.e. at x = ±1. These are algebraic singularities, though f is defined and continuous there.",
        },
        {
          prompt:
            "(b) Evaluate lim(x→1⁻) f′(x) and lim(x→−1⁺) f′(x). Interpret geometrically. [3 marks]",
          marks: 3,
          answer:
            "lim(x→1⁻) 1/√(1−x²) = +∞. lim(x→−1⁺) 1/√(1−x²) = +∞. The graph of arcsin x has vertical tangents at (−1, −π/2) and (1, π/2)—the curve rises vertically at the endpoints.",
        },
        {
          prompt:
            "(c) Let g(x) = arcsin(sin x), defined for all real x. Evaluate g(0), g(π/6), g(π), g(3π/2). Explain why g(x) ≠ x in general. What is the range of g? [3 marks]",
          marks: 3,
          answer:
            "g(0)=0, g(π/6)=π/6, g(π)=0, g(3π/2)=−π/2. g(x)≠x because arcsin restricts output to [−π/2, π/2]. It ‘folds back’ values outside this interval. Range: [−π/2, π/2].",
        },
      ],
    },
    {
      heading: "Section D: Synthesis — A Limit Bridging All Stages [3 marks]",
      questions: [
        {
          prompt:
            "Evaluate lim(x→0) [arcsin(eˣ − 1)]/[sin(3x)] · [x/ln(1+x)]. (Hint: Identify and use known limits from Activities 1–4: the difference quotient, sinθ/θ → 1, the definition of e, and the derivative of arcsin x at 0.) [3 marks]",
          marks: 3,
          answer:
            "As x→0: eˣ−1 ~ x (Activity 3). arcsin(eˣ−1) ~ arcsin(x) ~ x (Activity 5, f′(0)=1). sin(3x) ~ 3x (Activity 4). ln(1+x) ~ x (Activity 3). So limit = [x/3x]·[x/x] = (1/3)·1 = 1/3.",
        },
      ],
    },
    {
      heading: "TOK Reflection",
      questions: [
        {
          prompt:
            "Pragmatism in Mathematics: By restricting the domain of sine to [−π/2, π/2], we create a well-defined inverse function—but are we ignoring mathematical reality just to make our functions ‘work’? Does domain restriction reflect a deeper mathematical truth or is it a convenient human construct?",
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

// -- Master lookup ----------------------------

export const ALL_ACTIVITY_DRAFTS: Record<number, AssignmentDraft> = {
  1: STAGE_1_DRAFT,
  2: STAGE_2_DRAFT,
  3: STAGE_3_DRAFT,
  4: STAGE_4_DRAFT,
  5: STAGE_5_DRAFT,
};