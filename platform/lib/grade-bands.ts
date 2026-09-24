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
 * Slack for comparing a student's proportion with a stored boundary. Callers
 * hand in (earned / total) * 100, and that round trip through floating point
 * can land a hair under a cut-off the student sits exactly on. A per-paper
 * cut-off is stored as floor(m * 10000 / total) / 10000, which is at least
 * 1/total - 1/10000 above the proportion one mark lower, so this margin can
 * never promote a student who is a whole mark short (see grade-bands.test.ts).
 */
const BOUNDARY_EPSILON = 1e-9;

/**
 * Boundary-aware lookup. Walks 7 down to 1 and returns the first grade whose
 * min_proportion the student meets.
 */
export function pctToGradeWithBoundaries(pct: number, boundaries: GradeBoundary[]): number {
  const proportion = pct / 100;
  const sorted = [...boundaries].sort((a, b) => b.grade - a.grade);
  for (const row of sorted) {
    if (proportion + BOUNDARY_EPSILON >= row.min_proportion) return row.grade;
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

// ---------------------------------------------------------------------------
// Per-assessment boundaries, in marks
// ---------------------------------------------------------------------------
//
// A teacher thinks of a paper's boundaries in marks ("a 4 from 28 of 50"),
// the database stores proportions (grade_boundaries.min_proportion,
// numeric(5,4)), and every reader above works in percentages. These helpers
// are the one place that converts between them.

/** The levels a boundary set draws a line for; level 1 is everything below
 *  the level-2 line. Highest first, the order a teacher reads them in. */
export const CUTOFF_GRADES = [7, 6, 5, 4, 3, 2] as const;
export type CutoffGrade = (typeof CUTOFF_GRADES)[number];

/** Minimum marks for each of levels 2..7, at one paper's total. */
export type Cutoffs = Record<CutoffGrade, number>;

/**
 * The fewest marks that reach a stored proportion, at `total` marks.
 * Ceiling, with the same epsilon as minMarksForBand in lib/standards-report.ts
 * (0.4 x 10 = 4.000000000000001 must stay 4), so the number a teacher is shown
 * is exactly the number pctToGradeWithBoundaries awards the level at.
 */
export function minMarksForProportion(proportion: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.ceil(proportion * total - 1e-9));
}

/**
 * A cut-off in marks as a storable proportion: floor(m * 10000 / T) / 10000.
 *
 * DOWN, not to nearest: the column keeps 4 decimal places, and rounding 43/70
 * (0.614285...) up to 0.6143 would ask a student for 43.001 marks, so 43 would
 * no longer earn the level. Flooring loses less than 1/10000, which is less
 * than one mark's worth for any total under 10000, so m marks still reach it
 * and m - 1 still does not. Multiplying before dividing keeps 35/50 at 0.7000
 * instead of 0.6999.
 */
export function marksToProportion(minMarks: number, total: number): number {
  if (total <= 0) return 0;
  return Math.floor((minMarks * 10000) / total) / 10000;
}

function proportionFor(boundaries: GradeBoundary[], grade: number): number | null {
  const row = boundaries.find((b) => b.grade === grade);
  return row ? Number(row.min_proportion) : null;
}

/** Levels 2..7 of a boundary set in marks at `total`, or null if the set
 *  does not draw every one of those lines. */
export function cutoffsFromBoundaries(boundaries: GradeBoundary[] | null, total: number): Cutoffs | null {
  if (!boundaries || boundaries.length === 0 || total <= 0) return null;
  const out = {} as Cutoffs;
  for (const grade of CUTOFF_GRADES) {
    const p = proportionFor(boundaries, grade);
    if (p === null) return null;
    out[grade] = minMarksForProportion(p, total);
  }
  return out;
}

/**
 * Cut-offs in marks back to proportions for levels 2..7, keeping any existing
 * proportion that already lands on the same mark.
 *
 * `prefer` is tried in order (the paper's current boundaries, then the preset
 * it came from). Keeping those values is what lets an untouched Grade 9 paper
 * at 50 marks keep 0.9 / 0.8 / ... rather than an equivalent re-derivation,
 * so "are these the same boundaries?" stays a plain comparison and a test
 * still reads as "Grade 9" until a line really moves. A DP set B cut-off of
 * 0.81 at 70 marks is 57 marks; re-deriving it would store 0.8142.
 */
export function boundariesFromCutoffs(
  cutoffs: Cutoffs,
  total: number,
  prefer: (GradeBoundary[] | null | undefined)[] = []
): GradeBoundary[] {
  return CUTOFF_GRADES.map((grade) => {
    for (const candidate of prefer) {
      if (!candidate) continue;
      const p = proportionFor(candidate, grade);
      if (p !== null && p > 0 && p <= 1 && minMarksForProportion(p, total) === cutoffs[grade]) {
        return { grade, min_proportion: p };
      }
    }
    return { grade, min_proportion: marksToProportion(cutoffs[grade], total) };
  });
}

/** What is wrong with a set of cut-offs, as sentences for the teacher; empty when valid. */
export function validateCutoffs(cutoffs: Partial<Record<CutoffGrade, unknown>>, total: number): string[] {
  const problems: string[] = [];
  if (!Number.isInteger(total) || total <= 0) {
    return ["Set the total marks on this assessment before deciding its boundaries."];
  }
  for (const grade of CUTOFF_GRADES) {
    const m = cutoffs[grade];
    if (typeof m !== "number" || !Number.isInteger(m)) {
      problems.push(`Level ${grade} needs a whole number of marks.`);
    } else if (m < 1 || m > total) {
      problems.push(`Level ${grade} must start between 1 and ${total} marks.`);
    }
  }
  if (problems.length > 0) return problems;
  for (let i = 0; i < CUTOFF_GRADES.length - 1; i++) {
    const hi = CUTOFF_GRADES[i];
    const lo = CUTOFF_GRADES[i + 1];
    if ((cutoffs[hi] as number) <= (cutoffs[lo] as number)) {
      problems.push(`Level ${hi} must need more marks than level ${lo}.`);
    }
  }
  return problems;
}

/** Same lines for levels 2..7 (level 1's 0.01 floor is not a line anyone crosses). */
export function sameBoundaries(a: GradeBoundary[] | null, b: GradeBoundary[] | null): boolean {
  if (!a || !b || a.length === 0 || b.length === 0) return false;
  return CUTOFF_GRADES.every((grade) => {
    const pa = proportionFor(a, grade);
    const pb = proportionFor(b, grade);
    return pa !== null && pb !== null && Math.abs(pa - pb) < 1e-9;
  });
}

/** Same minimum marks for levels 2..7 at one total. */
export function sameCutoffs(a: Cutoffs | null, b: Cutoffs | null): boolean {
  if (!a || !b) return false;
  return CUTOFF_GRADES.every((grade) => a[grade] === b[grade]);
}

/**
 * Boundaries for a total across several papers, from each paper's own.
 *
 * A student's aggregate is (sum of marks) / (sum of totals), so the line that
 * treats every paper's boundary as it stands is the marks-weighted mean of the
 * proportions: sum(p x total) / sum(total). A student sitting exactly on every
 * paper's line sits exactly on the blended one. Identical inputs come back
 * unchanged. Only grades every paper draws are blended.
 */
export function blendBoundaries(parts: { total: number; boundaries: GradeBoundary[] }[]): GradeBoundary[] {
  const usable = parts.filter((p) => p.total > 0 && p.boundaries.length > 0);
  if (usable.length === 0) return [];
  const sumTotals = usable.reduce((s, p) => s + p.total, 0);
  const out: GradeBoundary[] = [];
  for (let grade = 1; grade <= 7; grade++) {
    let weighted = 0;
    let everyPaper = true;
    for (const part of usable) {
      const p = proportionFor(part.boundaries, grade);
      if (p === null) {
        everyPaper = false;
        break;
      }
      weighted += p * part.total;
    }
    if (everyPaper) out.push({ grade, min_proportion: weighted / sumTotals });
  }
  return out;
}

/**
 * The level for an aggregate over several papers (the gradebook's Overall and
 * P1/P2/P3/IA columns).
 *
 * Papers compared by their LINES, not by which set row holds them: now that
 * each assessment has its own set, two papers on identical boundaries have
 * different set ids, and comparing ids would drop every student who sat both
 * back to the generic bands -- the complaint that produced the Grade 9 set.
 * Identical lines are used as they are; different lines are blended; any
 * paper with no boundaries at all still means the generic bands, marked as an
 * estimate.
 */
export function aggregateGrade(
  pct: number,
  contributing: { total_marks: number; boundaries: GradeBoundary[] | null }[]
): { grade: number; approximate: boolean; blended: boolean } {
  if (contributing.length === 0 || contributing.some((t) => !t.boundaries || t.boundaries.length === 0)) {
    return { grade: pctToGradeFallback(pct), approximate: true, blended: false };
  }
  const first = contributing[0].boundaries as GradeBoundary[];
  if (contributing.every((t) => sameBoundaries(t.boundaries, first))) {
    return { grade: resolveGrade(pct, first), approximate: false, blended: false };
  }
  const blended = blendBoundaries(
    contributing.map((t) => ({ total: t.total_marks, boundaries: t.boundaries as GradeBoundary[] }))
  );
  return { grade: resolveGrade(pct, blended), approximate: false, blended: true };
}
