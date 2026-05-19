import type { AssignmentDraft } from "@/lib/assignments";

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
