import { describe, expect, it } from "vitest";
import {
  extractLeadingQuestionNumber,
  extractPartNumber,
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
