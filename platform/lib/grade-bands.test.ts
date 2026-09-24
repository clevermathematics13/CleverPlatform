import { describe, it, expect } from "vitest";
import {
  resolveGrade,
  pctToGradeFallback,
  pctToGradeWithBoundaries,
  isApproximateGrade,
  CUTOFF_GRADES,
  minMarksForProportion,
  marksToProportion,
  cutoffsFromBoundaries,
  boundariesFromCutoffs,
  validateCutoffs,
  sameBoundaries,
  sameCutoffs,
  blendBoundaries,
  aggregateGrade,
  type Cutoffs,
  type GradeBoundary,
} from "./grade-bands";

/**
 * The `Grade 9` boundary set, as applied by migrations
 * *_fa1_strict_grade_boundaries.sql and *_rename_grade_9_boundary_set.sql
 * (the first migration's filename and header predate the rename, and an
 * applied migration has to stay byte-identical to the ledger, so they still
 * say "FA1 - strict"). Duplicated here on purpose: these are the numbers a
 * student's reported Level hangs on, so a silent edit to the live set should
 * show up as a failing test, not as a quietly different grade.
 *
 * Grade 9 is a course of the teacher's own design that borrows the 1-7 scale
 * so students meet it before DP; it is NOT an IB course. Do not reconcile
 * these numbers against official IB boundaries, and do not fold this set into
 * the A-D sets -- those model DP course progression (a 7 at 76-82%) and have
 * no bearing on Grade 9.
 */
const GRADE_9: GradeBoundary[] = [
  { grade: 1, min_proportion: 0.01 },
  { grade: 2, min_proportion: 0.4 },
  { grade: 3, min_proportion: 0.5 },
  { grade: 4, min_proportion: 0.6 },
  { grade: 5, min_proportion: 0.7 },
  { grade: 6, min_proportion: 0.8 },
  { grade: 7, min_proportion: 0.9 },
];

const FA1_TOTAL_MARKS = 50;

/** Exactly what GradebookGrid.tsx:89 and TeacherDashboard.tsx:416 compute. */
function levelForMarks(earned: number, boundaries: GradeBoundary[] | null): number {
  return resolveGrade((earned / FA1_TOTAL_MARKS) * 100, boundaries);
}

describe("resolveGrade with the Grade 9 boundaries", () => {
  // A mark sitting exactly on a cutoff must earn the HIGHER grade. The check
  // is not academic: callers pass (earned / total) * 100, and that round trip
  // through floating point is what would silently demote a 35/50 to a 4.
  it.each([
    [45, 7],
    [40, 6],
    [35, 5],
    [30, 4],
    [25, 3],
    [20, 2],
  ])("awards %i/50 the higher grade %i, not the one below", (earned, expected) => {
    expect(levelForMarks(earned, GRADE_9)).toBe(expected);
  });

  it("drops to the grade below one mark under each cutoff", () => {
    expect(levelForMarks(44, GRADE_9)).toBe(6);
    expect(levelForMarks(39, GRADE_9)).toBe(5);
    expect(levelForMarks(34, GRADE_9)).toBe(4);
    expect(levelForMarks(29, GRADE_9)).toBe(3);
    expect(levelForMarks(24, GRADE_9)).toBe(2);
    expect(levelForMarks(19, GRADE_9)).toBe(1);
  });

  it("floors at 1 and tops out at 7", () => {
    expect(levelForMarks(0, GRADE_9)).toBe(1);
    expect(levelForMarks(50, GRADE_9)).toBe(7);
  });

  // The reason the set exists: the generic fallback was handing out 7s at 40.
  it("is stricter than the fallback bands at every mark it changes", () => {
    for (let earned = 0; earned <= FA1_TOTAL_MARKS; earned++) {
      const strict = levelForMarks(earned, GRADE_9);
      const fallback = pctToGradeFallback((earned / FA1_TOTAL_MARKS) * 100);
      expect(strict).toBeLessThanOrEqual(fallback);
    }
  });
});

