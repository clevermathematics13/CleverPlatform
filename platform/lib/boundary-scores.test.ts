import { describe, it, expect } from "vitest";
import {
  clusterSplits,
  distributionSnapshot,
  emptyScoresNear,
  levelCounts,
  levelForScore,
  levelMoves,
  mergeSubjectScores,
  scoreHistogram,
  scoreSummary,
  watchList,
  type ScoreItem,
  type SubjectScore,
} from "./boundary-scores";
import type { Cutoffs } from "./grade-bands";

const GRADE_9_AT_50: Cutoffs = { 7: 45, 6: 40, 5: 35, 4: 30, 3: 25, 2: 20 };
const SUGGESTED_AT_50: Cutoffs = { 7: 45, 6: 40, 5: 35, 4: 28, 3: 23, 2: 18 };

describe("mergeSubjectScores", () => {
  const items: ScoreItem[] = [
    { id: "p1", maxMarks: 2, sectionIndex: 0, label: "1.1(a)" },
    { id: "p2", maxMarks: 3, sectionIndex: 0, label: "1.1(b)" },
    { id: "p3", maxMarks: 1, sectionIndex: 1, label: "2.1" },
  ];
  const base = { name: "S", className: "9A", absent: false };

  it("prefers Clev's Mark, then the suggestion, and counts a never-marked part as 0", () => {
    const [s] = mergeSubjectScores(items, 2, [
      {
        ...base,
        subjectId: "a",
        accepted: new Map([["p1", 1]]),
        suggested: new Map([
          ["p1", 2],
          ["p2", 3],
        ]),
      },
    ]);
    expect(s.total).toBe(4); // accepted 1 beats suggested 2; p2 suggested 3; p3 never marked
    expect(s.status).toBe("provisional");
    expect(s.acceptedParts).toBe(1);
    expect(s.pendingParts).toBe(1);
    expect(s.neverMarked).toEqual([{ itemId: "p3", label: "2.1", maxMarks: 1 }]);
    expect(s.sectionTotals).toEqual([4, 0]);
  });

  it("is complete only when every part is accepted", () => {
    const [s] = mergeSubjectScores(items, 2, [
      { ...base, subjectId: "b", accepted: new Map([["p1", 2], ["p2", 0], ["p3", 1]]), suggested: null },
    ]);
    expect(s.status).toBe("complete");
    expect(s.total).toBe(3);
    expect(s.sectionTotals).toEqual([2, 1]);
  });

  it("leaves a student with nothing marked unscored rather than at 0", () => {
    const [s] = mergeSubjectScores(items, 2, [{ ...base, subjectId: "c", accepted: new Map(), suggested: null }]);
    expect(s.status).toBe("unmarked");
    expect(s.total).toBeNull();
    expect(s.neverMarked).toEqual([]);
  });
});

/**
 * Grade 9 Extended Key Assessment 1 (50 marks) as it stood at 16:31 UTC on
 * 24 Sep 2026: 49 students scored, 33 with every part accepted, 2 not marked
 * at all. Totals only -- no names. [total, pending parts, never-marked marks]
 * for the provisional ones.
 */
const KA1_COMPLETE = [
  44, 43, 34, // 9A
  49, 47, 44, 44, 44, 43, 42, 41, 41, 41, 41, 38, 37, 37, 36, 33, 30, 29, 24, // 9C
  44, 38, 37, 36, 35, 33, 33, 29, 29, 24, 21, // 9G
];
const KA1_PROVISIONAL: [number, number, number][] = [
  [39, 0, 1], [32, 2, 0], [32, 2, 1], [29, 1, 1], [29, 0, 2], [26, 5, 0], [26, 7, 0], [25, 0, 1], [25, 2, 1], [24, 10, 0], // 9A
  [46, 0, 1], [41, 0, 1], [38, 0, 1], [37, 0, 1], [22, 0, 1], [20, 3, 0], // 9G
];

function ka1Scores(): SubjectScore[] {
  let n = 0;
  const make = (total: number | null, status: SubjectScore["status"], pending = 0, never = 0): SubjectScore => ({
    subjectId: `s${++n}`,
    name: `Student ${n}`,
    className: null,
    absent: false,
    status,
    total,
    acceptedParts: 0,
    pendingParts: pending,
    neverMarked: Array.from({ length: never }, (_, i) => ({ itemId: `x${i}`, label: "4.4(b)", maxMarks: 1 })),
    sectionTotals: [],
  });
  return [
    ...KA1_COMPLETE.map((t) => make(t, "complete")),
    ...KA1_PROVISIONAL.map(([t, pending, never]) => make(t, "provisional", pending, never)),
    make(null, "unmarked"),
    make(null, "unmarked"),
    { ...make(40, "complete"), absent: true }, // absent: flagged, never counted
  ];
}

