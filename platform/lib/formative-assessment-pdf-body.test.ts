import { describe, it, expect } from "vitest";
import {
  DEFAULT_ASSESSMENT_FORMATTING,
  buildFormativeAssessmentPdfBody,
  assessmentPdfStoragePath,
  assessmentPdfFilename,
} from "./formative-assessment-pdf-body";
import { FormattingRequirementsSchema } from "./template-schema";
import type { AssignmentDraft } from "./assignments";

const draft: AssignmentDraft = {
  title: "Formative Assessment 1",
  subtitle: "Grade 9 Mathematics -- Extended",
  instructions: ["Answer every part."],
  sections: [
    {
      heading: "LEVEL 1 -- READ THE STRUCTURE",
      questions: [
        { prompt: "Write down the coefficient of x in 3x + 7.", marks: 1, answer: "3", markScheme: "A1" },
      ],
    },
  ],
  markingPrinciples: ["Accept equivalent correct forms."],
  reteachGuide: [{ questions: "1", topic: "Coefficients" }],
  showSectionScoreSummary: true,
};

describe("DEFAULT_ASSESSMENT_FORMATTING", () => {
  it("satisfies the schema the PDF renderers validate against", () => {
    // The sandbox previews with this object and the save route renders the
    // archived copy with it. If it ever stops parsing, every archive fails at
    // render time rather than here.
    const parsed = FormattingRequirementsSchema.safeParse(DEFAULT_ASSESSMENT_FORMATTING);
    expect(parsed.success).toBe(true);
  });
});

describe("buildFormativeAssessmentPdfBody", () => {
  it("carries the draft's content through unchanged", () => {
    const body = buildFormativeAssessmentPdfBody(draft, DEFAULT_ASSESSMENT_FORMATTING, false);
    expect(body.title).toBe("Formative Assessment 1");
    expect(body.sections).toBe(draft.sections);
    expect(body.instructions).toBe(draft.instructions);
    expect(body.markingPrinciples).toEqual(["Accept equivalent correct forms."]);
    expect(body.reteachGuide).toEqual([{ questions: "1", topic: "Coefficients" }]);
    expect(body.showSectionScoreSummary).toBe(true);
    expect(body.formatting).toBe(DEFAULT_ASSESSMENT_FORMATTING);
  });

  it("marks the mark-scheme subtitle and leaves the student one alone", () => {
    expect(buildFormativeAssessmentPdfBody(draft, DEFAULT_ASSESSMENT_FORMATTING, false).subtitle).toBe(
      "Grade 9 Mathematics -- Extended",
    );
    expect(buildFormativeAssessmentPdfBody(draft, DEFAULT_ASSESSMENT_FORMATTING, true).subtitle).toBe(
      "Grade 9 Mathematics -- Extended -- MARK SCHEME",
    );
  });

  it("differs between the two kinds ONLY in the subtitle", () => {
    // The renderer, not a flag on the body, is what makes a mark scheme a mark
    // scheme. Sending the mark-scheme body to the student renderer produced a
    // convincing paper with no mark scheme in it at all, which is the reason
    // this is pinned by a test.
    const paper = buildFormativeAssessmentPdfBody(draft, DEFAULT_ASSESSMENT_FORMATTING, false);
    const ms = buildFormativeAssessmentPdfBody(draft, DEFAULT_ASSESSMENT_FORMATTING, true);
    const differing = (Object.keys(paper) as Array<keyof typeof paper>).filter(
      (k) => paper[k] !== ms[k],
    );
    expect(differing).toEqual(["subtitle"]);
  });
});

describe("assessmentPdfStoragePath", () => {
  it("namespaces by test id so re-saving overwrites rather than accumulates", () => {
    const id = "f5221cd9-66b1-48cd-bfe3-652d87df26b2";
    expect(assessmentPdfStoragePath(id, "paper")).toBe(`formative-assessments/${id}/paper.pdf`);
    expect(assessmentPdfStoragePath(id, "mark-scheme")).toBe(
      `formative-assessments/${id}/mark-scheme.pdf`,
    );
  });
});

describe("assessmentPdfFilename", () => {
  it("matches what the sandbox's own download buttons produce", () => {
    expect(assessmentPdfFilename("Formative Assessment 1", "paper")).toBe("Formative_Assessment_1.pdf");
    expect(assessmentPdfFilename("Formative Assessment 1", "mark-scheme")).toBe(
      "Formative_Assessment_1_mark_scheme.pdf",
    );
  });

  it("never produces a nameless file", () => {
    expect(assessmentPdfFilename("!!!", "paper")).toBe("assessment.pdf");
    expect(assessmentPdfFilename("", "paper")).toBe("assessment.pdf");
    expect(assessmentPdfFilename("   ", "mark-scheme")).toBe("assessment_mark_scheme.pdf");
  });
});
