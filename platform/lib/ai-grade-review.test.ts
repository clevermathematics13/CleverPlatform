import { describe, it, expect } from "vitest";
import {
  runsForStudent,
  rowsForRun,
  partSortKey,
  sortReviewRows,
} from "./ai-grade-review";

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
