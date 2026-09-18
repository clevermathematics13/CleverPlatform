import { describe, it, expect } from "vitest";
import {
  G9_FORMATIVE_ASSESSMENT_MARKING_PRINCIPLES,
  G9_STANDARD_LEVEL_MARKING_PRINCIPLES,
  buildGradingSystemPrompt,
  type GradingUnit,
} from "./ai-grading";
import { KA1_UNIT1_RUBRIC } from "./fixtures/g9-standard-ka1-unit1";

/**
 * The marking half of ask-what-you-mark, pinned across EVERY policy that
 * governs a teacher-authored mark scheme.
 *
 * lib/ask-what-you-mark.ts stops a generator writing a scheme that demands
 * more than its question asks. Its other half is a rule for the MARKER, so
 * that a mismatch already printed on a paper students have sat does not cost
 * them marks. That half was written once, as section 8 of the Formative
 * Assessment principles -- and then Grade 9 Standard Level arrived with a
 * policy that REPLACES the Formative principles rather than adding to them
 * (see buildGradingSystemPrompt), so every Standard Level paper was marked
 * without it.
 *
 * KA1 Unit 1 Q9(a) is what that cost. The part printed "Describe how the
 * visual pattern is changing"; its scheme awarded a mark "for naming which
 * parts grow and by how much (2 in the row, 1 in the column)". Of 15
 * students, 12 described the growth correctly in their own words and 9 of
 * those were marked down for the vocabulary -- one answer scoring 0 and a
 * near-identical one scoring 2. None of that is mathematics.
 *
 * So this file does not test a policy. It tests the INVARIANT that a new
 * marking policy cannot ship without the clause: a third policy added beside
 * these two fails here until it carries one too.
 */

const POLICIES: ReadonlyArray<readonly [string, string]> = [
  ["Formative Assessment (Grade 9 Extended)", G9_FORMATIVE_ASSESSMENT_MARKING_PRINCIPLES],
  ["Grade 9 Standard Level", G9_STANDARD_LEVEL_MARKING_PRINCIPLES],
];

describe("every teacher-authored marking policy carries the clause", () => {
  it.each(POLICIES)("%s states that a scheme may not require what the question did not ask", (_name, policy) => {
    expect(policy).toContain("A mark scheme may not require what the question did not ask");
  });

  it.each(POLICIES)("%s tells the marker not to withhold the mark for the unasked thing", (_name, policy) => {
    expect(policy).toMatch(/do not withhold the mark for its\s+absence/);
    // The clause has to keep its own limit, or it reads as a licence to
    // waive any requirement: a part that DOES ask for two things still
    // requires two.
    expect(policy).toMatch(/Where the part DOES ask for both things/);
  });

  it.each(POLICIES)("%s names it as a failure to guess, not a mathematical failure", (_name, policy) => {
    expect(policy).toContain("This is not leniency");
    expect(policy).toMatch(/failure to guess an unstated\s+requirement/);
  });
});

describe("the clause reaches the prompt a Standard Level paper is marked under", () => {
  function standardsUnit(): GradingUnit {
    return {
      testItemId: "item-9a",
      questionNumber: 9,
      partLabel: "a",
      maxMarks: 2,
      questionCode: "Q9(a)",
      questionLatex: "",
      questionText: "Describe how the visual pattern is changing.",
      markScheme: "A full-mark response describes where the new tiles go.",
      markschemeSource: "custom",
      curriculum: "MYP",
      level: "STANDARD",
      paper: null,
      standards: { rubric: KA1_UNIT1_RUBRIC, strand: null },
    } as unknown as GradingUnit;
  }

  it("is in the system prompt built for a paper with a standards rubric", () => {
    const prompt = buildGradingSystemPrompt([standardsUnit()]);
    expect(prompt).toContain("A mark scheme may not require what the question did not ask");
  });

  it("uses Q9(a)'s own vocabulary as the worked example, so the rule is not abstract", () => {
    // A marker who has just read "2 tiles to the row and 1 to the column"
    // in a scheme needs to recognise the shape, not infer it.
    expect(G9_STANDARD_LEVEL_MARKING_PRINCIPLES).toContain("Describe how the visual pattern is changing");
    expect(G9_STANDARD_LEVEL_MARKING_PRINCIPLES).toContain("2 tiles to the row and 1 to the column");
    expect(G9_STANDARD_LEVEL_MARKING_PRINCIPLES).toMatch(/one on the right and one on the bottom/i);
  });
});
