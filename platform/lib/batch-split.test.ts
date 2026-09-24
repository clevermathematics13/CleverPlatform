import { describe, expect, it } from "vitest";
import { canCopySourceWhole, parseConfirmedSegments, withSplitOutcomes, type ConfirmedSegment } from "./batch-split";

describe("canCopySourceWhole", () => {
  it("is true when the segment claims every page", () => {
    expect(canCopySourceWhole([1, 2, 3, 4], 4, [])).toBe(true);
  });

  it("is true when the only unclaimed pages are confirmed blank", () => {
    // A 12-page part: an 11-page booklet plus its blank back page.
    const booklet = Array.from({ length: 11 }, (_, i) => i + 1);
    expect(canCopySourceWhole(booklet, 12, [12])).toBe(true);
  });

  it("is false when an unclaimed page is not known to be blank", () => {
    const booklet = Array.from({ length: 11 }, (_, i) => i + 1);
    expect(canCopySourceWhole(booklet, 12, [])).toBe(false);
    // Two students in one part: the second's pages are not blank.
    expect(canCopySourceWhole([1, 2, 3], 6, [])).toBe(false);
  });

  it("ignores claimed pages that also appear in the blank list", () => {
    expect(canCopySourceWhole([1, 2, 3], 3, [3])).toBe(true);
  });

  it("is false for an empty source", () => {
    expect(canCopySourceWhole([], 0, [])).toBe(false);
  });

  it("does not care about page order or duplicates in the segment", () => {
    expect(canCopySourceWhole([3, 1, 2, 2], 3, [])).toBe(true);
  });
});

describe("withSplitOutcomes", () => {
  const confirmed: ConfirmedSegment[] = [
    { label: "Ana Lopez", pages: [145, 146], matchedStudentId: "lopez" },
    { label: "Nina (Mina) Park", pages: [157, 158], matchedStudentId: "park" },
    { label: "Sara Vidal", pages: [169, 170], matchedStudentId: "vidal" },
  ];

  it("records where each stored scan went and why a failed one did not", () => {
    const out = withSplitOutcomes(confirmed, [
      { studentId: "lopez", status: "split", storagePath: "t/lopez/1-batch-b.pdf" },
      { studentId: "park", status: "failed", error: "Could not store split scan: fetch failed" },
      { studentId: "vidal", status: "split", storagePath: "t/vidal/1-batch-b.pdf" },
    ]);
    expect(out[0]).toMatchObject({ storagePath: "t/lopez/1-batch-b.pdf", splitError: null });
    expect(out[1]).toMatchObject({ storagePath: null, splitError: "Could not store split scan: fetch failed" });
    expect(out[2]).toMatchObject({ storagePath: "t/vidal/1-batch-b.pdf", splitError: null });
    // The teacher's confirmation itself is untouched.
    expect(out.map((s) => [s.label, s.pages, s.matchedStudentId])).toEqual(
      confirmed.map((s) => [s.label, s.pages, s.matchedStudentId])
    );
  });

  it("updates only the students it has an outcome for, which is what a retry of one student needs", () => {
    const first = withSplitOutcomes(confirmed, [
      { studentId: "lopez", status: "split", storagePath: "t/lopez/1.pdf" },
      { studentId: "park", status: "failed", error: "boom" },
      { studentId: "vidal", status: "split", storagePath: "t/vidal/1.pdf" },
    ]);
    const retried = withSplitOutcomes(first, [{ studentId: "park", status: "split", storagePath: "t/park/2.pdf" }]);
    expect(retried[1]).toMatchObject({ storagePath: "t/park/2.pdf", splitError: null });
    expect(retried[0]).toEqual(first[0]);
    expect(retried[2]).toEqual(first[2]);
  });

  it("treats a split with no path, or a failure with no message, as a failure with a message", () => {
    const [a, b] = withSplitOutcomes(confirmed.slice(0, 2), [
      { studentId: "lopez", status: "split" },
      { studentId: "park", status: "failed", error: "  " },
    ]);
    expect(a).toMatchObject({ storagePath: null, splitError: "The scan could not be stored." });
    expect(b).toMatchObject({ storagePath: null, splitError: "The scan could not be stored." });
  });
});

describe("parseConfirmedSegments", () => {
  it("reads segments written before and after outcomes were recorded", () => {
    expect(
      parseConfirmedSegments([
        { label: "Lucia Bravo", pages: [1, 2], matchedStudentId: "bravo" },
        { label: "Juan R", pages: [13], matchedStudentId: "rios", storagePath: "t/rios/1.pdf", splitError: null },
        { label: "Nina Park", pages: [157], matchedStudentId: "park", storagePath: null, splitError: "boom" },
      ])
    ).toEqual([
      { label: "Lucia Bravo", pages: [1, 2], matchedStudentId: "bravo", storagePath: null, splitError: null },
      { label: "Juan R", pages: [13], matchedStudentId: "rios", storagePath: "t/rios/1.pdf", splitError: null },
      { label: "Nina Park", pages: [157], matchedStudentId: "park", storagePath: null, splitError: "boom" },
    ]);
  });

  it("drops rows that are not usable segments and reads anything else as none", () => {
    expect(parseConfirmedSegments([null, 3, { label: "No student", pages: [1] }, { matchedStudentId: "", pages: [1] }])).toEqual([]);
    expect(parseConfirmedSegments(null)).toEqual([]);
    expect(parseConfirmedSegments({ label: "x" })).toEqual([]);
  });

  it("keeps only whole positive page numbers", () => {
    const [s] = parseConfirmedSegments([{ label: "x", pages: [0, 1, 2.5, "3", 4], matchedStudentId: "s" }]);
    expect(s.pages).toEqual([1, 4]);
  });
});
