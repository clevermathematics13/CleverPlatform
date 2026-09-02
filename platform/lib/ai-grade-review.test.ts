import { describe, it, expect } from "vitest";
import {
  pickLatestRunForStudent,
  rowsForRun,
  partSortKey,
  sortReviewRows,
} from "./ai-grade-review";

const LUCIANA = "42d4dd74-a367-4776-b45b-c1702989dbe8";
const SALIM = "183fbc20-4984-4ee9-bfa0-425a410e4499";

describe("pickLatestRunForStudent", () => {
  it("returns the newest run for that student", () => {
    const run = pickLatestRunForStudent(LUCIANA, [
      { id: "old", student_id: LUCIANA, created_at: "2026-08-30T22:12:41Z" },
      { id: "new", student_id: LUCIANA, created_at: "2026-08-30T22:38:02Z" },
    ]);
    expect(run?.id).toBe("new");
  });

  it("does not order by array position when created_at disagrees", () => {
    const run = pickLatestRunForStudent(LUCIANA, [
      { id: "old", student_id: LUCIANA, created_at: "2026-08-30T22:12:41Z" },
      { id: "newer", student_id: LUCIANA, created_at: "2026-09-02T02:50:34Z" },
    ]);
    expect(run?.id).toBe("newer");
  });

  // The production bug: a response that belongs to a different student must
  // never resolve to a run, or its rows render under this student's name.
  it("ignores runs belonging to another student", () => {
    const run = pickLatestRunForStudent(LUCIANA, [
      { id: "salims", student_id: SALIM, created_at: "2026-09-02T02:50:34Z" },
    ]);
    expect(run).toBeNull();
  });

  it("returns null for an empty payload", () => {
    expect(pickLatestRunForStudent(LUCIANA, [])).toBeNull();
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
