import { describe, expect, it } from "vitest";
import { canCopySourceWhole } from "./batch-split";

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
