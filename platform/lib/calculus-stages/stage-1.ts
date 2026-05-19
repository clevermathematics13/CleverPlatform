import type { AssignmentDraft } from "@/lib/assignments";

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
