import { describe, it, expect } from "vitest";
import {
  G9_FORMATIVE_ASSESSMENT_MARKING_PRINCIPLES,
  G9_STANDARD_LEVEL_MARKING_PRINCIPLES,
  buildGradingSystemPrompt,
  type GradingUnit,
} from "./ai-grading";
import { KA1_UNIT1_ITEMS, KA1_UNIT1_RUBRIC } from "./fixtures/g9-standard-ka1-unit1";

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

/**
 * A part's demands are written down in THREE places, and the grading prompt
 * carries all three: the part's own mark scheme, the STRAND DESCRIPTOR for
 * the strand it belongs to, and the marking policy. The 18 Sep fix corrected
 * the first and missed the other two, so both demands it withdrew from Q7(d)
 * and Q9(c) were still live guidance in the same prompt as the corrected
 * schemes -- and section 5 tells the grader to mark part-way answers against
 * exactly those descriptors.
 *
 * Nothing caught that, because nothing reads the descriptors and the schemes
 * together. This does. It is deliberately specific rather than clever: a
 * general "no descriptor exceeds its parts" check would need to understand
 * the mathematics, while these three strings are the actual demands that
 * actually cost students marks, and a reseed or a hand-edit that brings any
 * of them back is the regression worth failing on.
 */
describe("a strand descriptor may not re-impose a withdrawn demand", () => {
  const descriptorText = KA1_UNIT1_RUBRIC.strands
    .flatMap((s) => Object.values(s.descriptors ?? {}))
    .join("\n");

  it.each([
    // Q9(a): the clause that scored "left, right and bottom" 0 and "each side
    // and the bottom" 2. Withdrawn from the scheme; it lived on in strand C.
    ["naming which parts grow", "Q9(a) vocabulary demand"],
    // Q7(d): the question asks whether it works for all x, never for the
    // condition under which it does. Withdrawn; it lived on in strand D.
    ["correct condition for whole-number groups", "Q7(d) unasked condition"],
    // Q9(c): the question asks for a link to the student's OWN part (a).
    ["links 3n and +1 to parts of the figure", "Q9(c) link to the official figure"],
  ])("no descriptor still carries the %s", (withdrawn) => {
    expect(descriptorText).not.toContain(withdrawn);
  });

  it("and the schemes they were withdrawn from have not regained them", () => {
    const scheme = (n: number, p: string) =>
      KA1_UNIT1_ITEMS.find((i) => i.questionNumber === n && i.partLabel === p)!.markschemeText;

    // Q9(a) must say, in some form, that the wording is not the thing marked.
    expect(scheme(9, "a")).toMatch(/not the vocabulary|Do not require the words/);
    // Q7(d) must not require the condition on top of a counterexample.
    expect(scheme(7, "d")).toMatch(/does NOT ask for the condition/);
    // Q9(c) must judge the link against the student's own part (a).
    expect(scheme(9, "c")).toMatch(/OWN answer to part \(a\)/);
  });

  it("section 5 subordinates a descriptor to the part's own scheme", () => {
    // Without this, a stale descriptor and a corrected scheme sit in one
    // prompt with nothing saying which one wins.
    expect(G9_STANDARD_LEVEL_MARKING_PRINCIPLES).toContain(
      "A descriptor never outranks the part's own mark scheme"
    );
    expect(G9_STANDARD_LEVEL_MARKING_PRINCIPLES).toMatch(
      /the scheme wins and the descriptor is stale/
    );
  });

  it("section 5 no longer cites a guess-and-check cap the rubric dropped", () => {
    // Q8's live scheme says "do not cap it, and do not call it
    // guess-and-check". Section 5 used to tell the grader the opposite.
    expect(G9_STANDARD_LEVEL_MARKING_PRINCIPLES).not.toContain(
      '"guess-and-check" for the equivalent-expressions question is'
    );
    expect(
      KA1_UNIT1_RUBRIC.strands.find((s) => s.code === "A")!.descriptors?.approaching ?? ""
    ).not.toContain("guess-and-check");
  });
});
