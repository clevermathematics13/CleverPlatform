import { describe, it, expect } from "vitest";
import { initialReflectionStep, isSelfGradeSkipped } from "./reflection-steps";

const base = {
  hasUpload: false,
  hasSelfScores: false,
  hasTeacherMarks: false,
  disagreement: 0,
  selfAssessmentRequired: true,
};

describe("initialReflectionStep", () => {
  describe("when the test requires self-assessment (the default)", () => {
    it("opens on Self-Grade before anything has been done", () => {
      expect(initialReflectionStep(base)).toBe(1);
    });

    it("still opens on Self-Grade even once the teacher has marked", () => {
      expect(initialReflectionStep({ ...base, hasTeacherMarks: true })).toBe(1);
    });
  });

  // Formative Assessment 1 (course 9G) is the live case: the teacher turned
  // the gate off, but the flow still opened on Self-Grade, putting the step
  // back in front of the feedback it was switched off to reveal.
  describe("when the test does not require self-assessment", () => {
    const open = { ...base, selfAssessmentRequired: false };

    it("skips Self-Grade and opens on Compare, where Clev's Marks are", () => {
      expect(initialReflectionStep(open)).toBe(2);
    });

    it("opens on Compare whether or not the teacher has marked yet", () => {
      expect(initialReflectionStep({ ...open, hasTeacherMarks: true })).toBe(2);
    });

    it("does not skip past Compare just because there is no disagreement to show", () => {
      expect(initialReflectionStep({ ...open, hasTeacherMarks: true, disagreement: 0 })).toBe(2);
    });
  });

  describe("once the student has self-graded, the gate setting stops mattering", () => {
    for (const selfAssessmentRequired of [true, false]) {
      const label = selfAssessmentRequired ? "required" : "optional";

      it(`opens on Compare when marks are still disagreeing (${label})`, () => {
        expect(
          initialReflectionStep({
            ...base,
            selfAssessmentRequired,
            hasSelfScores: true,
            hasTeacherMarks: true,
            disagreement: 3,
          })
        ).toBe(2);
      });

      it(`opens on Upload Corrections once disagreement reaches 0 (${label})`, () => {
        expect(
          initialReflectionStep({
            ...base,
            selfAssessmentRequired,
            hasSelfScores: true,
            hasTeacherMarks: true,
            disagreement: 0,
          })
        ).toBe(3);
      });

      it(`stays on Compare while the teacher has not marked yet (${label})`, () => {
        expect(
          initialReflectionStep({ ...base, selfAssessmentRequired, hasSelfScores: true })
        ).toBe(2);
      });
    }
  });

  it("an existing upload wins over every other state", () => {
    for (const selfAssessmentRequired of [true, false]) {
      expect(
        initialReflectionStep({
          ...base,
          selfAssessmentRequired,
          hasUpload: true,
          hasSelfScores: false,
          hasTeacherMarks: true,
          disagreement: 5,
        })
      ).toBe(4);
    }
  });

  // computeDisagreement returns null when there is nothing to compare yet.
  // Only an exact 0 opens Upload Corrections, so null must behave as "still
  // disagreeing" -- exactly what `disagreement === 0` did before this was
  // extracted out of the component.
  it("treats a null disagreement as not-yet-agreed, never as zero", () => {
    expect(
      initialReflectionStep({
        ...base,
        hasSelfScores: true,
        hasTeacherMarks: true,
        disagreement: null,
      })
    ).toBe(2);
  });

  it("never returns a step outside the flow", () => {
    for (const hasUpload of [true, false])
      for (const hasSelfScores of [true, false])
        for (const hasTeacherMarks of [true, false])
          for (const disagreement of [0, 4, null])
            for (const selfAssessmentRequired of [true, false])
              expect([1, 2, 3, 4]).toContain(
                initialReflectionStep({
                  hasUpload,
                  hasSelfScores,
                  hasTeacherMarks,
                  disagreement,
                  selfAssessmentRequired,
                })
              );
  });
});

describe("isSelfGradeSkipped", () => {
  it("is true only when the step was optional and genuinely not done", () => {
    expect(isSelfGradeSkipped({ hasSelfScores: false, selfAssessmentRequired: false })).toBe(true);
  });

  it("is false once the student self-grades anyway", () => {
    expect(isSelfGradeSkipped({ hasSelfScores: true, selfAssessmentRequired: false })).toBe(false);
  });

  it("is false when the step was required, so it is never shown as skipped", () => {
    expect(isSelfGradeSkipped({ hasSelfScores: false, selfAssessmentRequired: true })).toBe(false);
    expect(isSelfGradeSkipped({ hasSelfScores: true, selfAssessmentRequired: true })).toBe(false);
  });
});
