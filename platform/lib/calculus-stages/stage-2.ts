import type { AssignmentDraft } from "@/lib/assignments";

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
