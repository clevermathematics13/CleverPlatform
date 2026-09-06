/**
 * Turning a percentage into an achievement level (1-7).
 *
 * Extracted from the gradebook grid so the Exam Reflection dashboard shows
 * the same level for the same marks. Two views disagreeing about a student's
 * level is worse than either being approximate, and the fallback below is a
 * generic band set rather than boundaries calibrated for a given paper -- so
 * which one a view used has to be visible, not guessed at.
 *
 * Client-safe on purpose: no fs, no server imports, so a "use client"
 * component can call it.
 */

export type GradeBoundary = {
  grade: number;
  /** Minimum proportion (0-1) of total marks needed for this grade. */
  min_proportion: number;
};

/**
 * Approximate IB-style 10-point bands, used when a test has no boundary set
 * assigned. Callers must mark these as estimates (the gradebook shows a '~'
 * badge) -- they are not calibrated boundaries for any particular paper.
 */
export function pctToGradeFallback(pct: number): number {
  if (pct >= 80) return 7;
  if (pct >= 70) return 6;
  if (pct >= 60) return 5;
  if (pct >= 50) return 4;
  if (pct >= 40) return 3;
  if (pct >= 30) return 2;
  return 1;
}

/**
 * Boundary-aware lookup. Walks 7 down to 1 and returns the first grade whose
 * min_proportion the student meets.
 */
export function pctToGradeWithBoundaries(pct: number, boundaries: GradeBoundary[]): number {
  const proportion = pct / 100;
  const sorted = [...boundaries].sort((a, b) => b.grade - a.grade);
  for (const row of sorted) {
    if (proportion >= row.min_proportion) return row.grade;
  }
  return 1;
}

/** Resolve a grade from a percentage, using boundaries when there are any. */
export function resolveGrade(pct: number, boundaries: GradeBoundary[] | null): number {
  if (boundaries && boundaries.length > 0) {
    return pctToGradeWithBoundaries(pct, boundaries);
  }
  return pctToGradeFallback(pct);
}

/** True when the grade came from the generic fallback bands rather than a
 *  boundary set, so the caller can mark it as an estimate. */
export function isApproximateGrade(boundaries: GradeBoundary[] | null): boolean {
  return !boundaries || boundaries.length === 0;
}