describe("boundary-set plumbing", () => {
  it("falls back to the generic bands when a test has no set assigned", () => {
    expect(resolveGrade(85, null)).toBe(pctToGradeFallback(85));
    expect(resolveGrade(85, [])).toBe(pctToGradeFallback(85));
  });

  // Drives the '~approx' badge in the gradebook and reflection dashboard.
  it("reports a grade as approximate only when there are no boundaries", () => {
    expect(isApproximateGrade(null)).toBe(true);
    expect(isApproximateGrade([])).toBe(true);
    expect(isApproximateGrade(GRADE_9)).toBe(false);
  });

  it("does not depend on the order boundaries arrive in", () => {
    const shuffled = [...GRADE_9].sort((a, b) => a.grade - b.grade);
    for (let earned = 0; earned <= FA1_TOTAL_MARKS; earned++) {
      expect(levelForMarks(earned, shuffled)).toBe(levelForMarks(earned, GRADE_9));
    }
  });
});

// ---------------------------------------------------------------------------
// Per-assessment boundaries, in marks
// ---------------------------------------------------------------------------

/** The four DP course-progression presets as they stand in grade_boundaries. */
const DP_SETS: Record<string, GradeBoundary[]> = {
  A: [0.01, 0.17, 0.31, 0.45, 0.58, 0.68, 0.82].map((p, i) => ({ grade: i + 1, min_proportion: p })),
  B: [0.01, 0.16, 0.3, 0.43, 0.57, 0.67, 0.81].map((p, i) => ({ grade: i + 1, min_proportion: p })),
  C: [0.01, 0.15, 0.28, 0.41, 0.54, 0.66, 0.79].map((p, i) => ({ grade: i + 1, min_proportion: p })),
  D: [0.01, 0.13, 0.26, 0.38, 0.51, 0.64, 0.76].map((p, i) => ({ grade: i + 1, min_proportion: p })),
};

/** The level a score earns by reading cut-offs in marks, the way the page shows them. */
function levelByCutoffs(score: number, cutoffs: Cutoffs): number {
  for (const grade of CUTOFF_GRADES) if (score >= cutoffs[grade]) return grade;
  return 1;
}

