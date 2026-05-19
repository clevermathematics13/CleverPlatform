import type { AssignmentDraft } from "@/lib/assignments";

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
