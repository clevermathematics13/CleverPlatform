import { describe, expect, it } from "vitest";
import {
  promptContainsCommandTerm,
  validateDraftCommandTerms,
} from "./command-term-validator";
import { buildActivityGeneratorSystemPrompt, type AssignmentDraft } from "./assignments";

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

describe("rule 11c's named exceptions", () => {
  // These three read like instructions and are not on the canonical list.
  // "Expand" and a bare "Write" were found by the validator on a real
  // generated packet on the binomial theorem, where rule 11c banned them and
  // register rule R1 ("you simplify, expand, factor or evaluate an
  // EXPRESSION") endorsed them -- two rules in one prompt pulling opposite
  // ways. 11c now names all three and says what to write instead.
  const prompt = buildActivityGeneratorSystemPrompt("Grade 12");

  it.each(["Simplify", "Expand", "Evaluate", "Factor", "Write down"])("11c names %s", (word) => {
    const rule = prompt.slice(prompt.indexOf("11c."), prompt.indexOf("11b."));
    expect(rule).toContain(word);
  });

  it("says the register and the canonical list are not in conflict", () => {
    const rule = prompt.slice(prompt.indexOf("11c."), prompt.indexOf("11b."));
    expect(rule).toMatch(/does NOT overrule the mathematical register/);
  });

  it("rejects the two phrasings a real packet actually shipped", () => {
    // Verbatim from the generated induction packet.
    expect(
      promptContainsCommandTerm(
        "Expand $(1+x)^4$ using the binomial theorem, writing each coefficient as a value of $C(4,k)$.",
      ),
    ).toBe(false);
    expect(
      promptContainsCommandTerm("Write $7^n$ as $(1+6)^n$ and use the binomial theorem to expand it."),
    ).toBe(false);
    // Found by the regeneration after the first fix: the same class, a third
    // instance. All four register verbs are non-canonical, not just two.
    expect(promptContainsCommandTerm("Evaluate $4!$.")).toBe(false);
    expect(promptContainsCommandTerm("Factorise $x^2-5x+6$.")).toBe(false);
  });

  it("accepts every replacement the rule recommends", () => {
    // The load-bearing one: advice that does not itself pass the validator
    // would swap one broken question for another.
    const fixed = [
      "Find the expansion of $(1+x)^4$, writing each coefficient as a value of $C(4,k)$.",
      "Write down the expansion of $(1+x)^4$ in ascending powers of $x$.",
      "Write down $7^n$ in the form $(1+6)^n$.",
      "Solve, giving your answer as a fraction in its lowest terms.",
      "Calculate the value, giving your answer in its simplest form.",
      "Calculate $4!$.",
      "Find the value of $4!$.",
      "Find the factors of $x^2-5x+6$.",
      "Show that $x^2-5x+6=(x-2)(x-3)$.",
    ];
    for (const text of fixed) {
      expect(promptContainsCommandTerm(text), `rule 11c recommends but validator rejects: ${text}`).toBe(true);
    }
  });

  it("still allows the register's words in prose and as nouns", () => {
    // R1 keeps "expand" as the right word for the operation; only the
    // imperative is constrained. A question may say both.
    expect(
      promptContainsCommandTerm("Find the expansion of $(2+x)^5$ by expanding the bracket term by term."),
    ).toBe(true);
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
