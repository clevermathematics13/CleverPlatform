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
  summariseSelfAssessment,
  selfMarkFor,
  selfMarkDiffers,
  latestRunsByStudent,
  acceptanceByRunFrom,
  deriveOverviewState,
  buildRosterOptions,
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

describe("latestRunsByStudent", () => {
  const INVITED_LUCIANA = `invited-${LUCIANA}`;
  type Run = { id: string; student_id: string | null; status: string; created_at?: string };

  it("takes each student's first complete run, newest first as the route orders them", () => {
    const { latestComplete, newerAttempt } = latestRunsByStudent([
      { id: "salim-new", student_id: SALIM, status: "complete" },
      { id: "luciana-new", student_id: LUCIANA, status: "complete" },
      { id: "salim-old", student_id: SALIM, status: "complete" },
      { id: "luciana-old", student_id: LUCIANA, status: "complete" },
    ]);
    expect(latestComplete[SALIM].id).toBe("salim-new");
    expect(latestComplete[LUCIANA].id).toBe("luciana-new");
    // The newest run is the complete one, so there is no newer attempt.
    expect(newerAttempt).toEqual({});
  });

  // A failed re-mark once hid a student's real graded work behind an empty
  // run: the complete run below it must stay the one reviewed and counted.
  it("keeps the complete run under a newer failed, running or queued attempt", () => {
    for (const status of ["failed", "running", "submitted"]) {
      const { latestComplete, newerAttempt } = latestRunsByStudent([
        { id: "attempt", student_id: LUCIANA, status },
        { id: "graded", student_id: LUCIANA, status: "complete" },
      ]);
      expect(latestComplete[LUCIANA].id).toBe("graded");
      expect(newerAttempt[LUCIANA].id).toBe("attempt");
    }
  });

  it("lists a student with no complete run under newerAttempt only", () => {
    const { latestComplete, newerAttempt } = latestRunsByStudent([
      { id: "queued", student_id: SALIM, status: "submitted" },
      { id: "failed", student_id: SALIM, status: "failed" },
    ]);
    expect(latestComplete[SALIM]).toBeUndefined();
    expect(newerAttempt[SALIM].id).toBe("queued");
  });

  it("keeps an invited subject apart from a signed-in student with the same uuid", () => {
    const { latestComplete } = latestRunsByStudent([
      { id: "invited-run", student_id: INVITED_LUCIANA, status: "complete" },
      { id: "profile-run", student_id: LUCIANA, status: "complete" },
    ]);
    expect(latestComplete[INVITED_LUCIANA].id).toBe("invited-run");
    expect(latestComplete[LUCIANA].id).toBe("profile-run");
  });

  // The route and the page must pick the same run, so neither may re-sort:
  // array position (the route's created_at desc, id asc) is the only order.
  it("goes by array position, never by created_at", () => {
    const { latestComplete } = latestRunsByStudent<Run>([
      { id: "first", student_id: LUCIANA, status: "complete", created_at: "2026-09-01T00:00:00Z" },
      { id: "second", student_id: LUCIANA, status: "complete", created_at: "2026-09-20T00:00:00Z" },
      { id: "tie-a", student_id: SALIM, status: "complete", created_at: "2026-09-05T00:00:00.000001Z" },
      { id: "tie-b", student_id: SALIM, status: "complete", created_at: "2026-09-05T00:00:00.000001Z" },
    ]);
    expect(latestComplete[LUCIANA].id).toBe("first");
    expect(latestComplete[SALIM].id).toBe("tie-a");
  });

  it("skips a run with no subject and leaves the input untouched", () => {
    const runs: Run[] = [
      { id: "orphan", student_id: null, status: "complete" },
      { id: "hers", student_id: LUCIANA, status: "complete" },
    ];
    const before = JSON.stringify(runs);
    const { latestComplete, newerAttempt } = latestRunsByStudent(runs);
    expect(Object.keys(latestComplete)).toEqual([LUCIANA]);
    expect(newerAttempt).toEqual({});
    expect(JSON.stringify(runs)).toBe(before);
  });

  // The loop the page ran inline before this function existed -- and the one
  // a tab left open across the deploy still runs. The route now counts only
  // the runs this function picks, so for any list both must agree.
  it("picks exactly what the page's old inline loop picked", () => {
    const oldLoop = (allRuns: Run[]) => {
      const latestComplete: Record<string, Run> = {};
      const newestAny: Record<string, Run> = {};
      for (const r of allRuns) {
        if (!newestAny[r.student_id as string]) newestAny[r.student_id as string] = r;
        if (r.status === "complete" && !latestComplete[r.student_id as string]) {
          latestComplete[r.student_id as string] = r;
        }
      }
      const newerAttempt: Record<string, Run> = {};
      for (const [studentId, r] of Object.entries(newestAny)) {
        if (latestComplete[studentId]?.id !== r.id) newerAttempt[studentId] = r;
      }
      return { latestComplete, newerAttempt };
    };
    // A small deterministic PRNG, so a failure reproduces.
    let seed = 20260923;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const subjects = [LUCIANA, SALIM, `invited-${SALIM}`, "a8f5f167-f44f-4964-8f4b-4ea3a8d3a2c1"];
    const statuses = ["complete", "complete", "failed", "running", "submitted"];
    for (let trial = 0; trial < 500; trial++) {
      const runs: Run[] = Array.from({ length: Math.floor(random() * 14) }, (_, i) => ({
        id: `run-${trial}-${i}`,
        student_id: subjects[Math.floor(random() * subjects.length)],
        status: statuses[Math.floor(random() * statuses.length)],
      }));
      expect(latestRunsByStudent(runs)).toEqual(oldLoop(runs));
    }
  });
});

