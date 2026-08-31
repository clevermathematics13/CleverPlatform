import { describe, expect, it } from "vitest";
import { findExposedDeliberation } from "./examiner-reasoning";

describe("findExposedDeliberation", () => {
  it("returns no hits for clean, settled professional reasoning", () => {
    const clean =
      "a = 0.81 is given to only 2 significant figures; a = 0.805 to 3 significant figures is required, so A1 is not awarded. b = 2.88 is correct to 3 significant figures, so A1 is awarded.";
    expect(findExposedDeliberation(clean)).toEqual([]);
  });

  it("returns no hits for the target-style combined example", () => {
    const clean =
      "8.515 is consistent with substituting x = 7 into the accepted equation y = 0.805x + 2.88, so the implied method mark is awarded. This is consistent with the required answer 8.52 to 3 significant figures, so A1 is awarded.";
    expect(findExposedDeliberation(clean)).toEqual([]);
  });

  it("returns an empty array for empty or missing text", () => {
    expect(findExposedDeliberation("")).toEqual([]);
  });

  // The exact required test list from the spec.
  it.each([
    ["reconsider", "8.515 rounds to 8.52 at 3sf so this should earn the mark. Let me reconsider it."],
    ["let me", "Let me reconsider this calculation."],
    ["appears to", "8.515 appears to use the correct full precision value."],
    ["on second thought", "On second thought, this should be awarded."],
    ["I think", "I think this earns the mark."],
    ["probably", "The student probably used the correct method."],
    ["doesn't match", "0.81 doesn't match 0.805."],
  ])("detects the banned phrase %j", (_label, text) => {
    expect(findExposedDeliberation(text).length).toBeGreaterThan(0);
  });

  // The real production text this module exists to catch (verbatim, from a
  // live graded result -- see ai-grading.ts's rule 18 and validateGradeResponse).
  it("detects the real observed production failure verbatim", () => {
    const real =
      "Part (c): 8.515 appears to use correct full precision value giving 8.51693..., student reports 8.515 which rounds to 8.52 - however reconsidering, 8.515 rounds to 8.52 at 3sf so this should earn the mark. Let me reconsider: 8.515 to 3sf is 8.52, which matches mark scheme.";
    const hits = findExposedDeliberation(real);
    expect(hits).toContain("appears to");
    expect(hits).toContain("reconsider");
    expect(hits).toContain("let me");
    expect(hits.length).toBeGreaterThanOrEqual(3);
  });

  it("detects other listed hedging/self-correction phrases", () => {
    expect(findExposedDeliberation("Actually, this should be A1.").length).toBeGreaterThan(0);
    expect(findExposedDeliberation("Wait, that's not right.").length).toBeGreaterThan(0);
    expect(findExposedDeliberation("I need to check this again.").length).toBeGreaterThan(0);
    expect(findExposedDeliberation("At first this looks incorrect, but it is fine.").length).toBeGreaterThan(0);
    expect(findExposedDeliberation("I initially thought this was wrong.").length).toBeGreaterThan(0);
    expect(findExposedDeliberation("Maybe this earns the mark.").length).toBeGreaterThan(0);
  });
});
