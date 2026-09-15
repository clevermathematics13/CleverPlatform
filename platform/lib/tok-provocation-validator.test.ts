/**
 * tok-provocation-validator.test.ts
 * -----------------------------------------------------------------------------
 * The load-bearing test here is "leaves a good provocation alone". This
 * validator is a soft warning about writing the teacher can read for
 * themselves, so a false positive is the expensive failure -- it teaches them
 * the panel cries wolf, and then it stops catching the cases it is right
 * about. The house exemplar is used as the fixture for that, so the check is
 * against real packet text rather than something written to pass.
 * -----------------------------------------------------------------------------
 */

import { describe, it, expect } from "vitest";
import {
  validateDraftTokProvocations,
  type TokIssue,
} from "./tok-provocation-validator";
import type { AssignmentDraft } from "./assignments";

/** A DP packet on complex numbers, close to NA_GREAT_UNIFICATION_EXEMPLAR.md. */
function draft(overrides: Partial<AssignmentDraft> = {}): AssignmentDraft {
  return {
    title: "The Great Unification",
    subtitle: "IBDP Mathematics — Analysis & Approaches HL",
    syllabusTopics: "Topic 1.13 De Moivre's theorem; Topic 5.7 Maclaurin series",
    instructions: [],
    sections: [
      {
        heading: "Part 1 — Polar form",
        questions: [
          { prompt: "Write down the modulus and argument of $z = 1 + i sqrt(3)$.", marks: 2, tier: 1 },
          { prompt: "Prove De Moivre's theorem by induction.", marks: 5, tier: 2 },
        ],
      },
      {
        heading: "Part 5 — The Maclaurin series",
        questions: [
          { prompt: "Derive the Maclaurin series for $cos theta$ and hence Euler's formula.", marks: 6, tier: 2 },
        ],
      },
    ],
    tokProvocations: [
      {
        id: "tok1",
        body:
          "Euler's identity is routinely voted the most beautiful equation in mathematics. Can aesthetic appeal be evidence of truth, or is beauty a property we project onto results we have already accepted?",
      },
      {
        id: "tok2",
        body:
          "The number $i$ was introduced by definition, as a solution to $x^2 = -1$, to make unsolvable equations solvable. Centuries later it turned out to describe rotation and quantum states. Was $i$ DISCOVERED to have been real all along, or did we INVENT a tool and then find places to use it?",
      },
    ],
    reflectionQuestions: [
      "Draw a concept map linking the Parts of this packet.",
      "Which step of the proof in Part 1 did you find least convincing, and why?",
      "Take and defend a position on one of the two TOK provocations, citing a numbered result from this packet as your evidence.",
    ],
    ...overrides,
  } as AssignmentDraft;
}

const kinds = (issues: TokIssue[]) => issues.map((i) => i.kind);

describe("a good packet is left alone", () => {
  it("passes the house exemplar clean", () => {
    expect(validateDraftTokProvocations(draft(), "Grade 12")).toEqual([]);
  });

  it("does not fire on the exemplar's discovered/invented provocation", () => {
    // It contains DISCOVERED and INVENT, which is the stock T6 question --
    // but reached through $i$ and this packet's own definition, which is
    // exactly what T6 asks for. Flagging it would be the false positive that
    // costs the panel its credibility.
    const only = draft({ tokProvocations: [draft().tokProvocations![1]] });
    expect(kinds(validateDraftTokProvocations(only, "Grade 12"))).not.toContain("stock-opener");
  });

  it("accepts a provocation anchored by a Part reference alone", () => {
    const d = draft({
      tokProvocations: [
        { id: "tok1", body: "Does the second proof in Part 5 make the result more true, or only more believed?" },
        draft().tokProvocations![1],
      ],
    });
    expect(validateDraftTokProvocations(d, "Grade 12")).toEqual([]);
  });
});

