import { describe, expect, it } from "vitest";
import {
  extractLeadingQuestionNumber,
  extractPartNumber,
  extractQuestionCitations,
  validateDraftNumbering,
} from "./numbering-validator";

function draft(sections: Array<{ heading: string; prompts: string[] }>) {
  return {
    sections: sections.map((s) => ({
      heading: s.heading,
      questions: s.prompts.map((prompt) => ({ prompt })),
    })),
  };
}

describe("extractLeadingQuestionNumber", () => {
  it("recognizes the common leading-number shapes", () => {
    expect(extractLeadingQuestionNumber("12. Find the mean.")).toBe(12);
    expect(extractLeadingQuestionNumber("12) Find the mean.")).toBe(12);
    expect(extractLeadingQuestionNumber("Q12. Find the mean.")).toBe(12);
    expect(extractLeadingQuestionNumber("Question 12. Find the mean.")).toBe(12);
    expect(extractLeadingQuestionNumber("**3.** State the mode.")).toBe(3);
    expect(extractLeadingQuestionNumber("  7: Sketch the box plot.")).toBe(7);
  });

  it("returns null for prompts without a leading number", () => {
    expect(extractLeadingQuestionNumber("Find the mean of the data set.")).toBeNull();
    expect(extractLeadingQuestionNumber("The 12 values below were recorded.")).toBeNull();
    expect(extractLeadingQuestionNumber("")).toBeNull();
  });

  it("ignores dotted section-relative labels like 3.2", () => {
    expect(extractLeadingQuestionNumber("3.2 State the median.")).toBeNull();
  });
});

describe("extractPartNumber", () => {
  it("reads Part N from headings", () => {
    expect(extractPartNumber("Part 0 — Before You Begin")).toBe(0);
    expect(extractPartNumber("In Class ▸ Part 3 — The Investigation")).toBe(3);
  });

  it("returns null when there's no Part N", () => {
    expect(extractPartNumber("Reflection")).toBeNull();
    expect(extractPartNumber("Departure Point")).toBeNull();
  });
});

