import { describe, it, expect } from "vitest";
import { isGrade9Course } from "./course-level";

describe("isGrade9Course", () => {
  it("matches the live Grade 9 class codes", () => {
    expect(isGrade9Course("9A")).toBe(true);
    expect(isGrade9Course("9C")).toBe(true);
    expect(isGrade9Course("9G")).toBe(true);
  });

  it("matches archived variants that carry a year suffix", () => {
    expect(isGrade9Course("9A (2025-2026)")).toBe(true);
    expect(isGrade9Course("9D (2025-2026)")).toBe(true);
  });

  it("matches the virtual Grade 9 courses", () => {
    expect(isGrade9Course("Grade 9 Extended")).toBe(true);
    expect(isGrade9Course("Grade 9 Standard")).toBe(true);
  });

  it("does not match DP course codes", () => {
    expect(isGrade9Course("27AH")).toBe(false);
    expect(isGrade9Course("26AH")).toBe(false);
    expect(isGrade9Course("28IH")).toBe(false);
  });

  it("does not match a leading 9 followed by a longer word", () => {
    // guards against a future "9Ext"-style code silently becoming Grade 9
    expect(isGrade9Course("9Ext")).toBe(false);
    expect(isGrade9Course("9Extended")).toBe(false);
  });

  it("tolerates surrounding whitespace and casing", () => {
    expect(isGrade9Course("  9a  ")).toBe(true);
    expect(isGrade9Course("GRADE 9 EXTENDED")).toBe(true);
  });
});
