import { describe, expect, it } from "vitest";
import { applyBlankPages, BlankPageCheckSchema, isConfidentlyBlank } from "./blank-pages";

describe("isConfidentlyBlank", () => {
  it("only drops a page on a high-confidence blank verdict", () => {
    expect(isConfidentlyBlank({ isBlank: true, confidence: "high", note: "" })).toBe(true);
    expect(isConfidentlyBlank({ isBlank: true, confidence: "medium", note: "" })).toBe(false);
    expect(isConfidentlyBlank({ isBlank: true, confidence: "low", note: "" })).toBe(false);
    expect(isConfidentlyBlank({ isBlank: false, confidence: "high", note: "" })).toBe(false);
  });
});

describe("applyBlankPages", () => {
  it("moves confirmed pages from unassigned to blank, sorted and deduplicated", () => {
    const result = applyBlankPages({ blankPages: [48], unassignedPages: [36, 12, 24, 48] }, [24, 12, 12]);
    expect(result).toEqual({ blankPages: [12, 24, 48], unassignedPages: [36] });
  });

  it("leaves everything alone when nothing was confirmed", () => {
    expect(applyBlankPages({ blankPages: [], unassignedPages: [5] }, [])).toEqual({
      blankPages: [],
      unassignedPages: [5],
    });
  });
});

describe("BlankPageCheckSchema", () => {
  it("defaults the note and rejects an unknown confidence", () => {
    expect(BlankPageCheckSchema.parse({ isBlank: true, confidence: "high" }).note).toBe("");
    expect(BlankPageCheckSchema.safeParse({ isBlank: true, confidence: "certain" }).success).toBe(false);
  });
});
