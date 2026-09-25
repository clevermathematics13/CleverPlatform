import { describe, expect, it } from "vitest";
import {
  markSchemeGapHeadline,
  markSchemeGapRows,
  markSchemeGapWarning,
  marksLabel,
  partList,
  summariseMarkSchemeReadiness,
  type ReadinessUnit,
} from "./mark-scheme-readiness";

let nextId = 0;
function unit(overrides: Partial<ReadinessUnit> = {}): ReadinessUnit {
  nextId += 1;
  return {
    testItemId: `item-${nextId}`,
    questionNumber: 1,
    partLabel: "",
    maxMarks: 4,
    questionCode: "Q1",
    markschemeSource: "part_latex",
    ...overrides,
  };
}

/**
 * 27AH [L67] P1 as it would have been imported on 25 Sep 2026: 14 parts, and
 * the PPQ bank held a usable mark scheme (plain text) for Q1 and Q6 only.
 */
function l67(): ReadinessUnit[] {
  const q = (questionNumber: number, questionCode: string, partLabel: string, maxMarks: number, gradeable = false) =>
    unit({ questionNumber, questionCode, partLabel, maxMarks, markschemeSource: gradeable ? "part_text" : "none" });
  return [
    q(1, "17N.1.AHL.TZ0.H_4", "", 4, true),
    q(2, "18M.1.SL.TZ2.S_3", "a", 2),
    q(2, "18M.1.SL.TZ2.S_3", "b", 4),
    q(3, "19M.1.AHL.TZ2.H_4", "", 5),
    q(4, "13M.1.AHL.TZ2.H_5", "", 7),
    q(5, "13M.1.AHL.TZ1.H_7", "", 7),
    q(6, "19N.1.AHL.TZ0.H_6", "", 7, true),
    q(7, "18N.1.AHL.TZ0.H_9", "a", 5),
    q(7, "18N.1.AHL.TZ0.H_9", "b", 3),
    q(7, "18N.1.AHL.TZ0.H_9", "c", 7),
    q(8, "18N.1.AHL.TZ0.H_10", "a", 5),
    q(8, "18N.1.AHL.TZ0.H_10", "b", 3),
    q(8, "18N.1.AHL.TZ0.H_10", "c", 6),
    q(8, "18N.1.AHL.TZ0.H_10", "d", 5),
  ];
}

describe("summariseMarkSchemeReadiness", () => {
  it("counts the L67 paper the way the grader would have marked it", () => {
    const r = summariseMarkSchemeReadiness(l67());
    expect({
      totalParts: r.totalParts,
      totalMarks: r.totalMarks,
      missingParts: r.missingParts,
      missingMarks: r.missingMarks,
    }).toEqual({ totalParts: 14, totalMarks: 70, missingParts: 12, missingMarks: 59 });
    expect(r.missing.map((m) => [m.questionNumber, m.questionCode, m.parts.map((p) => p.partLabel), m.marks])).toEqual([
      [2, "18M.1.SL.TZ2.S_3", ["a", "b"], 6],
      [3, "19M.1.AHL.TZ2.H_4", [""], 5],
      [4, "13M.1.AHL.TZ2.H_5", [""], 7],
      [5, "13M.1.AHL.TZ1.H_7", [""], 7],
      [7, "18N.1.AHL.TZ0.H_9", ["a", "b", "c"], 15],
      [8, "18N.1.AHL.TZ0.H_10", ["a", "b", "c", "d"], 19],
    ]);
  });

  it("counts only parts with no mark scheme at all -- every other source is still marked", () => {
    for (const source of ["part_latex", "part_text", "whole_question", "draft", "custom"] as const) {
      const r = summariseMarkSchemeReadiness([unit({ markschemeSource: source }), unit({ markschemeSource: source })]);
      expect(r.missingParts).toBe(0);
      expect(r.missing).toEqual([]);
      expect(markSchemeGapHeadline(r)).toBeNull();
      expect(markSchemeGapWarning(r)).toBeNull();
    }
  });

  it("keeps each part's own id and marks", () => {
    const a = unit({ questionNumber: 3, partLabel: "a", maxMarks: 2, markschemeSource: "none" });
    const b = unit({ questionNumber: 3, partLabel: "b", maxMarks: 5, markschemeSource: "none" });
    const [group] = summariseMarkSchemeReadiness([a, b]).missing;
    expect(group.parts).toEqual([
      { testItemId: a.testItemId, partLabel: "a", maxMarks: 2 },
      { testItemId: b.testItemId, partLabel: "b", maxMarks: 5 },
    ]);
    expect(group.marks).toBe(7);
  });

  it("groups by question number AND code, in the order the parts came in", () => {
    const r = summariseMarkSchemeReadiness([
      unit({ questionNumber: 5, questionCode: "X", markschemeSource: "none" }),
      unit({ questionNumber: 2, questionCode: "Y", markschemeSource: "none" }),
      unit({ questionNumber: 5, questionCode: "Z", markschemeSource: "none" }),
      unit({ questionNumber: 5, questionCode: "X", partLabel: "b", markschemeSource: "none" }),
    ]);
    expect(r.missing.map((m) => `${m.questionNumber}${m.questionCode}:${m.parts.length}`)).toEqual([
      "5X:2",
      "2Y:1",
      "5Z:1",
    ]);
  });

  it("handles an assessment with no parts", () => {
    const r = summariseMarkSchemeReadiness([]);
    expect(r).toEqual({ totalParts: 0, totalMarks: 0, missingParts: 0, missingMarks: 0, missing: [] });
    expect(markSchemeGapHeadline(r)).toBe(
      "This assessment has no parts recorded, so there is nothing for AI marking to mark."
    );
    expect(markSchemeGapWarning(r)).toBeNull();
  });
});

