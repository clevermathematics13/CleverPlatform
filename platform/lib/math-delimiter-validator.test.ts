/**
 * math-delimiter-validator.test.ts
 * -----------------------------------------------------------------------------
 * Regression test for validateDraftMathDelimiters().
 *
 * The defect: rule 11b told the model to write equations as $...$ but never
 * said where the rule applied, while 11c and 11d both spelled that out. The
 * model read it as a rule about questions. A printed A.3 packet came back
 * with its Syllabus Topics line reading "ax^2+bx+c", its Prerequisites line
 * reading "a div b := a times 1/b", and six prerequisite bullets carrying
 * bare "a(b+c)=ab+ac" -- correct Typst math with nothing to typeset it.
 *
 * The strings below are that packet's, verbatim. The clean cases are its
 * prose, also verbatim, and they matter as much: a warning that fires on
 * ordinary sentences is one the teacher learns to ignore.
 * -----------------------------------------------------------------------------
 */

import { describe, it, expect } from "vitest";
import { validateDraftMathDelimiters } from "./math-delimiter-validator";
import type { AssignmentDraft } from "./assignments";

/** A minimal clean draft, so each case varies exactly one field. */
function draftWith(extra: Record<string, unknown>): AssignmentDraft {
  return {
    title: "Three Faces of a Quadratic",
    subtitle: "Nuanced Analysis Packet A.3",
    instructions: ["Complete all questions."],
    sections: [
      {
        heading: "Part 0 - Activating Prior Knowledge",
        questions: [{ prompt: "State the coefficient of $x$.", marks: 1 }],
      },
    ],
    ...extra,
  } as unknown as AssignmentDraft;
}

const issuesFor = (extra: Record<string, unknown>) =>
  validateDraftMathDelimiters(draftWith(extra));

describe("un-delimited math in header fields", () => {
  it.each([
    [
      "syllabusTopics",
      "Recognizing quadratic expressions ax^2+bx+c (a not equal 0) and distinguishing them from linear expressions",
      "Syllabus topics",
    ],
    [
      "prerequisites",
      "The distributive property a(b+c)=ab+ac and its area-model justification; the formal definitions a-b := a+(-b) and a div b := a times 1/b",
      "Prerequisites",
    ],
    ["compulsoryCore", "All Tier 1 questions where a = 1 form the compulsory core.", "Compulsory core"],
  ])("flags %s", (field, value, location) => {
    const issues = issuesFor({ [field]: value });
    expect(issues).toHaveLength(1);
    expect(issues[0].location).toBe(location);
    expect(issues[0].excerpt.length).toBeGreaterThan(0);
  });

  it("names the notation it found, so the teacher can see what to wrap", () => {
    const [caret] = issuesFor({ syllabusTopics: "the standard form ax^2+bx+c" });
    expect(caret.kind).toBe("unwrapped-notation");
    expect(caret.detail).toContain("caret");

    const [define] = issuesFor({ prerequisites: "the definition a - b := a + (-b)" });
    expect(define.kind).toBe("unwrapped-notation");
    expect(define.detail).toContain(":=");

    const [divide] = issuesFor({ prerequisites: "rewrite a div b as a multiplication" });
    expect(divide.kind).toBe("unwrapped-notation");
    expect(divide.detail).toContain("div");

    const [equation] = issuesFor({ materials: "a graph of h(t) = -5t + 1" });
    expect(equation.kind).toBe("unwrapped-equation");
  });

  it("reports a field once, however much bare math it carries", () => {
    // Prerequisites carried four separate expressions. Six identical lines
    // about one field is a warning nobody reads to the end of.
    const issues = issuesFor({
      prerequisites:
        "The property a(b+c)=ab+ac, the definitions a-b := a+(-b) and a div b := a times 1/b, and the form ax^2+bx+c",
    });
    expect(issues).toHaveLength(1);
  });
});

