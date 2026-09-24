import { describe, expect, it } from "vitest";
import { findUnmarkedBatchStudents, formatPageRanges, type SplitBatchRef } from "./batch-unmarked";

const batch = (id: string, created_at: string, segments: unknown, status = "split"): SplitBatchRef => ({
  id,
  file_name: `${id}.pdf`,
  status,
  confirmed_segments: segments,
  created_at,
});

describe("findUnmarkedBatchStudents", () => {
  it("flags a confirmed student with no run at all, with what the split recorded for them", () => {
    const b = batch("9c", "2026-09-15T18:29:20Z", [
      { label: "Ana Lopez", pages: [145, 146], matchedStudentId: "lopez", storagePath: "t/lopez/1.pdf" },
      { label: "Nina (Mina) Park", pages: [158, 157], matchedStudentId: "park", storagePath: null, splitError: "fetch failed" },
    ]);
    expect(findUnmarkedBatchStudents([b], new Set(["lopez"]))).toEqual([
      {
        studentId: "park",
        batchId: "9c",
        fileName: "9c.pdf",
        label: "Nina (Mina) Park",
        pages: [157, 158],
        storagePath: null,
        splitError: "fetch failed",
      },
    ]);
  });

  it("does not flag anyone with a run of any status, and flags nobody for a batch that was never split", () => {
    const split = batch("a", "2026-09-16T00:00:00Z", [{ label: "A", pages: [1], matchedStudentId: "a" }]);
    const segmented = batch("b", "2026-09-16T01:00:00Z", [{ label: "B", pages: [1], matchedStudentId: "b" }], "segmented");
    expect(findUnmarkedBatchStudents([split, segmented], new Set(["a"]))).toEqual([]);
  });

  it("recognises a student confirmed before signing in and marked after", () => {
    const b = batch("g", "2026-09-17T00:00:00Z", [
      { label: "Carla Fenn", pages: [85], matchedStudentId: "invited-kf" },
    ]);
    expect(findUnmarkedBatchStudents([b], new Set(["profile-kf"]), new Map([["invited-kf", "profile-kf"]]))).toEqual([]);
    expect(findUnmarkedBatchStudents([b], new Set())).toHaveLength(1);
  });

  it("recovers a student confirmed in two uploads from the newer one, whatever order the rows come in", () => {
    const older = batch("old", "2026-09-14T20:00:00Z", [{ label: "S", pages: [73], matchedStudentId: "s" }]);
    const newer = batch("new", "2026-09-16T18:39:00Z", [
      { label: "S", pages: [9], matchedStudentId: "s", storagePath: "t/s/2.pdf" },
    ]);
    const [flagged, ...rest] = findUnmarkedBatchStudents([older, newer], new Set());
    expect(rest).toEqual([]);
    expect(flagged).toMatchObject({ batchId: "new", pages: [9], storagePath: "t/s/2.pdf" });
  });

  it("reads segments split before outcomes were recorded as having no stored scan on record", () => {
    const legacy = batch("legacy", "2026-09-15T00:00:00Z", [{ label: "L", pages: [1, 2], matchedStudentId: "l" }]);
    expect(findUnmarkedBatchStudents([legacy], new Set())).toEqual([
      { studentId: "l", batchId: "legacy", fileName: "legacy.pdf", label: "L", pages: [1, 2], storagePath: null, splitError: null },
    ]);
  });
});

describe("formatPageRanges", () => {
  it("collapses runs and keeps singles, whatever order or repeats come in", () => {
    expect(formatPageRanges([157, 158, 159, 160, 161, 162, 163, 164, 165, 166, 167, 168])).toBe("157-168");
    expect(formatPageRanges([7, 1, 2, 3, 3])).toBe("1-3, 7");
    expect(formatPageRanges([5])).toBe("5");
    expect(formatPageRanges([])).toBe("");
  });
});