describe("validateDraftNumbering", () => {
  it("returns no issues for a clean consecutive sequence", () => {
    const d = draft([
      { heading: "Part 1 — Foundations", prompts: ["1. Find x.", "2. Find y."] },
      { heading: "Part 2 — Extensions", prompts: ["3. Show that z = 4.", "4. Hence find w."] },
    ]);
    expect(validateDraftNumbering(d)).toEqual([]);
  });

  it("returns no issues when the model embedded no numbers at all", () => {
    const d = draft([
      { heading: "Part 1", prompts: ["Find x.", "Find y."] },
      { heading: "Part 2", prompts: ["Show that z = 4."] },
    ]);
    expect(validateDraftNumbering(d)).toEqual([]);
  });

  it("REGRESSION: flags the Anatomy-of-a-Dataset gap pattern (1, 5, 6, 10, 11)", () => {
    const d = draft([
      {
        heading: "Part 1 — Reading a Dataset",
        prompts: ["1. State the range.", "5. Find the median.", "6. Find the IQR."],
      },
      {
        heading: "Part 2 — Comparisons",
        prompts: ["10. Compare the two summaries.", "11. Hence comment on the spread."],
      },
    ]);
    const issues = validateDraftNumbering(d);
    const gaps = issues.filter((i) => i.kind === "question-gap");
    expect(gaps).toHaveLength(2);
    expect(gaps[0].detail).toContain("jumps from 1 to 5");
    expect(gaps[0].detail).toContain("3 questions");
    expect(gaps[1].detail).toContain("jumps from 6 to 10");
  });

  it("flags duplicate question numbers", () => {
    const d = draft([{ heading: "Part 1", prompts: ["1. Find x.", "2. Find y.", "2. Find z."] }]);
    const issues = validateDraftNumbering(d);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("question-duplicate");
  });

  it("flags a backwards sequence", () => {
    const d = draft([{ heading: "Part 1", prompts: ["4. Find x.", "2. Find y."] }]);
    const issues = validateDraftNumbering(d);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("question-out-of-order");
  });

  it("skips the question check when only one prompt carries a number", () => {
    const d = draft([{ heading: "Part 1", prompts: ["1. Find x.", "Find y.", "Show that z = 4."] }]);
    expect(validateDraftNumbering(d)).toEqual([]);
  });

  it("counts subpart numbers as part of the visible sequence", () => {
    const d = {
      sections: [
        {
          heading: "Part 1",
          questions: [
            { prompt: "1. Consider the data below.", subparts: [{ prompt: "2. State the mode." }, { prompt: "4. Find the mean." }] },
          ],
        },
      ],
    };
    const issues = validateDraftNumbering(d);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("question-gap");
    expect(issues[0].location).toContain("subpart 2");
  });

  it("flags Part heading gaps and duplicates but allows a Part 0 start", () => {
    const clean = draft([
      { heading: "Part 0 — Warm Up", prompts: [] },
      { heading: "Part 1 — Core", prompts: [] },
      { heading: "Part 2 — Extension", prompts: [] },
    ]);
    expect(validateDraftNumbering(clean)).toEqual([]);

    const gappy = draft([
      { heading: "Part 1 — Core", prompts: [] },
      { heading: "Part 4 — Extension", prompts: [] },
    ]);
    const gapIssues = validateDraftNumbering(gappy);
    expect(gapIssues).toHaveLength(1);
    expect(gapIssues[0].kind).toBe("part-gap");

    const duped = draft([
      { heading: "Part 2 — A", prompts: [] },
      { heading: "Part 2 — B", prompts: [] },
    ]);
    const dupIssues = validateDraftNumbering(duped);
    expect(dupIssues).toHaveLength(1);
    expect(dupIssues[0].kind).toBe("part-duplicate");
  });

  it("tolerates malformed drafts without throwing", () => {
    expect(validateDraftNumbering({ sections: [] })).toEqual([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(validateDraftNumbering(null as any)).toEqual([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(validateDraftNumbering({ sections: [null, { heading: 1, questions: null }] } as any)).toEqual([]);
  });
});

describe("extractQuestionCitations", () => {
  it("reads single citations and both endpoints of a range", () => {
    expect(extractQuestionCitations("Complete Q3 and Q12.")).toEqual([3, 12]);
    expect(extractQuestionCitations("Complete Q1-Q7.")).toEqual([1, 7]);
    expect(extractQuestionCitations("Complete Q1–Q7.")).toEqual([1, 7]);
    // Second endpoint without its own Q, which the model writes about half the time.
    expect(extractQuestionCitations("Complete Q9–15.")).toEqual([9, 15]);
    expect(extractQuestionCitations("See Q 4 for the method.")).toEqual([4]);
  });

  it("ignores ordinary numbers, which this prose is full of", () => {
    expect(extractQuestionCitations("8 minutes with a slider; 5 fewer than p.")).toEqual([]);
    expect(extractQuestionCitations("a computer that costs $1,200 before tax")).toEqual([]);
    expect(extractQuestionCitations("")).toEqual([]);
  });

  it("does not read a Q that is part of a longer token", () => {
    expect(extractQuestionCitations("an IQ12 score")).toEqual([]);
  });
});

describe("validateDraftNumbering — prose cross-references", () => {
  // A.2's real compulsory core, which shipped citing questions the packet
  // does not have. See numbering-validator.ts's validateCitations comment.
  const A2_COMPULSORY_CORE =
    "You must complete: Q1–Q7, Q9–Q15, Q17–Q20, Q22, Q23, Q25, Q26. " +
    "Everything marked ★★★ is a genuine challenge. Partial working always earns Clev's Marks.";

  function packet(questionCount: number, extra: Record<string, unknown> = {}) {
    return {
      sections: [
        {
          heading: "Part 1",
          questions: Array.from({ length: questionCount }, () => ({ prompt: "Find the mean." })),
        },
      ],
      ...extra,
    };
  }

  it("flags every citation past the last question the packet has", () => {
    const issues = validateDraftNumbering(packet(21, { compulsoryCore: A2_COMPULSORY_CORE }));
    expect(issues.map((i) => i.kind)).toEqual([
      "cross-reference-out-of-range",
      "cross-reference-out-of-range",
      "cross-reference-out-of-range",
      "cross-reference-out-of-range",
    ]);
    expect(issues.every((i) => i.location === "Compulsory core")).toBe(true);
    expect(issues.map((i) => i.detail.match(/Cites Q([0-9]+)/)?.[1])).toEqual(["22", "23", "25", "26"]);
    expect(issues[0].detail).toContain("only 21 questions");
  });

  it("catches A.2's real defect at the bound A.2 actually had", () => {
    // A.2's draft carried 25 questions (the printed packet numbers only 21 --
    // the Desmos activity prints unnumbered and the three Extension branches
    // never print at all). So the bound available at generation time is 25,
    // and exactly one citation, Q26, is provably impossible. That is the
    // honest yield of this check: not every wrong number, but enough to put
    // the list in front of a teacher before it reaches a student's hands.
    const issues = validateDraftNumbering(packet(25, { compulsoryCore: A2_COMPULSORY_CORE }));
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("cross-reference-out-of-range");
    expect(issues[0].detail).toContain("Cites Q26");
  });

  it("says nothing when every citation is in range", () => {
    expect(validateDraftNumbering(packet(26, { compulsoryCore: A2_COMPULSORY_CORE }))).toEqual([]);
    expect(validateDraftNumbering(packet(21, { compulsoryCore: "Complete Q1–Q21." }))).toEqual([]);
  });

  it("counts subparts toward the bound, matching how numbers are assigned", () => {
    const withSubparts = {
      sections: [
        {
          heading: "Part 1",
          questions: [
            { prompt: "Find the mean.", subparts: [{ prompt: "State the mode." }, { prompt: "Sketch it." }] },
          ],
        },
      ],
      compulsoryCore: "Complete Q1 and Q3.",
    };
    expect(validateDraftNumbering(withSubparts)).toEqual([]);
    expect(validateDraftNumbering({ ...withSubparts, compulsoryCore: "Complete Q4." })).toHaveLength(1);
  });

  it("checks the other prose fields that cite question numbers", () => {
    const planted = validateDraftNumbering(packet(3, { plantedErrorIntro: "The slip is in Q9." }));
    expect(planted).toHaveLength(1);
    expect(planted[0].location).toBe("Planted error intro");

    const reflection = validateDraftNumbering(
      packet(3, { reflectionQuestions: ["Look back at Q2.", "Now revisit Q8."] })
    );
    expect(reflection).toHaveLength(1);
    expect(reflection[0].location).toBe("Reflection question 2");
  });

  it("stays quiet when there is no prose, or no questions to bound it with", () => {
    expect(validateDraftNumbering(packet(5))).toEqual([]);
    expect(validateDraftNumbering(packet(0, { compulsoryCore: "Complete Q1–Q7." }))).toEqual([]);
  });
});