describe("un-delimited math in the Part callouts", () => {
  it("flags a prerequisite bullet", () => {
    const issues = issuesFor({
      sections: [
        {
          heading: "Part 4 - Factoring Quadratics",
          prerequisiteBox: {
            items: [
              "Expansion result from Part 3: (x+p)(x+q) = x^2+(p+q)x+pq",
              "Vocabulary from A.1/A.2: term, coefficient, constant, factor",
            ],
          },
          questions: [{ prompt: "Factor $x^2+7x+12$ fully.", marks: 4 }],
        },
      ],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].location).toBe("Part 4 - Factoring Quadratics, bullet 1");
  });

  it.each([
    [
      "a spotlight body",
      { spotlight: { title: "Recall", body: "the distributive property a(b+c) = ab + ac, justified in A.1" } },
      "spotlight",
    ],
    [
      "a geometric reading",
      { geometricReading: { body: "the curve touches the axis once, if p=q" } },
      "geometric reading",
    ],
  ])("flags %s", (_label, extra, suffix) => {
    const issues = issuesFor({
      sections: [
        { heading: "Part 5", questions: [{ prompt: "State the vertex form.", marks: 1 }], ...extra },
      ],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].location).toContain(suffix);
  });

  it("flags a TOK provocation", () => {
    const issues = issuesFor({
      tokProvocations: [
        { id: "tok1", body: "The same quadratic can be written as x^2-5x+6, or as (x-2)(x-3)." },
      ],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].location).toBe("TOK provocation 1");
  });

  it("flags a question prompt and a hint on the same footing", () => {
    const issues = issuesFor({
      sections: [
        {
          heading: "Part 3",
          questions: [
            { prompt: "Expand (x+3)(x+5) fully.", marks: 6, hint: "(x+3)(x+5) = x(x+5) + 3(x+5)." },
          ],
        },
      ],
    });
    expect(issues.map((i) => i.location)).toEqual(["Part 3, Q1", "Part 3, Q1 hint"]);
  });
});

describe("what the validator must stay quiet about", () => {
  // Every string here is packet prose that is doing nothing wrong.
  it.each([
    ["materials", "Pencil, ruler, graph paper (optional, for sketching parabolas), GDC or calculator."],
    ["atl", "You will build representational fluency: seeing one relationship as a proof and as a curve."],
    ["prerequisites", "Vocabulary: variable, constant, term, factor, coefficient, expression, equation."],
    ["compulsoryCore", "All Tier 1 questions in Parts 0 to 5 form the compulsory core."],
    ["syllabusTopics", "Expanding and factoring expressions; connecting standard and vertex forms."],
    ["plantedErrorIntro", "One question below contains a deliberate error for you to find."],
  ])("leaves ordinary prose alone: %s", (field, value) => {
    expect(issuesFor({ [field]: value })).toEqual([]);
  });

  it.each([
    ["a cross-reference", "Numerical checking of equivalence from A.2"],
    ["a part range", "Factored form and its link to standard form (Parts 3-4)"],
    ["a syllabus code", "Topic 2.6 - the quadratic function and its graph"],
    ["div inside a longer word", "Divide both sides, then check each individual dividend."],
    ["capital pairs inside longer words", "The ANNUAL SUCCESS rate of this ACCESS method."],
    ["a command-term gloss", "Obtain the only possible answer, showing relevant working."],
  ])("does not mistake %s for mathematics", (_label, value) => {
    expect(issuesFor({ prerequisites: value })).toEqual([]);
  });

  it("ignores math that is already delimited", () => {
    const issues = issuesFor({
      syllabusTopics: "Recognizing quadratic expressions $a x^2 + b x + c$ where $a eq.not 0$",
      prerequisites: "The definitions $a - b := a + (-b)$ and $a div b := a times 1/b$",
    });
    expect(issues).toEqual([]);
  });

  it("does not fire on a currency amount, which is rule 11d's problem", () => {
    // Two prices pair up into a $...$ span, so the text between them is not
    // what this validator is looking at. It must not report the halves either.
    expect(issuesFor({ materials: "tickets cost 5 dollars and 10 dollars today." })).toEqual([]);
    expect(issuesFor({ materials: "tickets cost $5 and $10 today." })).toEqual([]);
  });

  it("survives a draft with none of these fields", () => {
    expect(validateDraftMathDelimiters({ sections: [] } as unknown as AssignmentDraft)).toEqual([]);
    expect(validateDraftMathDelimiters(undefined as unknown as AssignmentDraft)).toEqual([]);
  });
});