describe("the bolted-on provocation", () => {
  it("names the stock question it reads as", () => {
    const d = draft({
      tokProvocations: [
        { id: "tok1", body: "Is mathematics discovered or invented?" },
        draft().tokProvocations![1],
      ],
    });
    const issues = validateDraftTokProvocations(d, "Grade 12");
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("stock-opener");
    expect(issues[0].rule).toBe("T6");
    expect(issues[0].location).toBe("TOK provocation 1");
    expect(issues[0].detail).toContain("Is mathematics discovered or invented?");
  });

  it.each([
    "Is mathematics a universal language, shared across every culture?",
    "Can we ever be certain of anything at all?",
    "Is mathematics the language of the universe?",
  ])("catches %s", (body) => {
    const d = draft({ tokProvocations: [{ id: "tok1", body }, draft().tokProvocations![1]] });
    expect(kinds(validateDraftTokProvocations(d, "Grade 12"))).toEqual(["stock-opener"]);
  });

  it("is not fooled by a word the packet and TOK prose both use", () => {
    // Regression. This provocation was passing as ANCHORED because the packet
    // asks for "the argument of z" and the provocation says "a formal
    // argument" -- two unrelated senses of one word. Any such homonym lets a
    // bolted-on provocation through, which is the whole failure being
    // validated for.
    const d = draft({
      tokProvocations: [
        { id: "tok1", body: "How far should intuition be trusted when it conflicts with a formal argument?" },
        draft().tokProvocations![1],
      ],
    });
    expect(kinds(validateDraftTokProvocations(d, "Grade 12"))).toEqual(["unanchored"]);
  });

  it("reports a generic provocation that is not one of the named stock ones", () => {
    const d = draft({
      tokProvocations: [
        { id: "tok1", body: "How far should intuition be trusted when it conflicts with a formal argument?" },
        draft().tokProvocations![1],
      ],
    });
    const issues = validateDraftTokProvocations(d, "Grade 12");
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("unanchored");
    expect(issues[0].rule).toBe("T1/T5");
  });

  it("reports one issue per provocation, never two", () => {
    // "Is mathematics discovered or invented?" is both stock AND unanchored.
    // Saying so twice would double the noise for one defect.
    const d = draft({
      tokProvocations: [
        { id: "tok1", body: "Is mathematics discovered or invented?" },
        { id: "tok2", body: "Is mathematics a universal language?" },
      ],
    });
    expect(kinds(validateDraftTokProvocations(d, "Grade 12"))).toEqual([
      "stock-opener",
      "stock-opener",
    ]);
  });
});

describe("the count", () => {
  it("flags a packet with no provocations", () => {
    const issues = validateDraftTokProvocations(draft({ tokProvocations: [] }), "Grade 12");
    expect(issues[0].kind).toBe("count");
    expect(issues[0].detail).toContain("no TOK provocations");
  });

  it("flags a packet with one, and says how many it found", () => {
    const d = draft({ tokProvocations: [draft().tokProvocations![1]] });
    const issues = validateDraftTokProvocations(d, "Grade 12");
    expect(issues[0].kind).toBe("count");
    expect(issues[0].detail).toContain("has 1");
  });

  it("flags an empty provocation body", () => {
    const d = draft({
      tokProvocations: [{ id: "tok1", body: "   " }, draft().tokProvocations![1]],
    });
    expect(kinds(validateDraftTokProvocations(d, "Grade 12"))).toContain("count");
  });

  it("survives a draft with no tokProvocations field at all", () => {
    const d = draft({ tokProvocations: undefined });
    expect(() => validateDraftTokProvocations(d, "Grade 12")).not.toThrow();
    expect(kinds(validateDraftTokProvocations(d, "Grade 12"))).toContain("count");
  });
});

describe("the Reflection return (T8)", () => {
  it("flags a Reflection that never comes back to a provocation", () => {
    const d = draft({
      reflectionQuestions: [
        "Draw a concept map linking the Parts of this packet.",
        "Which idea took longest to settle?",
      ],
    });
    expect(kinds(validateDraftTokProvocations(d, "Grade 12"))).toEqual(["no-reflection-return"]);
  });

  it("flags a TOK return that asks for a feeling rather than evidence", () => {
    const d = draft({
      reflectionQuestions: [
        "Draw a concept map linking the Parts of this packet.",
        "How do you feel about the TOK provocations now?",
      ],
    });
    expect(kinds(validateDraftTokProvocations(d, "Grade 12"))).toEqual([
      "reflection-without-evidence",
    ]);
  });

  it("stays quiet when the draft has no Reflection at all", () => {
    // A missing Reflection is a different defect. Reporting it here would
    // double up on a truncated draft.
    const d = draft({ reflectionQuestions: [] });
    expect(validateDraftTokProvocations(d, "Grade 12")).toEqual([]);
  });
});