describe("cut-offs in marks <-> stored proportions", () => {
  // The whole design rests on this: a teacher types "a 4 from 28", the
  // database keeps 4 decimal places, and the gradebook compares percentages.
  it("round-trips every cut-off at every total from 1 to 200, and awards the level at exactly that mark", () => {
    for (let total = 1; total <= 200; total++) {
      for (let m = 1; m <= total; m++) {
        const p = marksToProportion(m, total);
        expect(minMarksForProportion(p, total)).toBe(m);
        const single: GradeBoundary[] = [{ grade: 2, min_proportion: p }];
        for (let score = Math.max(0, m - 2); score <= Math.min(total, m + 1); score++) {
          const level = pctToGradeWithBoundaries((score / total) * 100, single);
          expect(level).toBe(score >= m ? 2 : 1);
        }
      }
    }
  });

  it("stores at most 4 decimal places and never asks for more than m marks", () => {
    for (let total = 1; total <= 200; total++) {
      for (let m = 1; m <= total; m++) {
        const p = marksToProportion(m, total);
        expect(Math.abs(p * 10000 - Math.round(p * 10000))).toBeLessThan(1e-6);
        expect(p).toBeLessThanOrEqual(m / total + 1e-12);
      }
    }
  });

  it("keeps 35/50 at 0.7 exactly (multiply before dividing)", () => {
    expect(marksToProportion(35, 50)).toBe(0.7);
    expect(marksToProportion(43, 70)).toBe(0.6142);
  });

  it("shows every preset's cut-offs as the marks the lookup actually awards, at every total", () => {
    for (const set of [GRADE_9, ...Object.values(DP_SETS)]) {
      for (let total = 1; total <= 200; total++) {
        const cutoffs = cutoffsFromBoundaries(set, total);
        expect(cutoffs).not.toBeNull();
        for (let score = 0; score <= total; score++) {
          expect(levelByCutoffs(score, cutoffs as Cutoffs)).toBe(resolveGrade((score / total) * 100, set));
        }
      }
    }
  });

  it("gives Grade 9 at 50 marks as 45/40/35/30/25/20", () => {
    expect(cutoffsFromBoundaries(GRADE_9, 50)).toEqual({ 7: 45, 6: 40, 5: 35, 4: 30, 3: 25, 2: 20 });
  });

  it("is null for a set that does not draw every line from 2 to 7", () => {
    expect(cutoffsFromBoundaries(null, 50)).toBeNull();
    expect(cutoffsFromBoundaries(GRADE_9.filter((b) => b.grade !== 4), 50)).toBeNull();
  });

  it("keeps a preset's own proportion whenever it lands on the same mark", () => {
    const g9 = cutoffsFromBoundaries(GRADE_9, 50) as Cutoffs;
    const back = boundariesFromCutoffs(g9, 50, [GRADE_9]);
    expect(sameBoundaries(back, GRADE_9)).toBe(true);

    // Set B's 7 at 70 marks is 57; re-deriving would store 0.8142, not 0.81.
    const b70 = cutoffsFromBoundaries(DP_SETS.B, 70) as Cutoffs;
    expect(b70[7]).toBe(57);
    expect(boundariesFromCutoffs(b70, 70, [DP_SETS.B]).find((r) => r.grade === 7)?.min_proportion).toBe(0.81);
    expect(boundariesFromCutoffs(b70, 70, []).find((r) => r.grade === 7)?.min_proportion).toBe(0.8142);
  });

  it("re-derives only the lines that moved", () => {
    const moved: Cutoffs = { 7: 45, 6: 40, 5: 35, 4: 28, 3: 23, 2: 18 };
    const out = boundariesFromCutoffs(moved, 50, [GRADE_9]);
    expect(out.map((r) => [r.grade, r.min_proportion])).toEqual([
      [7, 0.9],
      [6, 0.8],
      [5, 0.7],
      [4, 0.56],
      [3, 0.46],
      [2, 0.36],
    ]);
    expect(cutoffsFromBoundaries(out, 50)).toEqual(moved);
  });

  it("validates cut-offs as whole marks, in range, each level above the one below", () => {
    expect(validateCutoffs({ 7: 45, 6: 40, 5: 35, 4: 28, 3: 23, 2: 18 }, 50)).toEqual([]);
    expect(validateCutoffs({ 7: 45, 6: 40, 5: 35, 4: 28.5, 3: 23, 2: 18 }, 50)).toEqual([
      "Level 4 needs a whole number of marks.",
    ]);
    expect(validateCutoffs({ 7: 51, 6: 40, 5: 35, 4: 28, 3: 23, 2: 0 }, 50)).toEqual([
      "Level 7 must start between 1 and 50 marks.",
      "Level 2 must start between 1 and 50 marks.",
    ]);
    expect(validateCutoffs({ 7: 45, 6: 40, 5: 40, 4: 28, 3: 23, 2: 18 }, 50)).toEqual([
      "Level 6 must need more marks than level 5.",
    ]);
    expect(validateCutoffs({ 7: 45 }, 50)).toHaveLength(5);
    expect(validateCutoffs({ 7: 45, 6: 40, 5: 35, 4: 28, 3: 23, 2: 18 }, 0)).toEqual([
      "Set the total marks on this assessment before deciding its boundaries.",
    ]);
  });

  it("compares boundaries by their lines and cut-offs by their marks", () => {
    expect(sameBoundaries(GRADE_9, [...GRADE_9].reverse())).toBe(true);
    expect(sameBoundaries(GRADE_9, DP_SETS.A)).toBe(false);
    expect(sameBoundaries(GRADE_9, null)).toBe(false);
    // Level 1's floor is not a line anyone crosses.
    expect(sameBoundaries(GRADE_9, GRADE_9.map((b) => (b.grade === 1 ? { grade: 1, min_proportion: 0 } : b)))).toBe(true);
    expect(sameCutoffs(cutoffsFromBoundaries(GRADE_9, 50), { 7: 45, 6: 40, 5: 35, 4: 30, 3: 25, 2: 20 })).toBe(true);
    expect(sameCutoffs(cutoffsFromBoundaries(GRADE_9, 50), null)).toBe(false);
  });
});