const asArray = (c: Record<number, number>) => [7, 6, 5, 4, 3, 2, 1].map((g) => c[g]);

describe("KA1 level counts", () => {
  const scores = ka1Scores();

  it("reproduces the hand count under the Grade 9 set", () => {
    const all = levelCounts(scores, 50, GRADE_9_AT_50, "all");
    expect(all.n).toBe(49);
    expect(asArray(all.counts)).toEqual([3, 13, 11, 7, 9, 6, 0]);
    const complete = levelCounts(scores, 50, GRADE_9_AT_50, "complete");
    expect(complete.n).toBe(33);
    expect(asArray(complete.counts)).toEqual([2, 12, 8, 5, 3, 3, 0]);
  });

  it("reproduces the suggested 45/40/35/28/23/18", () => {
    expect(asArray(levelCounts(scores, 50, SUGGESTED_AT_50, "all").counts)).toEqual([3, 13, 11, 12, 7, 3, 0]);
    expect(asArray(levelCounts(scores, 50, SUGGESTED_AT_50, "complete").counts)).toEqual([2, 12, 8, 8, 2, 1, 0]);
  });

  it("counts who moves: eight up, nobody down", () => {
    expect(levelMoves(scores, 50, GRADE_9_AT_50, SUGGESTED_AT_50, "all")).toEqual({ up: 8, down: 0 });
  });

  it("uses the generic bands when a paper has no boundaries", () => {
    expect(levelForScore(40, 50, null)).toBe(7); // 80% in the fallback bands
    expect(levelForScore(40, 50, GRADE_9_AT_50)).toBe(6);
  });

  it("summarises who is in and who is not", () => {
    expect(scoreSummary(scores)).toEqual({
      roster: 52,
      absent: 1,
      unmarked: 2,
      scored: 49,
      complete: 33,
      provisional: 16,
      neverMarkedParts: 12,
      mean: expect.any(Number),
      median: 36,
    });
  });
});

describe("where lines fall", () => {
  const hist = scoreHistogram(ka1Scores(), 50);

  it("bins every counted student, split by whether every part is accepted", () => {
    expect(hist).toHaveLength(51);
    expect(hist[29]).toEqual({ score: 29, complete: 3, provisional: 2 });
    expect(hist.reduce((n, b) => n + b.complete + b.provisional, 0)).toBe(49);
  });

  it("finds the Grade 9 lines that split neighbours one mark apart", () => {
    expect(clusterSplits(hist, GRADE_9_AT_50)).toEqual([
      { grade: 5, line: 35, below: 1, at: 1 },
      { grade: 4, line: 30, below: 5, at: 1 },
      { grade: 3, line: 25, below: 3, at: 2 },
    ]);
    expect(clusterSplits(hist, SUGGESTED_AT_50)).toEqual([{ grade: 5, line: 35, below: 1, at: 1 }]);
  });

  it("lists the empty scores near a line, nearest first", () => {
    expect(emptyScoresNear(hist, 30)).toEqual([31, 28, 27]);
    expect(emptyScoresNear(hist, 45)).toEqual([45, 48]);
  });
});

describe("watchList", () => {
  const scores = ka1Scores();

  it("flags provisional students whose level hangs on marks not yet final", () => {
    const list = watchList(scores, 50, GRADE_9_AT_50);
    expect(list.map((w) => w.total)).toEqual([39, 29, 29, 25, 24, 20]);
    expect(list[0].reasons).toEqual(["4.4(b) never marked: 1 mark there would reach the 6 line (40)"]);
    expect(list.find((w) => w.total === 25)?.reasons).toEqual(["on the 3 line (25) with 2 parts not accepted"]);
  });

  it("has less to watch when the lines sit on empty scores", () => {
    expect(watchList(scores, 50, SUGGESTED_AT_50).map((w) => w.total)).toEqual([39, 22]);
  });

  it("ignores complete students and papers with no boundaries", () => {
    expect(watchList(scores, 50, null)).toEqual([]);
    const completeOnly = scores.filter((s) => s.status === "complete");
    expect(watchList(completeOnly, 50, GRADE_9_AT_50)).toEqual([]);
  });
});

describe("distributionSnapshot", () => {
  it("keeps counts only -- no names or ids", () => {
    const snap = distributionSnapshot(ka1Scores(), 50, GRADE_9_AT_50);
    const json = JSON.stringify(snap);
    expect(json).not.toMatch(/Student|s\d+"/);
    expect(snap.levels.all[4]).toBe(7);
    expect(snap.histogram.find(([score]) => score === 29)).toEqual([29, 3, 2]);
  });
});
