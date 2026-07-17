import { describe, expect, it } from "vitest";
import {
  promptContainsCommandTerm,
  validateDraftCommandTerms,
} from "./command-term-validator";
import type { AssignmentDraft } from "./assignments";

describe("promptContainsCommandTerm", () => {
  it("accepts a canonical capitalized command term", () => {
    expect(promptContainsCommandTerm("Find the value of k.")).toBe(true);
    expect(promptContainsCommandTerm("Write down the coordinates of P.")).toBe(true);
    expect(promptContainsCommandTerm("Hence or otherwise, solve for x.")).toBe(true);
  });

  it("accepts a lowercase unambiguous verb mid-sentence", () => {
    expect(
      promptContainsCommandTerm("Using your answer to part (a), find the value of k."),
    ).toBe(true);
    expect(
      promptContainsCommandTerm("Use the substitution u = 2x to integrate the expression."),
    ).toBe(true);
  });

  it("accepts a lowercase noun-ambiguous term when led in imperatively", () => {
    expect(
      promptContainsCommandTerm("Solve the equation and state the number of solutions."),
    ).toBe(true);
    expect(promptContainsCommandTerm("Differentiate f and hence sketch its gradient.")).toBe(true);
  });

  it("REGRESSION: rejects the truncated five-number-summary archetype", () => {
    // Mirrors Q36/Q55 from "The Anatomy of a Dataset": setup only, hint-adjacent
    // noun mentions ("box plot"), and no instruction sentence at all.
    const truncated =
      "The five-number summaries of the reaction times for two groups are given " +
      "below, together with a box plot for each group.";
    expect(promptContainsCommandTerm(truncated)).toBe(false);
  });

  it("rejects noun uses of ambiguous terms in setup text", () => {
    expect(promptContainsCommandTerm("The initial state of the system is given below.")).toBe(false);
    expect(promptContainsCommandTerm("A list of the recorded values appears in the table.")).toBe(false);
  });

  it("does not match inside longer words", () => {
    // "shows" must not satisfy "Show"; "stated" must not satisfy "State".
    expect(promptContainsCommandTerm("The diagram shows a circle with centre O.")).toBe(false);
    expect(promptContainsCommandTerm("The values stated in the table are exact.")).toBe(false);
  });

  it("rejects empty and whitespace-only prompts", () => {
    expect(promptContainsCommandTerm("")).toBe(false);
    expect(promptContainsCommandTerm("   ")).toBe(false);
  });
});

describe("validateDraftCommandTerms", () => {
  const baseDraft = (overrides: Partial<AssignmentDraft>): AssignmentDraft => ({
    title: "Test",
    subtitle: "Mathematics",
    instructions: ["Show working."],
    sections: [],
    ...overrides,
  });

  it("returns no issues for a clean draft", () => {
    const draft = baseDraft({
      sections: [
        {
          heading: "Part 1 — Foundations",
          questions: [
            { prompt: "Calculate the mean of the data set.", marks: 2 },
            {
              prompt: "The function f is defined by f(x) = x^2.",
              marks: 4,
              subparts: [
                { prompt: "Sketch the graph of f.", marks: 2 },
                { prompt: "Hence solve f(x) = 4.", marks: 2 },
              ],
            },
          ],
        },
      ],
    });
    expect(validateDraftCommandTerms(draft)).toEqual([]);
  });

  it("flags a subpart missing a command term while exempting the stem", () => {
    const draft = baseDraft({
      sections: [
        {
          heading: "Part 2 — Reading the Data",
          questions: [
            {
              prompt: "A survey recorded the heights of 40 students.",
              subparts: [
                { prompt: "Find the median height." },
                { prompt: "The tallest student in the sample was 1.94 m." },
              ],
            },
          ],
        },
      ],
    });
    const issues = validateDraftCommandTerms(draft);
    expect(issues).toHaveLength(1);
    expect(issues[0].location).toBe("Part 2 — Reading the Data, Q1(b)");
    expect(issues[0].kind).toBe("subpart");
  });

  it("flags a top-level question with setup text but no instruction", () => {
    const draft = baseDraft({
      sections: [
        {
          heading: "Part 3 — Comparing Distributions",
          questions: [
            {
              prompt:
                "The five-number summaries of two data sets are shown, with a box plot for each.",
              marks: 4,
              hint: "Consider the medians, IQRs, and extremes.",
            },
          ],
        },
      ],
    });
    const issues = validateDraftCommandTerms(draft);
    expect(issues).toHaveLength(1);
    expect(issues[0].location).toBe("Part 3 — Comparing Distributions, Q1");
    expect(issues[0].promptTail.length).toBeGreaterThan(0);
  });
});
