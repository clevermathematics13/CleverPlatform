import { describe, it, expect } from "vitest";
import {
  parseAssessmentKind,
  applyKindFormatting,
  applyKindRules,
  countHints,
  resolveRequireSelfAssessment,
  SUMMATIVE_FORMATTING_DEFAULTS,
} from "./assessment-kind";
import { DEFAULT_ASSESSMENT_FORMATTING } from "./formative-assessment-pdf-body";
import type { AssignmentDraft } from "./assignments";

const draftWithHints: AssignmentDraft = {
  title: "Summative Assessment 1",
  subtitle: "Grade 9 Mathematics -- Extended",
  instructions: ["Answer every part."],
  sections: [
    {
      heading: "LEVEL 1 -- READ THE STRUCTURE",
      questions: [
        {
          prompt: "Solve 5(x + 2) - 4 = 3x + 18.",
          marks: 3,
          answer: "x = 6",
          hint: "Expand the bracket first.",
          markScheme: "M1 expansion; M1 collection; A1 x = 6",
          subparts: [
            { prompt: "State the coefficient of x.", marks: 1, answer: "5", hint: "Look before the x." },
            { prompt: "Hence check your answer.", marks: 1, answer: "LHS = RHS = 36" },
          ],
        },
        { prompt: "Write down the constant term.", marks: 1, answer: "7" },
      ],
    },
  ],
};

describe("parseAssessmentKind", () => {
  it("only 'summative' means summative", () => {
    expect(parseAssessmentKind("summative")).toBe("summative");
  });

  it("anything else is formative, including nonsense", () => {
    // Fails towards the kind with no extra promises attached to it: a paper
    // wrongly treated as summative would hold marks nobody was waiting on.
    for (const value of ["formative", "Summative", "", null, undefined, 1, {}]) {
      expect(parseAssessmentKind(value)).toBe("formative");
    }
  });
});

describe("applyKindFormatting", () => {
  it("puts the exam conditions on a summative cover", () => {
    const out = applyKindFormatting("summative", DEFAULT_ASSESSMENT_FORMATTING);
    expect(out.calculatorPolicy).toBe(SUMMATIVE_FORMATTING_DEFAULTS.calculatorPolicy);
    expect(out.timeAllowedMinutes).toBe(SUMMATIVE_FORMATTING_DEFAULTS.timeAllowedMinutes);
    expect(out.showTotalMarks).toBe(true);
    expect(out.academicHonestyLine).toContain("Academic honesty");
  });

  it("clears them again when the paper goes back to formative", () => {
    // A calculator rule printed on a paper nobody is invigilating is a rule
    // nobody is enforcing, and that is how the line stops being read.
    const summative = applyKindFormatting("summative", DEFAULT_ASSESSMENT_FORMATTING);
    const back = applyKindFormatting("formative", summative);
    expect(back.calculatorPolicy).toBeUndefined();
    expect(back.timeAllowedMinutes).toBeUndefined();
    expect(back.showTotalMarks).toBeUndefined();
    expect(back.academicHonestyLine).toBeUndefined();
  });

  it("leaves every other layout setting exactly as it was", () => {
    const edited = { ...DEFAULT_ASSESSMENT_FORMATTING, fontSize: 12 as const, answerBoxLines: 7 };
    const out = applyKindFormatting("summative", edited);
    expect(out.fontSize).toBe(12);
    expect(out.answerBoxLines).toBe(7);
    expect(out.schoolName).toBe(edited.schoolName);
  });
});

describe("countHints", () => {
  it("counts questions and subparts alike", () => {
    expect(countHints(draftWithHints)).toBe(2);
  });

  it("is zero for a draft with none", () => {
    expect(countHints(applyKindRules("summative", draftWithHints))).toBe(0);
  });
});

describe("applyKindRules", () => {
  it("strips every hint from a summative", () => {
    const out = applyKindRules("summative", draftWithHints);
    const q = out.sections[0].questions[0];
    expect(q.hint).toBeUndefined();
    expect(q.subparts?.[0].hint).toBeUndefined();
  });

  it("keeps everything else about the question", () => {
    // The failure mode worth guarding: a strip that quietly took the mark
    // scheme or the subparts with it would not be visible until marking.
    const q = applyKindRules("summative", draftWithHints).sections[0].questions[0];
    expect(q.prompt).toBe("Solve 5(x + 2) - 4 = 3x + 18.");
    expect(q.marks).toBe(3);
    expect(q.answer).toBe("x = 6");
    expect(q.markScheme).toBe("M1 expansion; M1 collection; A1 x = 6");
    expect(q.subparts).toHaveLength(2);
    expect(q.subparts?.[1].answer).toBe("LHS = RHS = 36");
  });

  it("leaves a question with no subparts without a subparts key", () => {
    const q = applyKindRules("summative", draftWithHints).sections[0].questions[1];
    expect("subparts" in q).toBe(false);
  });

  it("does not touch a formative", () => {
    expect(applyKindRules("formative", draftWithHints)).toBe(draftWithHints);
  });
});

describe("resolveRequireSelfAssessment", () => {
  it("is forced on for a summative, whatever was asked for", () => {
    // The teacher's requirement: students self-assess BEFORE seeing the marks
    // the teacher approved from AI grading. A toggle is a thing to forget.
    expect(resolveRequireSelfAssessment("summative", false)).toBe(true);
    expect(resolveRequireSelfAssessment("summative", true)).toBe(true);
  });

  it("stays a choice on a formative", () => {
    expect(resolveRequireSelfAssessment("formative", false)).toBe(false);
    expect(resolveRequireSelfAssessment("formative", true)).toBe(true);
  });
});