describe("aggregates across papers with their own boundaries", () => {
  const KA1_SUGGESTED = boundariesFromCutoffs({ 7: 45, 6: 40, 5: 35, 4: 28, 3: 23, 2: 18 }, 50, [GRADE_9]);

  it("returns identical boundaries unchanged", () => {
    const out = blendBoundaries([
      { total: 50, boundaries: GRADE_9 },
      { total: 50, boundaries: GRADE_9 },
    ]);
    expect(sameBoundaries(out, GRADE_9)).toBe(true);
  });

  it("weights each paper's line by its marks", () => {
    const out = blendBoundaries([
      { total: 50, boundaries: GRADE_9 },
      { total: 50, boundaries: KA1_SUGGESTED },
    ]);
    const at = (g: number) => out.find((b) => b.grade === g)?.min_proportion ?? NaN;
    expect(at(7)).toBeCloseTo(0.9, 12);
    expect(at(4)).toBeCloseTo(0.58, 12);
    expect(at(3)).toBeCloseTo(0.48, 12);
    expect(at(2)).toBeCloseTo(0.38, 12);

    const uneven = blendBoundaries([
      { total: 70, boundaries: DP_SETS.B },
      { total: 50, boundaries: DP_SETS.D },
    ]);
    const p7 = uneven.find((b) => b.grade === 7)?.min_proportion ?? NaN;
    expect(p7).toBeCloseTo((0.81 * 70 + 0.76 * 50) / 120, 12);
  });

  it("keeps the blended lines in order", () => {
    const out = blendBoundaries([
      { total: 64, boundaries: DP_SETS.A },
      { total: 50, boundaries: GRADE_9 },
      { total: 50, boundaries: KA1_SUGGESTED },
    ]);
    // KA1_SUGGESTED draws levels 2..7 only, so level 1 is not blended.
    expect(out.map((b) => b.grade)).toEqual([2, 3, 4, 5, 6, 7]);
    for (let g = 3; g <= 7; g++) {
      const hi = out.find((b) => b.grade === g)?.min_proportion ?? NaN;
      const lo = out.find((b) => b.grade === g - 1)?.min_proportion ?? NaN;
      expect(hi).toBeGreaterThan(lo);
    }
  });

  // No regression: FA1 and KA1 each get their own set holding Grade 9's
  // values, and a student who sat both must still be banded as Grade 9.
  it("uses shared lines as they are, whatever set rows hold them", () => {
    for (let pct = 0; pct <= 100; pct += 0.5) {
      const out = aggregateGrade(pct, [
        { total_marks: 50, boundaries: GRADE_9 },
        { total_marks: 50, boundaries: GRADE_9.map((b) => ({ ...b })) },
      ]);
      expect(out).toEqual({ grade: resolveGrade(pct, GRADE_9), approximate: false, blended: false });
    }
  });

  it("blends different lines and says so", () => {
    const out = aggregateGrade(57, [
      { total_marks: 50, boundaries: GRADE_9 },
      { total_marks: 50, boundaries: KA1_SUGGESTED },
    ]);
    // The blended line for a 4 is 58%: (60% x 50 + 56% x 50) / 100.
    expect(out).toEqual({ grade: 3, approximate: false, blended: true });
    expect(aggregateGrade(58, [
      { total_marks: 50, boundaries: GRADE_9 },
      { total_marks: 50, boundaries: KA1_SUGGESTED },
    ]).grade).toBe(4);
  });

  it("falls back to the generic bands, as an estimate, when any paper has no boundaries", () => {
    expect(aggregateGrade(85, [
      { total_marks: 50, boundaries: GRADE_9 },
      { total_marks: 64, boundaries: null },
    ])).toEqual({ grade: pctToGradeFallback(85), approximate: true, blended: false });
    expect(aggregateGrade(85, [])).toEqual({ grade: pctToGradeFallback(85), approximate: true, blended: false });
  });
});
