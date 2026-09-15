import { describe, it, expect } from "vitest";
import { buildTestItemsFromSections, computeTotalMarks } from "./formative-assessment-bridge";
import type { AssignmentSection } from "./assignments";

function section(overrides: Partial<AssignmentSection> = {}): AssignmentSection {
  return { heading: "LEVEL 1", questions: [], ...overrides };
}

describe("buildTestItemsFromSections", () => {
  it("numbers questions globally across sections, not per section", () => {
    const rows = buildTestItemsFromSections("test-1", [
      section({ questions: [{ prompt: "Q1 prompt", marks: 2, markScheme: "A2" }] }),
      section({ questions: [{ prompt: "Q2 prompt", marks: 3, markScheme: "M1A2" }] }),
    ]);

    expect(rows.map((r) => r.question_number)).toEqual([1, 2]);
    expect(rows.every((r) => r.test_id === "test-1")).toBe(true);
    expect(rows.every((r) => r.source === "custom")).toBe(true);
  });

  it("emits one row per subpart, with lettered part_label", () => {
    const rows = buildTestItemsFromSections("test-1", [
      section({
        questions: [
          {
            prompt: "Solve the system",
            marks: 4,
            subparts: [
              { prompt: "(a) find x", marks: 1, markScheme: "A1" },
              { prompt: "(b) find y", marks: 3, markScheme: "M2A1" },
            ],
          },
        ],
      }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0].part_label).toBe("a");
    expect(rows[1].part_label).toBe("b");
    expect(rows.every((r) => r.question_number === 1)).toBe(true);
    expect(rows[0].max_marks).toBe(1);
    expect(rows[1].max_marks).toBe(3);
    expect(rows[0].markscheme_text).toBe("A1");
  });

  it("carries the question's stem onto every subpart row", () => {
    const rows = buildTestItemsFromSections("test-1", [
      section({
        questions: [
          {
            prompt: "Consider the formula $px + q = rx + s$.",
            marks: 4,
            subparts: [
              { prompt: "Rearrange the formula to make $x$ the subject.", marks: 3, markScheme: "M1M1A1" },
              { prompt: "Write down the condition your answer requires.", marks: 1, markScheme: "A1" },
            ],
          },
        ],
      }),
    ]);

    expect(rows.map((r) => r.stem_text)).toEqual([
      "Consider the formula $px + q = rx + s$.",
      "Consider the formula $px + q = rx + s$.",
    ]);
    // The part's own words stay its own -- the validator reads this field.
    expect(rows[0].question_text).toBe("Rearrange the formula to make $x$ the subject.");
  });

  it("leaves stem_text null on a whole-question row rather than repeating the prompt", () => {
    const rows = buildTestItemsFromSections("test-1", [
      section({ questions: [{ prompt: "Q1 prompt", marks: 2, markScheme: "A2" }] }),
    ]);

    expect(rows[0].stem_text).toBeNull();
    expect(rows[0].question_text).toBe("Q1 prompt");
  });

  it("stores a blank stem as no stem", () => {
    const rows = buildTestItemsFromSections("test-1", [
      section({
        questions: [
          { prompt: "   ", marks: 1, subparts: [{ prompt: "find x", marks: 1, markScheme: "A1" }] },
        ],
      }),
    ]);

    expect(rows[0].stem_text).toBeNull();
  });

  it("does not let a stem displace the start of a subpart prompt", () => {
    // rubric-validator's rule 10 matches a self-numbered prompt with /^.../,
    // so question_text has to still BEGIN with the subpart's own first word.
    const rows = buildTestItemsFromSections("test-1", [
      section({
        questions: [
          { prompt: "A stem", marks: 1, subparts: [{ prompt: "(a) find x", marks: 1, markScheme: "A1" }] },
        ],
      }),
    ]);

    expect(rows[0].question_text.startsWith("(a)")).toBe(true);
  });

  it("uses an empty part_label for a question with no subparts", () => {
    const rows = buildTestItemsFromSections("test-1", [
      section({ questions: [{ prompt: "Q1 prompt", marks: 2, markScheme: "A2" }] }),
    ]);

    expect(rows[0].part_label).toBe("");
    expect(rows[0].max_marks).toBe(2);
    expect(rows[0].question_text).toBe("Q1 prompt");
    expect(rows[0].markscheme_text).toBe("A2");
  });

  it("falls back to empty strings/zero marks when unset, never undefined", () => {
    const rows = buildTestItemsFromSections("test-1", [
      section({ questions: [{ prompt: "Untiered prompt" }] }),
    ]);

    expect(rows[0].max_marks).toBe(0);
    expect(rows[0].markscheme_text).toBe("");
  });

  it("is idempotent: the same sections always produce the same rows", () => {
    const sections: AssignmentSection[] = [
      section({ questions: [{ prompt: "Q1 prompt", marks: 2, markScheme: "A2" }] }),
    ];

    expect(buildTestItemsFromSections("test-1", sections)).toEqual(
      buildTestItemsFromSections("test-1", sections),
    );
  });
});

describe("computeTotalMarks", () => {
  it("sums question marks directly when there are no subparts", () => {
    const total = computeTotalMarks([
      section({ questions: [{ prompt: "Q1", marks: 2 }, { prompt: "Q2", marks: 3 }] }),
    ]);
    expect(total).toBe(5);
  });

  it("sums subpart marks instead of the parent's when subparts are present", () => {
    const total = computeTotalMarks([
      section({
        questions: [
          { prompt: "Q1", marks: 4, subparts: [{ prompt: "a", marks: 1 }, { prompt: "b", marks: 3 }] },
        ],
      }),
    ]);
    expect(total).toBe(4);
  });
});
