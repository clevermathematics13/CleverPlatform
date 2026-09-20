import { describe, it, expect } from "vitest";
import {
  runsForStudent,
  rowsForRun,
  partSortKey,
  sortReviewRows,
  partitionByConfidence,
  partWarningLabel,
  warningsForPart,
  capCauseForPart,
} from "./ai-grade-review";
import { unitLabel } from "./ai-grading";

const LUCIANA = "42d4dd74-a367-4776-b45b-c1702989dbe8";
const SALIM = "183fbc20-4984-4ee9-bfa0-425a410e4499";

describe("runsForStudent", () => {
  it("returns that student's runs newest first", () => {
    const runs = runsForStudent(LUCIANA, [
      { id: "old", student_id: LUCIANA, created_at: "2026-08-30T22:12:41Z" },
      { id: "new", student_id: LUCIANA, created_at: "2026-08-30T22:38:02Z" },
    ]);
    expect(runs.map((r) => r.id)).toEqual(["new", "old"]);
  });

  it("does not order by array position when created_at disagrees", () => {
    const runs = runsForStudent(LUCIANA, [
      { id: "old", student_id: LUCIANA, created_at: "2026-08-30T22:12:41Z" },
      { id: "newer", student_id: LUCIANA, created_at: "2026-09-02T02:50:34Z" },
    ]);
    expect(runs[0].id).toBe("newer");
  });

  // The production bug: a response that belongs to a different student must
  // never resolve to a run, or its rows render under this student's name.
  it("drops runs belonging to another student", () => {
    const runs = runsForStudent(LUCIANA, [
      { id: "salims", student_id: SALIM, created_at: "2026-09-02T02:50:34Z" },
      { id: "hers", student_id: LUCIANA, created_at: "2026-08-30T22:38:02Z" },
    ]);
    expect(runs.map((r) => r.id)).toEqual(["hers"]);
  });

  it("returns an empty list when the payload holds none of this student's runs", () => {
    expect(runsForStudent(LUCIANA, [])).toEqual([]);
    expect(
      runsForStudent(LUCIANA, [
        { id: "salims", student_id: SALIM, created_at: "2026-09-02T02:50:34Z" },
      ])
    ).toEqual([]);
  });

  // The caller narrows to complete runs and takes [0] and [1] for the
  // reviewed run and its "was N" hints -- both must stay this student's.
  it("preserves extra fields so callers can filter on status", () => {
    const runs = runsForStudent(LUCIANA, [
      { id: "running", student_id: LUCIANA, created_at: "2026-09-02T03:00:00Z", status: "running" },
      { id: "latest", student_id: LUCIANA, created_at: "2026-09-02T02:00:00Z", status: "complete" },
      { id: "salims", student_id: SALIM, created_at: "2026-09-02T01:30:00Z", status: "complete" },
      { id: "previous", student_id: LUCIANA, created_at: "2026-09-02T01:00:00Z", status: "complete" },
    ]);
    const complete = runs.filter((r) => r.status === "complete");
    expect(complete.map((r) => r.id)).toEqual(["latest", "previous"]);
  });

  it("does not mutate the input array", () => {
    const runs = [
      { id: "old", student_id: LUCIANA, created_at: "2026-08-30T22:12:41Z" },
      { id: "new", student_id: LUCIANA, created_at: "2026-08-30T22:38:02Z" },
    ];
    runsForStudent(LUCIANA, runs);
    expect(runs.map((r) => r.id)).toEqual(["old", "new"]);
  });
});

describe("rowsForRun", () => {
  const rows = [
    { id: "r1", run_id: "runA" },
    { id: "r2", run_id: "runB" },
    { id: "r3", run_id: "runA" },
  ];

  it("keeps only the rows of the given run", () => {
    expect(rowsForRun("runA", rows).map((r) => r.id)).toEqual(["r1", "r3"]);
  });

  // Falling back to "all rows" here is what mixes two students' results.
  it("returns nothing when the run is unresolved", () => {
    expect(rowsForRun(null, rows)).toEqual([]);
  });
});

