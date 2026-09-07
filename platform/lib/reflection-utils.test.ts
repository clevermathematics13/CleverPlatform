import { describe, it, expect } from "vitest";
import { computeDisagreement } from "./reflection-utils";
import type { ReflectionItem } from "./reflection-types";

function item(
  partial: Partial<ReflectionItem> & { max_marks: number }
): ReflectionItem {
  return {
    id: partial.test_item_id ?? "item",
    test_item_id: partial.test_item_id ?? "item",
    question_number: 1,
    part_label: "",
    subtopic_codes: [],
    subtopic_labels: [],
    marks_awarded: null,
    self_marks: null,
    ...partial,
  };
}

describe("computeDisagreement", () => {
  it("returns null before the teacher has marked anything", () => {
    expect(
      computeDisagreement([
        item({ test_item_id: "a", max_marks: 4, self_marks: 3 }),
        item({ test_item_id: "b", max_marks: 6, self_marks: 5 }),
      ])
    ).toBeNull();
  });

  it("is 0 when the student's marks match the teacher's exactly", () => {
    expect(
      computeDisagreement([
        item({ test_item_id: "a", max_marks: 4, marks_awarded: 3, self_marks: 3 }),
        item({ test_item_id: "b", max_marks: 6, marks_awarded: 5, self_marks: 5 }),
      ])
    ).toBe(0);
  });

  it("reports the marks gap as a percentage of the marks available", () => {
    // |3-1| + |5-5| = 2 marks out of 10 available.
    expect(
      computeDisagreement([
        item({ test_item_id: "a", max_marks: 4, marks_awarded: 3, self_marks: 1 }),
        item({ test_item_id: "b", max_marks: 6, marks_awarded: 5, self_marks: 5 }),
      ])
    ).toBe(20);
  });

  it("counts every marked item as full disagreement when nobody has self-graded", () => {
    expect(
      computeDisagreement([
        item({ test_item_id: "a", max_marks: 4, marks_awarded: 3 }),
        item({ test_item_id: "b", max_marks: 6, marks_awarded: 5 }),
      ])
    ).toBe(100);
  });

  // The regression this file exists for. A student who self-graded and left
  // a question blank ("no attempt") is claiming zero marks on it, not
  // refusing to answer the question. Counting the blank as full disagreement
  // held them permanently above 0%, and Upload Corrections only unlocks at 0.
  describe("once the student has self-graded", () => {
    it("agrees with the teacher when a blank question was marked 0", () => {
      expect(
        computeDisagreement([
          item({ test_item_id: "a", max_marks: 4, marks_awarded: 4, self_marks: 4 }),
          item({ test_item_id: "b", max_marks: 6, marks_awarded: 0, self_marks: null }),
        ])
      ).toBe(0);
    });

    it("counts only the marks the teacher gave a blank question", () => {
      // The student attempted nothing on b; the teacher gave 2 of its 6.
      expect(
        computeDisagreement([
          item({ test_item_id: "a", max_marks: 4, marks_awarded: 4, self_marks: 4 }),
          item({ test_item_id: "b", max_marks: 6, marks_awarded: 2, self_marks: null }),
        ])
      ).toBe(20);
    });

    it("treats a blank the same as an explicit 0", () => {
      const blank = computeDisagreement([
        item({ test_item_id: "a", max_marks: 5, marks_awarded: 2, self_marks: 1 }),
        item({ test_item_id: "b", max_marks: 5, marks_awarded: 1, self_marks: null }),
      ]);
      const zero = computeDisagreement([
        item({ test_item_id: "a", max_marks: 5, marks_awarded: 2, self_marks: 1 }),
        item({ test_item_id: "b", max_marks: 5, marks_awarded: 1, self_marks: 0 }),
      ]);
      expect(blank).toBe(zero);
    });

    // The teacher's side is different: with no mark on an item there is
    // nothing to compare a self-mark against, so grading being incomplete
    // still reads as disagreement rather than agreement.
    it("still counts an unmarked question as full disagreement", () => {
      expect(
        computeDisagreement([
          item({ test_item_id: "a", max_marks: 5, marks_awarded: 5, self_marks: 5 }),
          item({ test_item_id: "b", max_marks: 5, self_marks: 3 }),
        ])
      ).toBe(50);
    });
  });
});
