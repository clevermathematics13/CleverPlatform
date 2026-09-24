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
    ["wait -", "Wait - this is correct!"],
    ["wait - (em dash)", "Wait \u2014 the scope says 3 marks for this crop."],
    ["re-examining", "Re-examining: 7x/10 = 7 multiplied by 10 gives 7x = 70."],
    ["looking again", "Looking again, the student wrote 6m - 6."],
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

  // Two Key Assessment 1 reasonings that changed their minds unflagged, verbatim:
  // Q10(c) settled on 0 while its breakdown awarded A1, and Q5(a) said "correct"
  // on a 0/1.
  it("detects the Q10(c) and Q5(a) self-corrections that went unflagged", () => {
    const q10c =
      "The student combined -5ab² + 11ab² = 6ab² and 8b - 3b = 5b, giving 6ab² + 5b (written as 6ab² - 5b appears to be a sign error in my reading, but looking again: 8b - 3b = 5b, so should be +5b). The student wrote 6ab² - 5b which would be incorrect. Re-examining: the student wrote '6ab² - 5b'. Since 8b - 3b = 5b, the answer should be 6ab² + 5b. The student has -5b which is wrong.";
    expect(findExposedDeliberation(q10c)).toEqual(["re-examining", "looking again"]);
    expect(findHedgedReading(q10c)).toEqual(["appears to"]);

    const q5a =
      "'Eight less than six times a number m' means 6m - 8. The student wrote 6m - 8, which is correct. Student wrote 6m - 8 but the correct answer is 6m - 8. Wait - this is correct!";
    expect(findExposedDeliberation(q5a)).toEqual(["wait -"]);
  });

  it("names the new phrases in any of their spellings", () => {
    expect(findExposedDeliberation("Wait - re-examining: the expression should be 6m - 8.")).toEqual([
      "wait -",
      "re-examining",
    ]);
    for (const text of ["Wait \u2014 no.", "wait\u2014no", "Wait \u2013 no.", "Wait- no.", "but wait -"]) {
      expect(findExposedDeliberation(text)).toEqual(["wait -"]);
    }
    for (const text of ["Re-examine the working.", "On re-examining it, A1 stands.", "Reexamined: correct."]) {
      expect(findExposedDeliberation(text)).toEqual(["re-examining"]);
    }
  });

  // "wait" is a word a question can use. Only the punctuation of a reversal
  // is matched, never the word, so a word problem about queues is not flagged.
  it("does not flag 'wait' used as an ordinary word", () => {
    for (const text of [
      "The student found the mean wait-time correctly, so A1 is awarded.",
      "The students wait 5 minutes each, so 5n is correct.",
      "The waiting time of 12 minutes is correct.",
      "The change is wait -5 degrees, as the student wrote.",
      "The student will await the second result; A1 is awarded for the first.",
    ]) {
      expect(findExposedDeliberation(text)).toEqual([]);
    }
  });
});