describe("partSortKey", () => {
  it("reads a plain part letter", () => {
    expect(partSortKey("b")).toEqual({ letter: "b", roman: 0 });
  });

  it("splits a letter and roman sub-part", () => {
    expect(partSortKey("bii")).toEqual({ letter: "b", roman: 2 });
    expect(partSortKey("aiv")).toEqual({ letter: "a", roman: 4 });
  });

  it("treats a whole-question row as sorting before any part", () => {
    expect(partSortKey("")).toEqual({ letter: "", roman: 0 });
    expect(partSortKey(null)).toEqual({ letter: "", roman: 0 });
  });

  it("falls back to the raw label when it is not a recognised form", () => {
    expect(partSortKey("part one")).toEqual({ letter: "part one", roman: 0 });
  });
});

describe("sortReviewRows", () => {
  interface Row {
    id: string;
    q: number;
    part: string;
  }
  const itemFor = (r: Row) => ({ question_number: r.q, part_label: r.part });

  // Exactly the ordering a teacher saw on 2 Sep 2026: Q4(b) above Q4(a).
  it("orders parts of the same question by their label", () => {
    const rows: Row[] = [
      { id: "4b", q: 4, part: "b" },
      { id: "4a", q: 4, part: "a" },
      { id: "4c", q: 4, part: "c" },
    ];
    expect(sortReviewRows(rows, itemFor).map((r) => r.id)).toEqual(["4a", "4b", "4c"]);
  });

  it("orders by question number first", () => {
    const rows: Row[] = [
      { id: "4a", q: 4, part: "a" },
      { id: "1", q: 1, part: "" },
      { id: "2", q: 2, part: "" },
    ];
    expect(sortReviewRows(rows, itemFor).map((r) => r.id)).toEqual(["1", "2", "4a"]);
  });

  it("orders roman sub-parts within a letter", () => {
    const rows: Row[] = [
      { id: "aii", q: 3, part: "aii" },
      { id: "b", q: 3, part: "b" },
      { id: "ai", q: 3, part: "ai" },
    ];
    expect(sortReviewRows(rows, itemFor).map((r) => r.id)).toEqual(["ai", "aii", "b"]);
  });

  it("puts rows with an unresolvable test item last", () => {
    const rows: Row[] = [
      { id: "orphan", q: 0, part: "" },
      { id: "1", q: 1, part: "" },
    ];
    const sorted = sortReviewRows(rows, (r) => (r.id === "orphan" ? undefined : itemFor(r)));
    expect(sorted.map((r) => r.id)).toEqual(["1", "orphan"]);
  });

  it("does not mutate the input array", () => {
    const rows: Row[] = [
      { id: "4b", q: 4, part: "b" },
      { id: "4a", q: 4, part: "a" },
    ];
    sortReviewRows(rows, itemFor);
    expect(rows.map((r) => r.id)).toEqual(["4b", "4a"]);
  });
});

