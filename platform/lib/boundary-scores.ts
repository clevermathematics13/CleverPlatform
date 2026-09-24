/**
 * Every student's total on one paper, and where grade boundaries would put
 * them -- the numbers the grade-boundaries page and the AI suggestion work
 * from.
 *
 * A boundary decision cannot wait for every mark to be accepted, so a total
 * here counts, part by part:
 *
 *   1. Clev's Mark (student_marks), when the part has been accepted;
 *   2. otherwise the marker's suggested mark from the student's newest
 *      complete run (ai_grade_results.suggested_marks);
 *   3. otherwise 0 -- the marker never returned the part -- and the part is
 *      listed, because 0 is a guess.
 *
 * A student with an unaccepted or never-marked part is PROVISIONAL, and every
 * count is available two ways: everyone scored, or only students whose every
 * part is accepted. Absent students are kept (flagged) but never counted.
 *
 * Pure and client-safe: the page recomputes counts as the teacher edits.
 */

import { CUTOFF_GRADES, pctToGradeFallback, type CutoffGrade, type Cutoffs } from "./grade-bands";
import { mean, median } from "./standards-stats";

export interface ScoreItem {
  id: string;
  maxMarks: number;
  /** Index into the paper's sections (lib/test-sections.ts paperSections). */
  sectionIndex: number;
  /** The label the teacher knows the part by, e.g. "4.4(b)". */
  label: string;
}

export interface SubjectMarksInput {
  subjectId: string;
  name: string;
  className: string | null;
  absent: boolean;
  /** test_items.id -> Clev's Mark. */
  accepted: ReadonlyMap<string, number>;
  /** test_items.id -> suggested mark from the newest complete run; null when the student has no run. */
  suggested: ReadonlyMap<string, number> | null;
}

export type ScoreStatus = "complete" | "provisional" | "unmarked";

export interface SubjectScore {
  subjectId: string;
  name: string;
  className: string | null;
  absent: boolean;
  status: ScoreStatus;
  /** Null only when nothing at all is marked yet. */
  total: number | null;
  acceptedParts: number;
  /** Parts whose mark is still the marker's suggestion. */
  pendingParts: number;
  /** Parts with neither an accepted nor a suggested mark, counted as 0. */
  neverMarked: { itemId: string; label: string; maxMarks: number }[];
  sectionTotals: number[];
}

export function mergeSubjectScores(
  items: readonly ScoreItem[],
  sectionCount: number,
  subjects: readonly SubjectMarksInput[]
): SubjectScore[] {
  return subjects.map((s) => {
    let total = 0;
    let acceptedParts = 0;
    let pendingParts = 0;
    const neverMarked: SubjectScore["neverMarked"] = [];
    const sectionTotals = Array.from({ length: sectionCount }, () => 0);
    for (const item of items) {
      const accepted = s.accepted.get(item.id);
      const suggested = s.suggested?.get(item.id);
      let mark = 0;
      if (typeof accepted === "number") {
        mark = accepted;
        acceptedParts++;
      } else if (typeof suggested === "number") {
        mark = suggested;
        pendingParts++;
      } else {
        neverMarked.push({ itemId: item.id, label: item.label, maxMarks: item.maxMarks });
      }
      total += mark;
      if (item.sectionIndex >= 0 && item.sectionIndex < sectionCount) sectionTotals[item.sectionIndex] += mark;
    }
    const nothing = acceptedParts === 0 && pendingParts === 0;
    const status: ScoreStatus = nothing
      ? "unmarked"
      : acceptedParts === items.length
      ? "complete"
      : "provisional";
    return {
      subjectId: s.subjectId,
      name: s.name,
      className: s.className,
      absent: s.absent,
      status,
      total: nothing ? null : total,
      acceptedParts,
      pendingParts,
      neverMarked: nothing ? [] : neverMarked,
      sectionTotals,
    };
  });
}

/** Which students a count covers: everyone with a score, or only those with every part accepted. */
export type CountView = "all" | "complete";

