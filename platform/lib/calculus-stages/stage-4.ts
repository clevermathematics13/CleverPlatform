import type { AssignmentDraft } from "@/lib/assignments";

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