describe("partitionByConfidence", () => {
  type Row = { id: string; confidence: string };

  it("separates the high-confidence rows from the ones needing a look", () => {
    const rows: Row[] = [
      { id: "1", confidence: "high" },
      { id: "2", confidence: "low" },
      { id: "3", confidence: "high" },
      { id: "4", confidence: "medium" },
    ];
    const { high, needsLook } = partitionByConfidence(rows);
    expect(high.map((r) => r.id)).toEqual(["1", "3"]);
    expect(needsLook.map((r) => r.id)).toEqual(["2", "4"]);
  });

  // Both halves are rendered as tables, so each must still read in paper
  // order -- which is the order sortReviewRows already put them in.
  it("keeps the incoming order inside each half", () => {
    const rows: Row[] = [
      { id: "1a", confidence: "medium" },
      { id: "1b", confidence: "high" },
      { id: "2", confidence: "high" },
      { id: "3", confidence: "low" },
      { id: "4", confidence: "high" },
    ];
    const { high, needsLook } = partitionByConfidence(rows);
    expect(high.map((r) => r.id)).toEqual(["1b", "2", "4"]);
    expect(needsLook.map((r) => r.id)).toEqual(["1a", "3"]);
  });

  it("treats an unrecognised confidence as needing a look", () => {
    const { high, needsLook } = partitionByConfidence([
      { id: "1", confidence: "HIGH" },
      { id: "2", confidence: "" },
    ]);
    expect(high).toEqual([]);
    expect(needsLook.map((r) => r.id)).toEqual(["1", "2"]);
  });

  it("handles an all-high run and an empty run", () => {
    const allHigh = partitionByConfidence([
      { id: "1", confidence: "high" },
      { id: "2", confidence: "high" },
    ]);
    expect(allHigh.high).toHaveLength(2);
    expect(allHigh.needsLook).toEqual([]);
    expect(partitionByConfidence([])).toEqual({ high: [], needsLook: [] });
  });

  it("does not mutate the input array", () => {
    const rows: Row[] = [
      { id: "1", confidence: "high" },
      { id: "2", confidence: "low" },
    ];
    partitionByConfidence(rows);
    expect(rows.map((r) => r.id)).toEqual(["1", "2"]);
  });
});

describe("partWarningLabel", () => {
  it("prints the same label as unitLabel for every part shape", () => {
    const cases: { question_number: number; part_label: string | null }[] = [
      { question_number: 1, part_label: null },
      { question_number: 1, part_label: "" },
      { question_number: 3, part_label: "b" },
      { question_number: 3, part_label: "B" },
      { question_number: 3, part_label: "bii" },
      { question_number: 4, part_label: "iv" },
      { question_number: 7, part_label: "d " },
      { question_number: 9, part_label: "ab" },
    ];
    for (const c of cases) {
      expect(partWarningLabel(c)).toBe(
        unitLabel({ questionNumber: c.question_number, partLabel: c.part_label ?? "" })
      );
    }
  });
});

describe("warningsForPart / capCauseForPart", () => {
  const warnings = [
    "1(b): reasoning hedges on reading the student's work (\"appears to\") — check the crop before accepting",
    "1(c): model reported 2 mark(s) but its own breakdown only awards 1 token(s); corrected to 1 and flagged low confidence",
    "4(a): examiner reasoning exposes internal deliberation (\"wait,\") — flagged for teacher review",
    "4(a): reasoning hedges on reading the student's work (\"seems to\") — check the crop before accepting",
    "5: model awarded 4 of a possible 3; clamped to 3 and flagged low confidence",
    "6: A1 withheld on deterministic accuracy re-check — 0.81 is 2 s.f.",
    "This test's standards rubric could not be read and was ignored: bad json",
  ];

  it("returns only the named part's warnings, prefix stripped", () => {
    expect(warningsForPart("1(b)", warnings)).toEqual([
      "reasoning hedges on reading the student's work (\"appears to\") — check the crop before accepting",
    ]);
    expect(warningsForPart("1(bii)", warnings)).toEqual([]);
    expect(warningsForPart("1", warnings)).toEqual([]);
    expect(warningsForPart("1(b)", null)).toEqual([]);
  });

  it("classifies the cause, preferring the one that says most about the mark", () => {
    expect(capCauseForPart("1(b)", warnings)).toBe("hedge");
    expect(capCauseForPart("1(c)", warnings)).toBe("breakdown");
    expect(capCauseForPart("4(a)", warnings)).toBe("deliberation");
    expect(capCauseForPart("5", warnings)).toBe("clamp");
    expect(capCauseForPart("6", warnings)).toBe("numeric");
    expect(capCauseForPart("2", warnings)).toBe("none");
    expect(capCauseForPart("2", undefined)).toBe("none");
  });
});