describe("T9: the provocations are printed before the work, so they cannot contain its answers", () => {
  // The defect that prompted this rule, from the first real generation: a
  // provocation opened "In Part 3 Q1 you will calculate a p-value of 0.0228",
  // printing the answer to Part 3 on page 1. T1 had asked for "the specific
  // number that came out of Q7" as the anchor, while the spec prints the
  // provocations above Part 0 -- the two instructions were in direct conflict.
  function statsDraft(body: string): AssignmentDraft {
    return {
      title: "From Bell Curve to Decision",
      subtitle: "IBDP Mathematics",
      instructions: [],
      sections: [
        {
          heading: "Part 2 \u2014 The Test Statistic",
          questions: [
            {
              prompt: "A sample of 25 bags gives a sample mean of 496.8 grams against a designed mean of 500 grams. Calculate the test statistic.",
              marks: 3,
              tier: 2,
              answer: "$z = (496.8-500)/1.6 = -2.0$",
            },
          ],
        },
        {
          heading: "Part 3 \u2014 The p-value",
          questions: [
            {
              prompt: "Using the test statistic from Part 2, calculate the p-value, correct to 3 significant figures.",
              marks: 2,
              tier: 2,
              answer: "$p = P(Z<-2.0) = 0.0228$ (3 s.f.)",
            },
          ],
        },
      ],
      tokProvocations: [
        { id: "tok1", body },
        { id: "tok2", body: "Does the 5% significance level in Part 2 describe the machine, or the convention we agreed to judge it by?" },
      ],
      reflectionQuestions: [
        "Take a position on a TOK provocation, citing the p-value you found in Part 3 as your evidence.",
      ],
    } as AssignmentDraft;
  }

  it("flags a provocation that prints an answer, and names the question it belongs to", () => {
    const d = statsDraft("In Part 3 you will calculate a p-value of 0.0228. Does that number demonstrate the machine underfills, or only that the data would be surprising if it did not?");
    const issues = validateDraftTokProvocations(d, "Grade 12");
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("leaks-answer");
    expect(issues[0].rule).toBe("T9");
    expect(issues[0].detail).toContain("0.0228");
    expect(issues[0].detail).toContain("Part 3 Q1");
  });

  it("leaves alone a number the packet GIVES the student", () => {
    // 496.8 and 500 are handed over in the Part 2 prompt. Quoting given data
    // is how a provocation anchors -- flagging it would gut T1.
    const d = statsDraft("Part 2 measures a sample mean of 496.8 grams against a designed mean of 500 grams. Does a gap that small describe the machine, or the sample?");
    expect(validateDraftTokProvocations(d, "Grade 12")).toEqual([]);
  });

  it("leaves alone a hypothetical the provocation invents", () => {
    // "0.012" appears nowhere in the packet: it is the provocation's own
    // thought experiment, not a leak.
    const d = statsDraft("If the test in Part 3 had returned 0.012 rather than the value you will find, the verdict would flip. Is that boundary a feature of the process, or a convention?");
    expect(validateDraftTokProvocations(d, "Grade 12")).toEqual([]);
  });

  it("accepts a forward reference that names the quantity but not its value", () => {
    // This is what T9 asks for, and it must stay legal -- pointing forward is
    // how a provocation tells the student where the tension will bite.
    const d = statsDraft("In Part 3 you will calculate a p-value for this test. Will a small one demonstrate that the machine underfills, or only that the data would be surprising if it did not?");
    expect(validateDraftTokProvocations(d, "Grade 12")).toEqual([]);
  });

  it("does not police the Reflection, which comes after the work", () => {
    // The fixture's reflection cites the Part 3 result on purpose: T8 requires
    // exactly that, and T9 explicitly exempts it.
    const d = statsDraft("Does the 1% threshold in Part 3 describe the world, or our agreement about it?");
    expect(validateDraftTokProvocations(d, "Grade 12")).toEqual([]);
  });

  it("stays quiet on a packet with no answer key at all", () => {
    const d = statsDraft("In Part 3 you will calculate a p-value of 0.0228.");
    for (const s of d.sections) for (const q of s.questions) delete (q as { answer?: string }).answer;
    expect(validateDraftTokProvocations(d, "Grade 12")).toEqual([]);
  });
});

describe("pre-DP grades are not held to the bar", () => {
  it.each(["Grade 9", "Grade 10"])("%s returns no issues even on a bad draft", (grade) => {
    const d = draft({
      tokProvocations: [{ id: "tok1", body: "Is mathematics discovered or invented?" }],
      reflectionQuestions: ["How do you feel about maths?"],
    });
    expect(validateDraftTokProvocations(d, grade)).toEqual([]);
  });

  it("still checks Grade 11", () => {
    const d = draft({
      tokProvocations: [
        { id: "tok1", body: "Is mathematics discovered or invented?" },
        draft().tokProvocations![1],
      ],
    });
    expect(validateDraftTokProvocations(d, "Grade 11")).toHaveLength(1);
  });
});
