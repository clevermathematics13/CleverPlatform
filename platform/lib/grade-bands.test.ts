import { describe, it, expect } from "vitest";
import {
  resolveGrade,
  pctToGradeFallback,
  isApproximateGrade,
  type GradeBoundary,
} from "./grade-bands";

/**
 * The Formative Assessment 1 boundary set (migration
 * *_fa1_strict_grade_boundaries.sql). Duplicated here on purpose: these are
 * the numbers a student's reported Level hangs on, so a silent edit to the
 * live set should show up as a failing test, not as a quietly different grade.
 *
 * FA1 belongs to Grade 9 -- a course of the teacher's own design that borrows
 * the 1-7 scale so students meet it before DP, NOT an IB course. Do not
 * reconcile these numbers against official IB boundaries, and do not fold this
 * set into the A-D sets: those model DP course progression (a 7 at 76-82%) and
 * have no bearing on Grade 9. The applied migration's own header predates that
 * correction and reads as though the two scales were comparable; this is the
 * accurate account.
 */
const FA1_STRICT: GradeBoundary[] = [
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

describe("resolveGrade with the FA1 strict boundaries", () => {
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
    expect(levelForMarks(earned, FA1_STRICT)).toBe(expected);
  });

  it("drops to the grade below one mark under each cutoff", () => {
    expect(levelForMarks(44, FA1_STRICT)).toBe(6);
    expect(levelForMarks(39, FA1_STRICT)).toBe(5);
    expect(levelForMarks(34, FA1_STRICT)).toBe(4);
    expect(levelForMarks(29, FA1_STRICT)).toBe(3);
    expect(levelForMarks(24, FA1_STRICT)).toBe(2);
    expect(levelForMarks(19, FA1_STRICT)).toBe(1);
  });

  it("floors at 1 and tops out at 7", () => {
    expect(levelForMarks(0, FA1_STRICT)).toBe(1);
    expect(levelForMarks(50, FA1_STRICT)).toBe(7);
  });

  // The reason the set exists: the generic fallback was handing out 7s at 40.
  it("is stricter than the fallback bands at every mark it changes", () => {
    for (let earned = 0; earned <= FA1_TOTAL_MARKS; earned++) {
      const strict = levelForMarks(earned, FA1_STRICT);
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
    expect(isApproximateGrade(FA1_STRICT)).toBe(false);
  });

  it("does not depend on the order boundaries arrive in", () => {
    const shuffled = [...FA1_STRICT].sort((a, b) => a.grade - b.grade);
    for (let earned = 0; earned <= FA1_TOTAL_MARKS; earned++) {
      expect(levelForMarks(earned, shuffled)).toBe(levelForMarks(earned, FA1_STRICT));
    }
  });
});
