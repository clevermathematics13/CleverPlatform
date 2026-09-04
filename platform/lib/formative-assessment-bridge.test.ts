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