describe("acceptanceByRunFrom", () => {
  it("counts each run's rows and how many of them are accepted", () => {
    expect(
      acceptanceByRunFrom([
        { run_id: "runA", accepted: true },
        { run_id: "runB", accepted: false },
        { run_id: "runA", accepted: false },
        { run_id: "runA", accepted: true },
      ])
    ).toEqual({ runA: { accepted: 2, total: 3 }, runB: { accepted: 0, total: 1 } });
  });

  // No entry, not { accepted: 0, total: 0 }: the roster draws no dot for a
  // run it has no rows for, and a red "none accepted" dot for one it does.
  it("gives a run with no rows no entry", () => {
    expect(acceptanceByRunFrom([])).toEqual({});
  });
});

describe("deriveOverviewState", () => {
  type Run = { id: string; student_id: string | null; status: string; pending_message_batch_id: string | null };
  const run = (id: string, student_id: string | null, status: string, batch: string | null = null): Run => ({
    id,
    student_id,
    status,
    pending_message_batch_id: batch,
  });

  it("picks each student's runs with latestRunsByStudent and counts their acceptance", () => {
    const runs = [
      run("salim-failed", SALIM, "failed"),
      run("salim-graded", SALIM, "complete"),
      run("luciana-graded", LUCIANA, "complete"),
    ];
    const state = deriveOverviewState(runs, [
      { run_id: "salim-graded", accepted: true },
      { run_id: "luciana-graded", accepted: false },
    ]);
    const { latestComplete, newerAttempt } = latestRunsByStudent(runs);
    expect(state.runsByStudent).toEqual(latestComplete);
    expect(state.newerAttemptByStudent).toEqual(newerAttempt);
    expect(state.acceptanceByRun).toEqual({
      "salim-graded": { accepted: 1, total: 1 },
      "luciana-graded": { accepted: 0, total: 1 },
    });
    expect(state.submittedStudentCount).toBe(0);
    expect(state.outstandingCollectCount).toBe(0);
  });

  // A student queued overnight and then marked in the browser has a newer
  // complete run, which hides the queued one from the per-student maps --
  // the banner and the poll must still see it.
  it("counts a queued run hidden behind a newer complete one", () => {
    const state = deriveOverviewState(
      [run("marked-now", LUCIANA, "complete"), run("queued", LUCIANA, "submitted", "msgbatch_1")],
      []
    );
    expect(state.newerAttemptByStudent).toEqual({});
    expect(state.submittedStudentCount).toBe(1);
    expect(state.outstandingCollectCount).toBe(1);
  });

  it("counts students for the banner but runs for the poll", () => {
    const state = deriveOverviewState(
      [
        run("q1", SALIM, "submitted", "msgbatch_1"),
        run("q2", SALIM, "submitted", "msgbatch_2"),
        run("q3", LUCIANA, "submitted", "msgbatch_2"),
      ],
      []
    );
    expect(state.submittedStudentCount).toBe(2);
    expect(state.outstandingCollectCount).toBe(3);
  });

  // A "running" run still tied to a batch is one the collect route left for
  // a later sweep: its marks are written, so it is not "being marked" -- but
  // the page still owes it a collect call.
  it("owes a collect call to a rescued running run, but never tells the teacher it is being marked", () => {
    const state = deriveOverviewState(
      [run("rescued", SALIM, "running", "msgbatch_1"), run("in-browser", LUCIANA, "running")],
      []
    );
    expect(state.submittedStudentCount).toBe(0);
    expect(state.outstandingCollectCount).toBe(1);
  });

  it("is all empty for a test nobody has been marked on", () => {
    expect(deriveOverviewState([], [])).toEqual({
      runsByStudent: {},
      newerAttemptByStudent: {},
      acceptanceByRun: {},
      submittedStudentCount: 0,
      outstandingCollectCount: 0,
    });
  });
});

