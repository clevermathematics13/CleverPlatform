import { describe, it, expect } from "vitest";
import { isUngradedAnchor, type AnchorContext } from "./na-assessment";

/**
 * This predicate decides what never reaches the assessor (worker/assess-submit),
 * what approve-all and both release routes skip, and -- since the review board
 * started using it -- what is left out of the marking denominator. A wrong
 * answer in the ungraded direction silently drops a real question's crops from
 * every one of those, so the near-misses below matter more than the hit.
 *
 * Field values are the live A.1 and A.2 anchors as stored.
 */
const anchor = (over: Partial<AnchorContext> = {}): AnchorContext => ({
  qid: "Q4",
  baseQid: "Q4",
  marksAvailable: 3,
  commandTerm: "Explain",
  answerSketch: "Accept any observation that the totals match.",
  openRubric: null,
  misconceptionContext: null,
  ...over,
});

// The one real case: A.1 and A.2 each carry exactly one, and both store all
// four fields as NULL. rubric_item_id is set on them and is deliberately not
// consulted -- a rubric row exists for layout, not for marking.
const SANDBOX = anchor({
  qid: "ACTIVITY[MY NOTICINGS FROM THE SANDBOX]",
  baseQid: "ACTIVITY[MY NOTICINGS FROM THE SANDBOX]",
  marksAvailable: null,
  commandTerm: null,
  answerSketch: null,
  openRubric: null,
  questionAnswer: null,
});

describe("isUngradedAnchor", () => {
  it("recognises the Desmos thinking space", () => {
    expect(isUngradedAnchor(SANDBOX)).toBe(true);
  });

  it("treats blank-but-present keys as absent", () => {
    expect(isUngradedAnchor({ ...SANDBOX, answerSketch: "   ", openRubric: "\n", questionAnswer: " " })).toBe(true);
  });

  describe("does not strand a question that can be marked", () => {
    it("leaves an ordinary question alone", () => {
      expect(isUngradedAnchor(anchor())).toBe(false);
    });

    // On live data marks_available is null for exactly one anchor per packet --
    // the sandbox -- so these three clauses currently save nobody. That is the
    // point: they are what stops a marks-loading bug from turning real
    // questions into "ungraded" and quietly deleting them from the total.
    it("keeps an anchor whose marks are missing but which has an answer key", () => {
      expect(isUngradedAnchor({ ...SANDBOX, questionAnswer: "420" })).toBe(false);
    });

    it("keeps an anchor whose marks are missing but which has a companion sketch", () => {
      expect(isUngradedAnchor({ ...SANDBOX, answerSketch: "Both give 60a + 30c." })).toBe(false);
    });

    it("keeps an anchor whose marks are missing but which has an open rubric", () => {
      expect(isUngradedAnchor({ ...SANDBOX, openRubric: "Award 1 for any correct noticing." })).toBe(false);
    });

    it("does not confuse zero marks with absent marks", () => {
      // question_marks is 0 on the sandbox, but marks_available is what is
      // read, and an explicit 0 is a stated value rather than a missing one.
      expect(isUngradedAnchor({ ...SANDBOX, marksAvailable: 0 })).toBe(false);
    });
  });
});
