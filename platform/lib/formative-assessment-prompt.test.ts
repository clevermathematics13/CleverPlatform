/**
 * What the generator is actually told.
 *
 * Two claims worth pinning. The first is that the exam conditions REACH the
 * model: the calculator rule and the time allowed are chosen above the Generate
 * button, and a teacher who sets "no calculator" and gets back a paper that
 * needs one has been misled by their own UI. The second is that a FORMATIVE's
 * prompt did not move: these fields are a summative concept, and the formative
 * generator has been in daily use.
 */
import { describe, it, expect } from "vitest";
import {
  buildFormativeAssessmentSystemPrompt,
  buildFormativeAssessmentUserPrompt,
} from "./formative-assessment-prompt";

const base = {
  gradeLevel: "Grade 9",
  topic: "Algebraic language, expressions, equations",
  totalMarks: 50,
  levelCount: 4,
};

describe("the exam conditions reach the generator", () => {
  it("states the calculator rule in the teacher's own words", () => {
    const prompt = buildFormativeAssessmentUserPrompt({
      ...base,
      kind: "summative",
      calculatorPolicy: "not-permitted",
    });
    expect(prompt).toContain("Calculator: No calculator permitted");
  });

  it("uses the same wording the cover prints, not a second vocabulary", () => {
    // calculatorPolicyLabel is the one source for this phrasing. A paraphrase
    // here would be a rule the cover and the prompt could disagree about.
    const prompt = buildFormativeAssessmentUserPrompt({
      ...base,
      kind: "summative",
      calculatorPolicy: "graphing",
    });
    expect(prompt).toContain("Calculator: Graphing calculator permitted");
  });

  it("gives the time as raw minutes, which is what it has to do arithmetic on", () => {
    const prompt = buildFormativeAssessmentUserPrompt({
      ...base,
      kind: "summative",
      timeAllowedMinutes: 75,
    });
    // Not "1 hour 15 minutes" -- the model has to sum estimatedMinutes against
    // this number, and the cover's phrasing is for a student, not for that.
    expect(prompt).toContain("Time allowed: 75 minutes");
  });

  it("tells the model what the rule MEANS, in the system prompt", () => {
    const system = buildFormativeAssessmentSystemPrompt("summative");
    expect(system).toContain("S7. THE CALCULATOR RULE IS A CONSTRAINT");
    expect(system).toContain("S8. THE PAPER MUST FIT THE TIME");
    // The value varies per paper and the standing rule does not: keeping the
    // rule in the system prompt is what lets that prefix stay cacheable.
    expect(system).not.toContain("No calculator permitted");
  });

  it("still forbids repeating them in the printed instructions", () => {
    // S6 matters MORE now that the model can see the rule: a second copy in
    // the instructions is one that can disagree with the cover.
    const system = buildFormativeAssessmentSystemPrompt("summative");
    expect(system).toContain("Do NOT write the calculator rule, the time allowed or the total marks into instructions");
  });
});

describe("a formative's prompt is untouched", () => {
  it("carries no conditions even when some are passed", () => {
    // applyKindFormatting clears them for a formative, so this should not
    // arise -- but the prompt refuses them rather than trusting that.
    const withConditions = buildFormativeAssessmentUserPrompt({
      ...base,
      kind: "formative",
      calculatorPolicy: "graphing",
      timeAllowedMinutes: 50,
    });
    expect(withConditions).not.toContain("Calculator:");
    expect(withConditions).not.toContain("Time allowed:");
  });

  it("is byte-identical to the prompt built without the new fields", () => {
    expect(buildFormativeAssessmentUserPrompt({ ...base, kind: "formative" })).toBe(
      buildFormativeAssessmentUserPrompt(base),
    );
    expect(buildFormativeAssessmentSystemPrompt("formative")).not.toContain("S7.");
  });
});
