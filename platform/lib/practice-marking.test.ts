import { describe, expect, it } from "vitest";
import {
  cellKey,
  isEmptyAnswer,
  isStale,
  isVerdict,
  markingOrder,
  summariseCells,
  verdictTally,
  type StudentAnswerCell,
  type Verdict,
} from "@/lib/practice-marking";

function cell(overrides: Partial<StudentAnswerCell> & { fullName: string }): StudentAnswerCell {
  const answerLatex = overrides.answerLatex ?? "x=2";
  const empty = overrides.empty ?? isEmptyAnswer(answerLatex);
  return {
    invitedId: `inv-${overrides.fullName}`,
    profileId: `prof-${overrides.fullName}`,
    answerId: "ans",
    answerLatex,
    answerUpdatedAt: "2026-09-11T10:00:00Z",
    verdict: null,
    note: null,
    markUpdatedAt: null,
    empty,
    stale: false,
    ...overrides,
  };
}

describe("isVerdict", () => {
  it("accepts the three states and nothing else", () => {
    for (const v of ["correct", "almost", "not_yet"]) expect(isVerdict(v)).toBe(true);
    for (const v of ["Correct", "wrong", "", 3, null, undefined]) expect(isVerdict(v)).toBe(false);
  });
});

describe("isEmptyAnswer", () => {
  it("treats nothing, whitespace and editor leftovers as empty", () => {
    expect(isEmptyAnswer(null)).toBe(true);
    expect(isEmptyAnswer("")).toBe(true);
    expect(isEmptyAnswer("   ")).toBe(true);
    expect(isEmptyAnswer("\\placeholder{}")).toBe(true);
    expect(isEmptyAnswer("{}")).toBe(true);
  });

  it("treats real work as work", () => {
    expect(isEmptyAnswer("0")).toBe(false);
    expect(isEmptyAnswer("\\frac{39}{8}+6\\ln 2")).toBe(false);
  });
});

describe("isStale", () => {
  it("is true when the answer moved after the mark", () => {
    expect(isStale("2026-09-11T12:00:00Z", "2026-09-11T10:00:00Z")).toBe(true);
  });

  it("is false when the mark is the later of the two", () => {
    expect(isStale("2026-09-11T10:00:00Z", "2026-09-11T12:00:00Z")).toBe(false);
  });

  it("is false for an unmarked or unanswered cell rather than guessing", () => {
    expect(isStale("2026-09-11T12:00:00Z", null)).toBe(false);
    expect(isStale(null, "2026-09-11T12:00:00Z")).toBe(false);
  });
});

describe("summariseCells", () => {
  const cells = [
    cell({ fullName: "A", verdict: "correct" }),
    cell({ fullName: "B", verdict: "almost", stale: true }),
    cell({ fullName: "C" }),
    cell({ fullName: "D", answerLatex: "" }),
    cell({ fullName: "E", answerLatex: "  " }),
  ];

  it("counts everyone on the roster, answered or not", () => {
    expect(summariseCells(cells).onRoster).toBe(5);
  });

  it("counts only students who wrote something as answered", () => {
    expect(summariseCells(cells).answered).toBe(3);
  });

  it("counts marked and stale within the answered", () => {
    const s = summariseCells(cells);
    expect(s.marked).toBe(2);
    expect(s.stale).toBe(1);
  });

  it("is all zeroes for an empty class", () => {
    expect(summariseCells([])).toEqual({ answered: 0, marked: 0, stale: 0, onRoster: 0 });
  });
});

describe("verdictTally", () => {
  it("counts each state and leaves the rest at zero", () => {
    const cells = [
      cell({ fullName: "A", verdict: "correct" }),
      cell({ fullName: "B", verdict: "correct" }),
      cell({ fullName: "C", verdict: "not_yet" }),
      cell({ fullName: "D" }),
    ];
    expect(verdictTally(cells)).toEqual({ correct: 2, almost: 0, not_yet: 1 });
  });
});

describe("markingOrder", () => {
  it("puts unread work first, then changed, then settled, then nothing typed", () => {
    const cells = [
      cell({ fullName: "settled", verdict: "correct" as Verdict }),
      cell({ fullName: "nothing", answerLatex: "" }),
      cell({ fullName: "unread" }),
      cell({ fullName: "changed", verdict: "almost" as Verdict, stale: true }),
    ];
    expect(markingOrder(cells).map((c) => c.fullName)).toEqual([
      "unread",
      "changed",
      "settled",
      "nothing",
    ]);
  });

  it("breaks ties by name so the order does not move between refreshes", () => {
    const cells = [cell({ fullName: "Zoe" }), cell({ fullName: "Adam" }), cell({ fullName: "Mia" })];
    expect(markingOrder(cells).map((c) => c.fullName)).toEqual(["Adam", "Mia", "Zoe"]);
  });

  it("does not mutate the array it is given", () => {
    const cells = [cell({ fullName: "Zoe" }), cell({ fullName: "Adam" })];
    const before = cells.map((c) => c.fullName);
    markingOrder(cells);
    expect(cells.map((c) => c.fullName)).toEqual(before);
  });
});

describe("cellKey", () => {
  it("matches the answer table's unique key and does not collide", () => {
    expect(cellKey("item", "prof", "(a)")).toBe("item::prof::(a)");
    const keys = new Set([
      cellKey("i", "p", "(a)"),
      cellKey("i", "p", "(b)"),
      cellKey("i", "q", "(a)"),
      cellKey("j", "p", "(a)"),
      cellKey("i", "p", ""),
    ]);
    expect(keys.size).toBe(5);
  });
});