export function countedScores(scores: readonly SubjectScore[], view: CountView): SubjectScore[] {
  return scores.filter(
    (s) => !s.absent && s.total !== null && (view === "all" || s.status === "complete")
  );
}

export type Level = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type LevelCounts = Record<Level, number>;

export function emptyLevelCounts(): LevelCounts {
  return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
}

/**
 * The level a score earns. With no cut-offs (a paper with no boundaries) it is
 * the generic fallback bands, the same estimate the gradebook shows with `~`.
 */
export function levelForScore(score: number, total: number, cutoffs: Cutoffs | null): Level {
  if (!cutoffs) return pctToGradeFallback(total > 0 ? (score / total) * 100 : 0) as Level;
  for (const grade of CUTOFF_GRADES) if (score >= cutoffs[grade]) return grade;
  return 1;
}

export function levelCounts(
  scores: readonly SubjectScore[],
  total: number,
  cutoffs: Cutoffs | null,
  view: CountView
): { counts: LevelCounts; n: number } {
  const counts = emptyLevelCounts();
  const counted = countedScores(scores, view);
  for (const s of counted) counts[levelForScore(s.total as number, total, cutoffs)]++;
  return { counts, n: counted.length };
}

/** How many counted students a change of boundaries moves up and down. */
export function levelMoves(
  scores: readonly SubjectScore[],
  total: number,
  from: Cutoffs | null,
  to: Cutoffs | null,
  view: CountView
): { up: number; down: number } {
  let up = 0;
  let down = 0;
  for (const s of countedScores(scores, view)) {
    const a = levelForScore(s.total as number, total, from);
    const b = levelForScore(s.total as number, total, to);
    if (b > a) up++;
    else if (b < a) down++;
  }
  return { up, down };
}

export interface HistogramBin {
  score: number;
  complete: number;
  provisional: number;
}

/** Students on each score from 0 to `total`, split by whether every part is accepted. */
export function scoreHistogram(scores: readonly SubjectScore[], total: number): HistogramBin[] {
  const bins: HistogramBin[] = Array.from({ length: Math.max(0, total) + 1 }, (_, score) => ({
    score,
    complete: 0,
    provisional: 0,
  }));
  for (const s of countedScores(scores, "all")) {
    const t = Math.min(Math.max(0, s.total as number), total);
    if (s.status === "complete") bins[t].complete++;
    else bins[t].provisional++;
  }
  return bins;
}

function studentsOn(hist: readonly HistogramBin[], score: number): number {
  const bin = hist[score];
  return bin ? bin.complete + bin.provisional : 0;
}

export interface ClusterSplit {
  grade: CutoffGrade;
  line: number;
  /** Students one mark under the line. */
  below: number;
  /** Students exactly on the line. */
  at: number;
}

/**
 * Lines drawn between two occupied scores: students one mark apart landing in
 * different levels. Not wrong in itself, but worth a look -- the one-mark
 * difference is within marking noise, and an empty score nearby would make
 * the same cut without the cliff.
 */
export function clusterSplits(hist: readonly HistogramBin[], cutoffs: Cutoffs): ClusterSplit[] {
  const out: ClusterSplit[] = [];
  for (const grade of CUTOFF_GRADES) {
    const line = cutoffs[grade];
    const below = studentsOn(hist, line - 1);
    const at = studentsOn(hist, line);
    if (below > 0 && at > 0) out.push({ grade, line, below, at });
  }
  return out;
}

/** Scores nobody got within `window` marks of `anchor`, nearest first: where a line cuts cleanly. */
export function emptyScoresNear(hist: readonly HistogramBin[], anchor: number, window = 3): number[] {
  const out: number[] = [];
  for (let d = 0; d <= window; d++) {
    for (const score of d === 0 ? [anchor] : [anchor - d, anchor + d]) {
      if (score >= 1 && score < hist.length && studentsOn(hist, score) === 0) out.push(score);
    }
  }
  return out;
}