describe("markSchemeGapHeadline", () => {
  it("says how many parts and marks will be skipped", () => {
    expect(markSchemeGapHeadline(summariseMarkSchemeReadiness(l67()))).toBe(
      "12 of 14 parts (59 of 70 marks) have no mark scheme and will be skipped by AI marking."
    );
  });

  it("is singular for one part", () => {
    const units: ReadinessUnit[] = l67().map((u) => ({ ...u, markschemeSource: "part_latex" }));
    units[0] = { ...units[0], markschemeSource: "none" };
    expect(markSchemeGapHeadline(summariseMarkSchemeReadiness(units))).toBe(
      "1 of 14 parts (4 of 70 marks) has no mark scheme and will be skipped by AI marking."
    );
  });

  it("says marking cannot run when every part is missing", () => {
    expect(markSchemeGapHeadline(summariseMarkSchemeReadiness([unit({ markschemeSource: "none" })]))).toBe(
      "The only part of this assessment (4 marks) has no mark scheme, so AI marking cannot run on it until it has one."
    );
    expect(
      markSchemeGapHeadline(
        summariseMarkSchemeReadiness([
          unit({ markschemeSource: "none", maxMarks: 1 }),
          unit({ markschemeSource: "none", maxMarks: 2 }),
          unit({ markschemeSource: "none", maxMarks: 3 }),
        ])
      )
    ).toBe("None of the 3 parts (6 marks) has a mark scheme, so AI marking cannot run on this assessment until at least one does.");
  });
});

describe("markSchemeGapWarning", () => {
  it("is the headline and the fix, then one line per question", () => {
    const lines = markSchemeGapWarning(summariseMarkSchemeReadiness(l67()))!.split("\n");
    expect(lines[0]).toBe(
      "12 of 14 parts (59 of 70 marks) have no mark scheme and will be skipped by AI marking. " +
        `Extract each question's mark scheme in LaTeX Review with "Extract & apply", which splits it into parts; ` +
        "the Mark Scans page links to each question."
    );
    expect(lines.slice(1)).toEqual([
      "Q2 18M.1.SL.TZ2.S_3 (a), (b) -- 6 marks",
      "Q3 19M.1.AHL.TZ2.H_4 -- 5 marks",
      "Q4 13M.1.AHL.TZ2.H_5 -- 7 marks",
      "Q5 13M.1.AHL.TZ1.H_7 -- 7 marks",
      "Q7 18N.1.AHL.TZ0.H_9 (a), (b), (c) -- 15 marks",
      "Q8 18N.1.AHL.TZ0.H_10 (a), (b), (c), (d) -- 19 marks",
    ]);
  });

  it("lists a custom part without a code, and does not send it to the PPQ bank", () => {
    const warning = markSchemeGapWarning(
      summariseMarkSchemeReadiness([
        unit({ questionNumber: 3, questionCode: "", partLabel: "b", maxMarks: 1, markschemeSource: "none" }),
        unit({ questionNumber: 4, questionCode: "", markschemeSource: "custom" }),
      ])
    )!;
    expect(warning.split("\n")).toEqual([
      "1 of 2 parts (1 of 5 marks) has no mark scheme and will be skipped by AI marking. These parts were saved without mark scheme text.",
      "Q3 (b) -- 1 mark",
    ]);
  });

  it("is plain ASCII", () => {
    expect(markSchemeGapWarning(summariseMarkSchemeReadiness(l67()))).toMatch(/^[\x20-\x7E\n]*$/);
  });
});

