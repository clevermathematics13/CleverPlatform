import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  buildAssessmentSystemPrompt,
  clampToOneSentence,
  clampToSentences,
  NA_STUDENT_FEEDBACK_VOICE,
  STUDENT_TEXT_MAX_SENTENCES,
  validateAssessment,
} from "./na-assessment";

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

describe("clampToOneSentence", () => {
  it("leaves a single short sentence untouched", () => {
    expect(clampToOneSentence("Nearly all correct -- in (b) the first term should be 2x^2.")).toBe(
      "Nearly all correct -- in (b) the first term should be 2x^2."
    );
  });

  it("keeps only the first sentence of a paragraph-length comment", () => {
    const paragraph =
      "Excellent work on parts (a), (c), (d), and (e) -- all correct! In part (b), you listed " +
      "the first term as 3x^2 instead of 2x^2. Interestingly, you correctly identified the " +
      "coefficient as 2 in part (c), so it looks like a small slip.";
    expect(clampToOneSentence(paragraph)).toBe(
      "Excellent work on parts (a), (c), (d), and (e) -- all correct!"
    );
  });

  it("does not split a decimal or an abbreviation mid-sentence", () => {
    expect(clampToOneSentence("Your answer of 0.5 is right, but round to 2 s.f. next time.")).toBe(
      "Your answer of 0.5 is right, but round to 2 s.f. next time."
    );
  });

  it("returns an empty string unchanged", () => {
    expect(clampToOneSentence("")).toBe("");
  });
});

describe("validateAssessment -- student-facing brevity", () => {
  it("keeps two sentences, so a comment has room to explain an idea and not just judge it", () => {
    const result = validateAssessment(
      assessmentJson({
        marginComment: "Good start on (a). You also need to simplify the fraction in (b).",
        nextStep: "Simplify 6/8 in (b). Then check your answer against (a).",
      }),
      3
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.assessment.marginComment).toBe(
        "Good start on (a). You also need to simplify the fraction in (b)."
      );
      expect(result.warnings.filter((w) => w.includes("ran past"))).toHaveLength(0);
    }
  });

  it("drops a third sentence and warns with the text the student will not see", () => {
    const result = validateAssessment(
      assessmentJson({
        marginComment: "Good start on (a). Simplify the fraction in (b). Then check (c) as well.",
      }),
      3
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.assessment.marginComment).toBe("Good start on (a). Simplify the fraction in (b).");
      expect(result.warnings.some((w) => w.includes("Then check (c) as well."))).toBe(true);
    }
  });

  it("keeps an over-budget comment but warns so a teacher shortens it", () => {
    const wordy =
      "You have clearly understood how to expand the brackets here and your working is very neat " +
      "and legible throughout the whole of this question, which makes it easy to follow your thinking.";
    const result = validateAssessment(assessmentJson({ marginComment: wordy }), 3);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.assessment.marginComment).toBe(wordy);
      expect(result.warnings.some((w) => w.includes("word budget"))).toBe(true);
    }
  });

  it("adds no brevity warnings for an untouched box, whose fields are already cleared", () => {
    const result = validateAssessment(
      assessmentJson({ studentAttempted: false, marksAwarded: 0, transcription: "", verdict: "unclear" }),
      3
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.assessment.marginComment).toBe("");
      expect(result.warnings.some((w) => w.includes("sentence") || w.includes("budget"))).toBe(false);
    }
  });
});

describe("clampToSentences", () => {
  it("keeps two sentences by default", () => {
    const two = "Every a is the same number. How many factors have an a?";
    expect(clampToSentences(two)).toBe(two);
  });

  it("cuts at the limit, never mid-thought", () => {
    expect(clampToSentences("One. Two. Three.", 2)).toBe("One. Two.");
  });

  it("still honours an explicit single-sentence request", () => {
    expect(clampToSentences("One. Two.", 1)).toBe("One.");
    expect(clampToOneSentence("One. Two.")).toBe("One.");
  });

  it("returns text shorter than the limit untouched", () => {
    expect(clampToSentences("Just the one sentence here.")).toBe("Just the one sentence here.");
  });

  it("does not split a decimal or an abbreviation", () => {
    const s = "Your answer of 0.5 is right, but round to 2 s.f. next time.";
    expect(clampToSentences(s, 1)).toBe(s);
  });
});

describe("buildAssessmentSystemPrompt", () => {
  it("loads a voice guide with real content, not an empty read", () => {
    expect(NA_STUDENT_FEEDBACK_VOICE.length).toBeGreaterThan(0);
    // A heading a teacher is unlikely to delete while editing the prose.
    expect(NA_STUDENT_FEEDBACK_VOICE).toContain("## Stance");
  });

  it("carries the voice guide on BOTH passes", () => {
    // The wide-context pass has its own prompt constant and would
    // otherwise silently keep the old voice -- the exact miss the funnel
    // exists to make impossible.
    for (const pass of ["crop", "wide_context"] as const) {
      expect(buildAssessmentSystemPrompt(pass)).toContain(NA_STUDENT_FEEDBACK_VOICE);
    }
  });

  it("keeps each pass's own base prompt", () => {
    expect(buildAssessmentSystemPrompt("wide_context")).toContain("outlined in RED");
    expect(buildAssessmentSystemPrompt("crop")).not.toContain("outlined in RED");
  });

  it("injects the voice exactly once, and identically across calls", () => {
    const a = buildAssessmentSystemPrompt("crop");
    // Byte-stability is the prompt-cache contract in the assess route.
    expect(a).toBe(buildAssessmentSystemPrompt("crop"));
    expect(a.split(NA_STUDENT_FEEDBACK_VOICE)).toHaveLength(2);
  });

  it("appends the voice after the base prompt, preserving the cached prefix order", () => {
    const prompt = buildAssessmentSystemPrompt("crop");
    expect(prompt.indexOf(NA_STUDENT_FEEDBACK_VOICE)).toBeGreaterThan(prompt.indexOf("You are marking"));
  });

  it("keeps BOTH halves of the fixed/varies distinction", () => {
    const prompt = buildAssessmentSystemPrompt("crop");
    // Dropping either half reintroduces a real, opposite failure: without the
    // first, a letter gets called "a fixed variable" (Davi's Q7(b)); without
    // the second, the ~40 correct comments saying pi IS fixed would go wrong.
    expect(prompt).toContain("is not fixed");
    expect(prompt).toContain("A constant is fixed");
  });

  it("states the guardrails in code, where a teacher editing the .md cannot remove them", () => {
    const prompt = buildAssessmentSystemPrompt("crop");
    expect(prompt).toContain("rules above win");
    expect(prompt).toContain("deleted\nbefore the student sees it");
  });
});

describe("worker packaging", () => {
  it("Dockerfile copies the feedback_voice dir the worker's import needs", () => {
    // No local run can catch this: `npm run worker:dev` has cwd platform/,
    // where the file exists regardless. Without the COPY the built image
    // throws at import and the worker never reaches its poll loop.
    const dockerfile = fs.readFileSync(path.join(process.cwd(), "worker", "Dockerfile"), "utf8");
    expect(dockerfile).toMatch(/^COPY\s+feedback_voice\s/m);
  });
});
