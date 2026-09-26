import { describe, it, expect } from "vitest";
import {
  COULD_NOT_CHECK_SELF_ASSESSMENT,
  COULD_NOT_READ_CLEVMARK,
  describeKeptParts,
  hasSelfAssessmentOnFile,
  isProtectedDecrease,
  keptSuggestionsMessage,
  partitionProtectedWrites,
  protectedRefusalMessage,
  refusedCellsMessage,
} from "./protected-marks";

describe("isProtectedDecrease", () => {
  const protectedStudent = (existing: number | null, requested: number | null) =>
    isProtectedDecrease({ existing, requested, selfAssessed: true });

  it("refuses a lower mark once the student has self-assessed", () => {
    expect(protectedStudent(3, 1)).toBe(true);
    expect(protectedStudent(3, 2)).toBe(true);
  });

  it("refuses a zero, which is a decrease like any other", () => {
    expect(protectedStudent(1, 0)).toBe(true);
  });

  it("refuses clearing a mark once the student has self-assessed", () => {
    expect(protectedStudent(2, null)).toBe(true);
    expect(protectedStudent(0, null)).toBe(true);
  });

  it("allows the same mark again and any higher one", () => {
    expect(protectedStudent(3, 3)).toBe(false);
    expect(protectedStudent(3, 4)).toBe(false);
    expect(protectedStudent(0, 0)).toBe(false);
  });

  it("allows any first mark: a part with no ClevMark has nothing to protect", () => {
    expect(protectedStudent(null, 0)).toBe(false);
    expect(protectedStudent(null, 5)).toBe(false);
    expect(protectedStudent(null, null)).toBe(false);
  });

  it("allows lowering and clearing before the student has self-assessed", () => {
    expect(isProtectedDecrease({ existing: 3, requested: 1, selfAssessed: false })).toBe(false);
    expect(isProtectedDecrease({ existing: 3, requested: 0, selfAssessed: false })).toBe(false);
    expect(isProtectedDecrease({ existing: 3, requested: null, selfAssessed: false })).toBe(false);
  });
});

describe("partitionProtectedWrites", () => {
  type Row = { id: string; existing: number | null; requested: number | null; selfAssessed: boolean };
  const rows: Row[] = [
    { id: "a", existing: 3, requested: 1, selfAssessed: true },
    { id: "b", existing: 3, requested: 1, selfAssessed: false },
    { id: "c", existing: 1, requested: 2, selfAssessed: true },
    { id: "d", existing: 2, requested: null, selfAssessed: true },
    { id: "e", existing: null, requested: 0, selfAssessed: true },
  ];

  it("keeps exactly the protected decreases and writes the rest", () => {
    const { write, kept } = partitionProtectedWrites(rows, (r) => r);
    expect(kept.map((r) => r.id)).toEqual(["a", "d"]);
    expect(write.map((r) => r.id)).toEqual(["b", "c", "e"]);
  });

  it("returns the same row objects, in their original order", () => {
    const { write, kept } = partitionProtectedWrites(rows, (r) => r);
    expect(write[0]).toBe(rows[1]);
    expect(kept[1]).toBe(rows[3]);
  });

  it("handles an empty batch", () => {
    expect(partitionProtectedWrites([], (r: Row) => r)).toEqual({ write: [], kept: [] });
  });
});

describe("hasSelfAssessmentOnFile", () => {
  it("is false with no rows", () => {
    expect(hasSelfAssessmentOnFile([])).toBe(false);
    expect(hasSelfAssessmentOnFile(null)).toBe(false);
    expect(hasSelfAssessmentOnFile(undefined)).toBe(false);
  });

  // Wider than the reveal gate on purpose: a Redo or an all-blank submit
  // leaves rows whose self marks are all null, and that must not reopen the
  // student's marks to being lowered.
  it("counts any row, including one whose self mark is blank", () => {
    expect(hasSelfAssessmentOnFile([{ self_marks: null }])).toBe(true);
    expect(hasSelfAssessmentOnFile([{ self_marks: 0 }])).toBe(true);
  });
});

describe("messages", () => {
  it("says what stayed and what was refused", () => {
    expect(protectedRefusalMessage({ kept: 3, requested: 1 })).toMatch(/^This ClevMark stays at 3 and was not lowered to 1:/);
    expect(protectedRefusalMessage({ kept: 2, requested: null })).toMatch(/^This ClevMark stays at 2 and was not cleared:/);
  });

  it("summarises kept suggestions, singular and plural, and says nothing when there are none", () => {
    expect(keptSuggestionsMessage(0, 0)).toBe("");
    expect(keptSuggestionsMessage(1, 1)).toBe(
      "1 suggestion was lower than the ClevMark already on file for 1 student with a self-assessment on file, so that ClevMark was kept."
    );
    expect(keptSuggestionsMessage(4, 2)).toContain("4 suggestions were lower");
    expect(keptSuggestionsMessage(4, 2)).toContain("for 2 students");
    expect(keptSuggestionsMessage(4, 2)).toContain("those ClevMarks were kept.");
  });

  it("summarises refused gradebook cells, singular and plural", () => {
    expect(refusedCellsMessage(0)).toBe("");
    expect(refusedCellsMessage(1)).toMatch(/^1 cell kept its ClevMark: that student has/);
    expect(refusedCellsMessage(3)).toMatch(/^3 cells kept their ClevMark: those students have/);
  });

  it("lists kept parts for the review panel, up to six", () => {
    expect(describeKeptParts([])).toBe("");
    expect(describeKeptParts([{ label: "3.3(a)", kept: 3, requested: 1 }])).toBe(
      "Kept 1 ClevMark: 3.3(a) stays 3 (you chose 1). " +
        "This student has a self-assessment on file, so a ClevMark is never lowered after that."
    );
    const many = Array.from({ length: 8 }, (_, i) => ({ label: `P${i + 1}`, kept: 2, requested: 0 }));
    const text = describeKeptParts(many);
    expect(text).toMatch(/^Kept 8 ClevMarks: /);
    expect(text).toContain("P6 stays 2");
    expect(text).not.toContain("P7 stays");
    expect(text).toContain(", and 2 more.");
  });

  // lib/protected-marks.ts is imported by components in the student bundle,
  // and the reflection route sends these texts to a page students can load.
  it("never says AI, never names a model and never uses the old name", () => {
    const texts = [
      protectedRefusalMessage({ kept: 3, requested: 1 }),
      protectedRefusalMessage({ kept: 3, requested: null }),
      keptSuggestionsMessage(2, 1),
      refusedCellsMessage(2),
      describeKeptParts([{ label: "1.1", kept: 1, requested: 0 }]),
      COULD_NOT_CHECK_SELF_ASSESSMENT,
      COULD_NOT_READ_CLEVMARK,
    ];
    for (const text of texts) {
      expect(text).not.toMatch(/\bAI\b/);
      expect(text).not.toMatch(/Claude/);
      expect(text).not.toMatch(/Clev's/);
    }
  });
});
