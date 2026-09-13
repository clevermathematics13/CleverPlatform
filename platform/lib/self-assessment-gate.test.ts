import { describe, expect, it } from "vitest";
import { resolveSelfAssessmentRequired } from "./self-assessment-gate";

/**
 * The gate that decides whether a student sees Clev's Marks before they have
 * self-graded, once a class can carry its own answer.
 *
 * The case this exists for: Formative Assessment 1 hangs off 9G and is sat by
 * 9A, 9C, 9D and 9G, so tests.require_self_assessment could only be switched
 * off for all four at once -- about 69 students -- when the teacher wanted to
 * release one class of 20.
 *
 * Two properties matter more than the rest, and both are asymmetric on
 * purpose: a test nobody has overridden must behave exactly as it did before
 * the table existed, and where overrides disagree the gate stays up. Showing
 * a student marks their teacher had not released cannot be undone once they
 * have read them; withholding marks that should have been released is a
 * complaint.
 */
describe("resolveSelfAssessmentRequired", () => {
  it("falls back to the test's own flag when no class has an override", () => {
    expect(resolveSelfAssessmentRequired(true, [])).toBe(true);
    expect(resolveSelfAssessmentRequired(false, [])).toBe(false);
  });

  it("releases one class without touching the test's flag", () => {
    expect(resolveSelfAssessmentRequired(true, [false])).toBe(false);
  });

  it("re-imposes the gate on one class where the test has it switched off", () => {
    expect(resolveSelfAssessmentRequired(false, [true])).toBe(true);
  });

  // Not a shape this app has today -- one student, one class -- but the
  // tie-break is the difference between a complaint and marks a student
  // should never have seen, so it is pinned rather than left to chance.
  it("keeps the gate up when overrides disagree, whichever way the test is set", () => {
    expect(resolveSelfAssessmentRequired(false, [false, true])).toBe(true);
    expect(resolveSelfAssessmentRequired(false, [true, false])).toBe(true);
    expect(resolveSelfAssessmentRequired(true, [false, true])).toBe(true);
  });

  it("releases only when every override agrees", () => {
    expect(resolveSelfAssessmentRequired(true, [false, false])).toBe(false);
  });
});