describe("buildRosterOptions", () => {
  const row = (
    profile_id: string | null,
    display_name: string,
    course_id: string,
    course_name: string | null,
    nickname: string | null = null
  ) => ({ profile_id, profiles: { display_name, nickname }, course_id, course_name });

  it("lists the test's own class first, then the pooled classes alphabetically, then unknown classes", () => {
    const options = buildRosterOptions(
      [
        row("p1", "Zoe Quispe", "c-9a", "9A"),
        row("p2", "Ana Torres", "c-unknown", null),
        row("p3", "Bruno Diaz", "c-9g", "9G"),
        row("p4", "Carla Rios", "c-9c", "9C"),
        row("p5", "Alba Soto", "c-9g", "9G"),
      ],
      "c-9g"
    );
    expect(options.map((o) => [o.class_name, o.display_name])).toEqual([
      ["9G", "Alba Soto"],
      ["9G", "Bruno Diaz"],
      ["9A", "Zoe Quispe"],
      ["9C", "Carla Rios"],
      [null, "Ana Torres"],
    ]);
  });

  it("labels a student by full name, with the nickname beside it only when it differs", () => {
    const options = buildRosterOptions(
      [
        row("p1", "Luciana Rojas", "c", "9A", "Lu"),
        row("p2", "Salim Fellah", "c", "9A", "Salim Fellah"),
        row("p3", "", "c", "9A", "Nico"),
        { profile_id: "p4", profiles: null, course_id: "c", course_name: "9A" },
      ],
      "c"
    );
    expect(Object.fromEntries(options.map((o) => [o.profile_id, o.display_name]))).toEqual({
      p1: "Luciana Rojas (Lu)",
      p2: "Salim Fellah",
      p3: "Nico",
      p4: "Unknown",
    });
  });

  it("drops a row with no subject id and keeps an invited subject's id as it is", () => {
    const options = buildRosterOptions(
      [row(null, "Nobody", "c", "9A"), row(`invited-${SALIM}`, "Salim Fellah", "c", "9A")],
      "c"
    );
    expect(options).toEqual([{ profile_id: `invited-${SALIM}`, display_name: "Salim Fellah", class_name: "9A" }]);
  });

  // The server sorts the first render and the browser every refresh after
  // it, so the order must not depend on the runtime's locale. Under Spanish
  // collation "Munro" would come first.
  it("sorts names the same way whatever the runtime's locale", () => {
    const options = buildRosterOptions(
      [row("p1", "Munro Vega", "c", "9A"), row("p2", "Muñoz Paz", "c", "9A")],
      "c"
    );
    expect(options.map((o) => o.display_name)).toEqual(["Muñoz Paz", "Munro Vega"]);
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

describe("summariseSelfAssessment / selfMarkFor", () => {
  const Q1A = "item-1a";
  const Q1B = "item-1b";
  const Q2 = "item-2";
  const ADDED_LATER = "item-3";

  it("keeps a failed read apart from a student who has not self-assessed", () => {
    const failed = summariseSelfAssessment(null);
    expect(failed.available).toBe(false);
    expect(failed.assessed).toBe(false);

    const none = summariseSelfAssessment([]);
    expect(none.available).toBe(true);
    expect(none.assessed).toBe(false);
    expect(selfMarkFor(none, Q1A)).toEqual({ kind: "none" });
  });

  it("reads each part as a claimed mark, a blank, or nothing on file", () => {
    const summary = summariseSelfAssessment([
      { test_item_id: Q1A, self_marks: 1 },
      { test_item_id: Q1B, self_marks: 0 },
      { test_item_id: Q2, self_marks: null },
    ]);
    expect(summary.assessed).toBe(true);
    expect(selfMarkFor(summary, Q1A)).toEqual({ kind: "marks", marks: 1 });
    // 0 is "attempted and earned nothing" -- not the same fact as a blank.
    expect(selfMarkFor(summary, Q1B)).toEqual({ kind: "marks", marks: 0 });
    expect(selfMarkFor(summary, Q2)).toEqual({ kind: "blank" });
    expect(selfMarkFor(summary, ADDED_LATER)).toEqual({ kind: "none" });
  });

  it("totals the claimed marks, a blank adding nothing", () => {
    const summary = summariseSelfAssessment([
      { test_item_id: Q1A, self_marks: 2 },
      { test_item_id: Q1B, self_marks: 3 },
      { test_item_id: Q2, self_marks: null },
    ]);
    expect(summary.total).toBe(5);
  });

  // The platform's own test for having self-assessed (hasSelfScores): a form
  // submitted blank end to end is not a self-assessment, so the column must
  // not print a row of blanks under a heading that says "not self-assessed".
  it("treats a submission with every box blank as not self-assessed", () => {
    const summary = summariseSelfAssessment([
      { test_item_id: Q1A, self_marks: null },
      { test_item_id: Q2, self_marks: null },
    ]);
    expect(summary.available).toBe(true);
    expect(summary.assessed).toBe(false);
    expect(summary.total).toBe(0);
    expect(selfMarkFor(summary, Q1A)).toEqual({ kind: "none" });
    expect(selfMarkFor(summary, Q2)).toEqual({ kind: "none" });
  });

  it("reports when the rows were last saved, skipping unreadable timestamps", () => {
    const summary = summariseSelfAssessment([
      { test_item_id: Q1A, self_marks: 1, submitted_at: "2026-09-23T13:46:18.821+00:00" },
      { test_item_id: Q1B, self_marks: 1, submitted_at: "2026-09-24T08:00:00+00:00" },
      { test_item_id: Q2, self_marks: null, submitted_at: null },
      { test_item_id: ADDED_LATER, self_marks: 0, submitted_at: "not a date" },
    ]);
    expect(summary.lastSavedAt).toBe("2026-09-24T08:00:00+00:00");
    expect(summariseSelfAssessment([{ test_item_id: Q1A, self_marks: 1 }]).lastSavedAt).toBeNull();
  });
});

describe("selfMarkDiffers", () => {
  it("compares a claimed mark with the mark on screen", () => {
    expect(selfMarkDiffers({ kind: "marks", marks: 1 }, 1)).toBe(false);
    expect(selfMarkDiffers({ kind: "marks", marks: 2 }, 1)).toBe(true);
    expect(selfMarkDiffers({ kind: "marks", marks: 0 }, 1)).toBe(true);
  });

  it("reads a blank as a claim of 0, as computeDisagreement does", () => {
    expect(selfMarkDiffers({ kind: "blank" }, 0)).toBe(false);
    expect(selfMarkDiffers({ kind: "blank" }, 1)).toBe(true);
  });

  it("never flags a part with nothing on file", () => {
    expect(selfMarkDiffers({ kind: "none" }, 0)).toBe(false);
    expect(selfMarkDiffers({ kind: "none" }, 3)).toBe(false);
  });
});