export interface WatchEntry {
  subjectId: string;
  name: string;
  className: string | null;
  total: number;
  level: Level;
  reasons: string[];
}

/**
 * Provisional students whose level hangs on marks not yet final: one mark
 * under a line, sitting on a line with parts still unaccepted, or with
 * never-marked parts worth enough to cross a line. These are the scripts to
 * finish first before a decision is final.
 */
export function watchList(
  scores: readonly SubjectScore[],
  total: number,
  cutoffs: Cutoffs | null,
  window = 1
): WatchEntry[] {
  if (!cutoffs) return [];
  const out: WatchEntry[] = [];
  for (const s of countedScores(scores, "all")) {
    if (s.status === "complete") continue;
    const t = s.total as number;
    const reasons: string[] = [];
    const missing = s.neverMarked.reduce((sum, p) => sum + p.maxMarks, 0);
    for (const grade of CUTOFF_GRADES) {
      const line = cutoffs[grade];
      if (t < line && line - t <= window && s.pendingParts > 0) {
        reasons.push(`${line - t} mark${line - t === 1 ? "" : "s"} under the ${grade} line (${line}), with ${s.pendingParts} part${s.pendingParts === 1 ? "" : "s"} not accepted`);
      } else if (t < line && missing > 0 && t + missing >= line) {
        const labels = s.neverMarked.map((p) => p.label).join(", ");
        reasons.push(`${labels} never marked: ${line - t} mark${line - t === 1 ? "" : "s"} there would reach the ${grade} line (${line})`);
      }
      if (t >= line && t - line < window && s.pendingParts > 0) {
        reasons.push(`on the ${grade} line (${line}) with ${s.pendingParts} part${s.pendingParts === 1 ? "" : "s"} not accepted`);
      }
    }
    if (reasons.length > 0) {
      out.push({
        subjectId: s.subjectId,
        name: s.name,
        className: s.className,
        total: t,
        level: levelForScore(t, total, cutoffs),
        reasons,
      });
    }
  }
  return out.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

export interface ScoreSummary {
  roster: number;
  absent: number;
  unmarked: number;
  scored: number;
  complete: number;
  provisional: number;
  /** Parts counted as 0 because nobody marked them, across all students. */
  neverMarkedParts: number;
  mean: number | null;
  median: number | null;
}

export function scoreSummary(scores: readonly SubjectScore[]): ScoreSummary {
  const counted = countedScores(scores, "all");
  const totals = counted.map((s) => s.total as number);
  return {
    roster: scores.length,
    absent: scores.filter((s) => s.absent).length,
    unmarked: scores.filter((s) => !s.absent && s.total === null).length,
    scored: counted.length,
    complete: counted.filter((s) => s.status === "complete").length,
    provisional: counted.filter((s) => s.status === "provisional").length,
    neverMarkedParts: counted.reduce((n, s) => n + s.neverMarked.length, 0),
    mean: totals.length > 0 ? mean(totals) : null,
    median: totals.length > 0 ? median(totals) : null,
  };
}

/**
 * What a decision or a suggestion records about the class: counts only, no
 * names or ids, so it can be kept and shown later without exposing anyone.
 */
export function distributionSnapshot(
  scores: readonly SubjectScore[],
  total: number,
  cutoffs: Cutoffs | null
): {
  total: number;
  summary: ScoreSummary;
  levels: { all: LevelCounts; complete: LevelCounts };
  histogram: [number, number, number][];
} {
  return {
    total,
    summary: scoreSummary(scores),
    levels: {
      all: levelCounts(scores, total, cutoffs, "all").counts,
      complete: levelCounts(scores, total, cutoffs, "complete").counts,
    },
    // [score, complete, provisional], occupied scores only
    histogram: scoreHistogram(scores, total)
      .filter((b) => b.complete + b.provisional > 0)
      .map((b) => [b.score, b.complete, b.provisional]),
  };
}
