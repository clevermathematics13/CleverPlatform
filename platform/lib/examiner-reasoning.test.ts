import { describe, expect, it } from "vitest";
import { findExposedDeliberation, findHedgedReading } from "./examiner-reasoning";

describe("findExposedDeliberation", () => {
  it("returns no hits for clean, settled professional reasoning", () => {
    const clean =
      "a = 0.81 is given to only 2 significant figures; a = 0.805 to 3 significant figures is required, so A1 is not awarded. b = 2.88 is correct to 3 significant figures, so A1 is awarded.";
    expect(findExposedDeliberation(clean)).toEqual([]);
    expect(findHedgedReading(clean)).toEqual([]);
  });

  it("returns no hits for the target-style combined example", () => {
    const clean =
      "8.515 is consistent with substituting x = 7 into the accepted equation y = 0.805x + 2.88, so the implied method mark is awarded. This is consistent with the required answer 8.52 to 3 significant figures, so A1 is awarded.";
    expect(findExposedDeliberation(clean)).toEqual([]);
    expect(findHedgedReading(clean)).toEqual([]);
  });

  it("returns an empty array for empty or missing text", () => {
    expect(findExposedDeliberation("")).toEqual([]);
    expect(findHedgedReading("")).toEqual([]);
  });

  it.each([
    ["reconsider", "8.515 rounds to 8.52 at 3sf so this should earn the mark. Let me reconsider it."],
    ["let me", "Let me reconsider this calculation."],
    ["on second thought", "On second thought, this should be awarded."],
    ["actually,", "Actually, this should be A1."],
    ["wait,", "Wait, that's not right."],
    ["I need to check", "I need to check this again."],
    ["at first", "At first this looks incorrect, but it is fine."],
    ["I thought", "I initially thought this was wrong."],
  ])("treats %j as exposed deliberation", (_label, text) => {
    expect(findExposedDeliberation(text).length).toBeGreaterThan(0);
    expect(findHedgedReading(text)).toEqual([]);
  });

  it.each([
    ["appears to", "8.515 appears to use the correct full precision value."],
    ["seems to", "The student seems to have divided rather than factored."],
    ["probably", "The student probably used the correct method."],
    ["maybe", "Maybe this earns the mark."],
    ["I think", "I think this earns the mark."],
    ["I believe", "I believe the working supports the answer."],
  ])("treats %j as hedging, not deliberation", (_label, text) => {
    expect(findHedgedReading(text).length).toBeGreaterThan(0);
    expect(findExposedDeliberation(text)).toEqual([]);
  });

  // Regression: "doesn't match" used to be a banned phrase. Measured over a
  // full class it produced 35 flags and zero real problems, because it is
  // ordinary settled examiner English -- and on the two parts that ask a
  // student to explain why one expression does not match another, a correct
  // answer's reasoning cannot avoid it. See the module header.
  it("does not flag 'doesn't match', which is settled examiner English", () => {
    const settled = "The student's value doesn't match the mark scheme, so A1 is not awarded.";
    expect(findExposedDeliberation(settled)).toEqual([]);
    expect(findHedgedReading(settled)).toEqual([]);

    const subjectMatter =
      "The student explained that 78mn doesn't match the context because mn doesn't represent the cost per box. R1 awarded.";
    expect(findExposedDeliberation(subjectMatter)).toEqual([]);
    expect(findHedgedReading(subjectMatter)).toEqual([]);
  });

  // The real production text this module exists to catch (verbatim, from a
  // live graded result -- see ai-grading.ts's rule 18 and validateGradeResponse).
  it("detects the real observed production failure verbatim", () => {
    const real =
      "Part (c): 8.515 appears to use correct full precision value giving 8.51693..., student reports 8.515 which rounds to 8.52 - however reconsidering, 8.515 rounds to 8.52 at 3sf so this should earn the mark. Let me reconsider: 8.515 to 3sf is 8.52, which matches mark scheme.";
    const hits = findExposedDeliberation(real);
    expect(hits).toContain("reconsider");
    expect(hits).toContain("let me");
    // The same text also hedges; that is reported separately now.
    expect(findHedgedReading(real)).toContain("appears to");
  });

  // The one true positive from the Formative Assessment 1 class run: a
  // mark_breakdown note on an AWARDED A1 that contradicted the award.
  it("detects the production 'wait,' note that contradicted its own award", () => {
    const note = "Correct values: 48(1)+30(2)=108... wait, student wrote 78 not 108";
    expect(findExposedDeliberation(note)).toContain("wait,");
  });
});
