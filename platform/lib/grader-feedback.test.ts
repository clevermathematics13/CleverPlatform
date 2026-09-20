import { describe, expect, it } from "vitest";
import {
  GRADER_FEEDBACK_MODEL,
  GraderFeedbackResponseSchema,
  buildGraderFeedbackSystemPrompt,
  buildGraderFeedbackUserPrompt,
} from "./grader-feedback";
import { GRADING_SYSTEM_PROMPT, type GradingUnit } from "./ai-grading";

const unit = (overrides: Partial<GradingUnit> = {}): GradingUnit => ({
  testItemId: "item-1",
  questionNumber: 8,
  partLabel: "a",
  maxMarks: 1,
  questionCode: "",
  questionLatex: "Expand and simplify $6(k - 2) + 5(k - 1)$ hmm",
  markscheme: "A1 for the correctly distributed, unsimplified expression $6k - 12 + 5k - 6$.",
  markschemeSource: "custom",
  commandTerms: [],
  subtopicCodes: [],
  curriculum: [],
  level: null,
  paper: null,
  ...overrides,
});

describe("buildGraderFeedbackSystemPrompt", () => {
  it("starts with the grader's own system prompt and then briefs the drafting task", () => {
    const prompt = buildGraderFeedbackSystemPrompt(unit());
    expect(prompt.startsWith(GRADING_SYSTEM_PROMPT)).toBe(true);
    expect(prompt).toContain("YOUR TASK IN THIS CALL");
    expect(prompt).toContain("TEACHER'S MARKING NOTES");
    expect(prompt).toContain("cannotApply");
  });
});

describe("buildGraderFeedbackUserPrompt", () => {
  it("prints the part, the existing notes, the case and the feedback in that order", () => {
    const prompt = buildGraderFeedbackUserPrompt({
      unit: unit(),
      feedback: "The distributed expression in the working earns the mark even if the final line is wrong.",
      currentNotes: "Accept $11k - 18$ written directly.",
      graded: {
        studentLabel: "Q8(a), one student",
        evidence: "6k - 12 + 5k - 6 = 11k - 6",
        reasoning: "The final answer is wrong. A1 not awarded.",
        markBreakdown: [{ token: "A1", awarded: false, note: "wrong constant" }],
        suggestedMarks: 0,
        maxMarks: 1,
        confidence: "high",
      },
    });
    const at = (s: string) => prompt.indexOf(s);
    expect(at("--- Mark scheme (the authority) ---")).toBeGreaterThan(-1);
    expect(at("--- Teacher's marking notes for this part")).toBeGreaterThan(at("--- Mark scheme (the authority) ---"));
    expect(at("--- Existing marking notes")).toBeGreaterThan(at("--- Teacher's marking notes for this part"));
    expect(at("The marker's result the teacher was looking at")).toBeGreaterThan(at("--- Existing marking notes"));
    expect(at("A1 not awarded -- wrong constant")).toBeGreaterThan(-1);
    expect(at("--- The teacher's feedback ---")).toBeGreaterThan(at("The marker's result"));
    expect(prompt).toContain("earns the mark even if the final line is wrong.");
  });

  it("says there are no notes yet and omits the case when there is none", () => {
    const prompt = buildGraderFeedbackUserPrompt({ unit: unit(), feedback: "Be lenient on notation.", currentNotes: null, graded: null });
    expect(prompt).toContain("(none yet)");
    expect(prompt).not.toContain("The marker's result");
    expect(prompt).not.toContain("--- Teacher's marking notes for this part");
  });
});

describe("GraderFeedbackResponseSchema", () => {
  it("accepts a draft and a refusal alike", () => {
    expect(GraderFeedbackResponseSchema.safeParse({ markingNotes: "x", summary: "y", caseMarks: 1, cannotApply: null }).success).toBe(true);
    expect(GraderFeedbackResponseSchema.safeParse({ markingNotes: "x", summary: "y", caseMarks: null, cannotApply: "about part (b)" }).success).toBe(true);
    expect(GraderFeedbackResponseSchema.safeParse({ markingNotes: "x", summary: "y", caseMarks: -1, cannotApply: null }).success).toBe(false);
  });

  it("names the model the reference mandates for intricate work", () => {
    expect(GRADER_FEEDBACK_MODEL).toBe("claude-opus-5");
  });
});
