import { describe, it, expect } from "vitest";
import { validateAssessment } from "./na-assessment";

function assessmentJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    transcription: "60x7=420",
    verdict: "correct",
    marksAwarded: 3,
    misconceptionTags: [],
    marginComment: "Nice work.",
    nextStep: "Keep it up.",
    confidence: 0.9,
    teacherNote: "All parts correct.",
    ...overrides,
  });
}

describe("validateAssessment", () => {
  it("passes through a clean, single-conclusion teacherNote with no warnings", () => {
    const result = validateAssessment(assessmentJson(), 3);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings).toEqual([]);
  });

  it("clamps marksAwarded above marksAvailable and warns", () => {
    const result = validateAssessment(assessmentJson({ marksAwarded: 5 }), 3);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.assessment.marksAwarded).toBe(3);
      expect(result.warnings.some((w) => w.includes("clamped"))).toBe(true);
    }
  });

  it("zeroes marks on an unclear verdict carrying marks and warns", () => {
    const result = validateAssessment(assessmentJson({ verdict: "unclear", marksAwarded: 2 }), 3);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.assessment.marksAwarded).toBe(0);
      expect(result.warnings.some((w) => w.includes("unclear"))).toBe(true);
    }
  });

  // Regression test for a real production failure: A.1 Q1, Kaito Fujii.
  // The model's own teacherNote reasoned through to "I should award 3/3"
  // -- twice -- while marksAwarded in that same response was 2. Both
  // fields validate fine individually, so schema validation alone can't
  // catch it; this checks the backtracking-language detector added
  // specifically because of this case.
  it("flags a teacherNote that backtracks mid-explanation", () => {
    const teacherNote =
      "The student correctly answered (a)=420, (b)=330, (c)=750, and (d)=750. This crop covers (a), (b), and (c) for 3 marks. All three visible answers are correct: (a) 420 ✓, (b) 330 ✓, (c) 750 ✓. Awarding 3/3 for the visible parts (a), (b), (c). Wait — the scope says 3 marks for this crop. Since this crop's 3 marks cover (a), (b), and (c) per the scope note, I should award 3/3 for (a)=420 ✓, (b)=330 ✓, (c)=750 ✓.";
    const result = validateAssessment(assessmentJson({ marksAwarded: 2, teacherNote }), 3);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.some((w) => w.toLowerCase().includes("changing its mind"))).toBe(true);
    }
  });

  // The detector is a plain text heuristic, not a semantic one -- it can't
  // tell the model's own backtracking apart from it merely quoting a
  // student's handwritten "wait". A false positive here (an extra flag on
  // a note that was actually fine) is a cheap cost; a false negative on a
  // real self-contradiction is the expensive one this exists to catch, so
  // the heuristic is deliberately biased toward over-flagging.
  it("also flags (accepted false positive) a teacherNote quoting a student's own written 'wait'", () => {
    const teacherNote = "The student wrote 'wait, that's not 750' as their own annotation, then corrected it.";
    const result = validateAssessment(assessmentJson({ teacherNote }), 3);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.some((w) => w.toLowerCase().includes("changing its mind"))).toBe(true);
    }
  });

  it("rejects a response with no JSON object", () => {
    const result = validateAssessment("I think the answer is correct.", 3);
    expect(result.ok).toBe(false);
  });

  it("rejects invalid JSON", () => {
    const result = validateAssessment('{"verdict": "correct", marksAwarded: 3}', 3);
    expect(result.ok).toBe(false);
  });
});

describe("validateAssessment -- studentAttempted", () => {
  it("defaults to attempted when the field is absent, so a legacy or terse response never accuses a student of skipping", () => {
    const result = validateAssessment(assessmentJson(), 3);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.assessment.studentAttempted).toBe(true);
  });

  it("clears marginComment and nextStep on a genuinely untouched box", () => {
    const result = validateAssessment(
      assessmentJson({
        studentAttempted: false,
        verdict: "unclear",
        marksAwarded: 0,
        transcription: "",
        marginComment: "This box was left blank -- give it a go!",
        nextStep: "Attempt every question.",
      }),
      3
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.assessment.studentAttempted).toBe(false);
      expect(result.assessment.marginComment).toBe("");
      expect(result.assessment.nextStep).toBe("");
    }
  });

  it("keeps studentAttempted=false when the transcription is a placeholder describing the emptiness, but warns", () => {
    const result = validateAssessment(
      assessmentJson({
        studentAttempted: false,
        verdict: "unclear",
        marksAwarded: 0,
        transcription: "[empty box - no student writing visible]",
        marginComment: "",
        nextStep: "",
      }),
      3
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      // must NOT flip: this is the model describing a blank box, not
      // quoting the student, and flipping it puts the blank back into the
      // student's feedback as an ordinary unanswered question.
      expect(result.assessment.studentAttempted).toBe(false);
      expect(result.warnings.join(" ")).toMatch(/still filled in a transcription/i);
    }
  });

  it("overrides studentAttempted=false when marks were awarded, and warns", () => {
    const result = validateAssessment(
      assessmentJson({ studentAttempted: false, verdict: "partial", marksAwarded: 2, transcription: "" }),
      3
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.assessment.studentAttempted).toBe(true);
      expect(result.warnings.join(" ")).toMatch(/awarded 2 marks/i);
    }
  });
});

describe("validateAssessment -- an untouched box is not a wrong answer", () => {
  it("normalises verdict to unclear when the model pairs studentAttempted=false with 'incorrect'", () => {
    const result = validateAssessment(
      assessmentJson({
        studentAttempted: false,
        verdict: "incorrect",
        marksAwarded: 0,
        transcription: "",
        marginComment: "",
        nextStep: "",
      }),
      3
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.assessment.verdict).toBe("unclear");
      expect(result.assessment.marksAwarded).toBe(0);
      expect(result.assessment.studentAttempted).toBe(false);
    }
  });
});