describe("markSchemeGapRows", () => {
  const readiness = () =>
    summariseMarkSchemeReadiness([
      unit({ questionNumber: 2, questionCode: "18M.1.SL.TZ2.S_3", partLabel: "a", maxMarks: 2, markschemeSource: "none" }),
      unit({ questionNumber: 2, questionCode: "18M.1.SL.TZ2.S_3", partLabel: "b", maxMarks: 4, markschemeSource: "none" }),
      unit({ questionNumber: 3, questionCode: "99X.1.SL.TZ0.S_1", maxMarks: 5, markschemeSource: "none" }),
      unit({ questionNumber: 4, questionCode: "", partLabel: "c", maxMarks: 3, markschemeSource: "none" }),
    ]);

  it("links a bank question to LaTeX Review, an unknown code to the bank search, a custom part nowhere", () => {
    const rows = markSchemeGapRows(readiness(), {
      questionIdByCode: new Map([["18M.1.SL.TZ2.S_3", "ecf0811f-b5f4-44d3-8085-81d65bc0f252"]]),
    });
    expect(rows).toEqual([
      {
        key: "2|18M.1.SL.TZ2.S_3",
        label: "Q2",
        parts: "(a), (b)",
        questionCode: "18M.1.SL.TZ2.S_3",
        marks: 6,
        link: { kind: "review", href: "/dashboard/questions/review?focus=ecf0811f-b5f4-44d3-8085-81d65bc0f252" },
      },
      {
        key: "3|99X.1.SL.TZ0.S_1",
        label: "Q3",
        parts: "",
        questionCode: "99X.1.SL.TZ0.S_1",
        marks: 5,
        link: { kind: "bank", href: "/dashboard/questions?search=99X.1.SL.TZ0.S_1", notInBank: true },
      },
      { key: "4|", label: "Q4", parts: "(c)", questionCode: "", marks: 3, link: { kind: "none" } },
    ]);
  });

  it("falls back to the bank search, without claiming the code is missing, when the id lookup failed", () => {
    const rows = markSchemeGapRows(readiness(), { questionIdByCode: null });
    expect(rows.map((r) => r.link)).toEqual([
      { kind: "bank", href: "/dashboard/questions?search=18M.1.SL.TZ2.S_3", notInBank: false },
      { kind: "bank", href: "/dashboard/questions?search=99X.1.SL.TZ0.S_1", notInBank: false },
      { kind: "none" },
    ]);
  });

  it("uses the paper's own numbering when the test has it", () => {
    const r = readiness();
    const firstOf = (n: number) => r.missing.find((q) => q.questionNumber === n)!.parts[0].testItemId;
    const rows = markSchemeGapRows(r, {
      questionIdByCode: new Map(),
      sortOrderByItemId: new Map([
        [firstOf(2), 5],
        [firstOf(4), 9],
      ]),
      prefixBySortOrder: new Map([
        [5, "2.1"],
        [9, "3.2"],
      ]),
    });
    expect(rows.map((row) => row.label)).toEqual(["2.1", "Q3", "3.2"]);
  });
});

describe("partList / marksLabel", () => {
  it("lists labelled parts and leaves a whole question blank", () => {
    expect(partList([{ partLabel: "a" }, { partLabel: "bii" }])).toBe("(a), (bii)");
    expect(partList([{ partLabel: "" }])).toBe("");
  });

  it("pluralises marks", () => {
    expect(marksLabel(1)).toBe("1 mark");
    expect(marksLabel(0)).toBe("0 marks");
    expect(marksLabel(19)).toBe("19 marks");
  });
});
