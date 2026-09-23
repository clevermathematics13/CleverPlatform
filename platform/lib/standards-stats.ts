import {
  PERFORMANCE_LEVELS,
  levelForMarks,
  normalisePartRef,
  partRefForItem,
  partRefLabel,
  strandForItem,
  type PerformanceLevel,
  type RubricItem,
  type StandardsRubric,
} from "./standards-rubric";

/**
 * standards-stats.ts
 * -----------------------------------------------------------------------------
 * The teacher's view of a Standard Level paper: how the CLASS did on each
 * part, each question and each strand, rather than how each student did.
 *
 * lib/standards-report-data.ts answers "what level is this student at". This
 * module answers the question a teacher asks straight after handing a paper
 * back: which parts did the class fall down on, which question is worth
 * reteaching, and which parts actually told me anything. The two read the
 * same roster and the same accepted marks (lib/report-roster.ts) so they can
 * never disagree about who sat the paper.
 *
 * Pure and client-safe, like lib/standards-rubric.ts: no fs, no Supabase, no
 * React. Everything here is arithmetic over a list of students and their
 * marks, which is what makes it testable against the KA1 fixture.
 *
 * Three rules run through all of it:
 *
 * 1. A MISSING MARK IS NOT A ZERO. A part a teacher has not accepted yet is
 *    absent from the student's map, and every count here skips it. That is
 *    why each aggregate carries its own `n` rather than a single class size:
 *    a part marked for 10 students and a part marked for 3 are both honest
 *    numbers, and the page prints the n beside the mean so the teacher can
 *    tell them apart.
 *
 * 2. AN AGGREGATE ONLY COUNTS A STUDENT WHO HAS ALL OF IT. A question mean
 *    is over the students with every part of that question marked; a strand
 *    mean over those with every part of the strand; the paper over those
 *    with the whole paper. Averaging a half-marked paper's total against a
 *    whole one would read as a weak student rather than an unfinished one.
 *
 * 3. AN ABSENT STUDENT IS NOT IN ANY OF IT. They did not sit the paper, so
 *    they are neither a zero nor a small n -- the caller filters them out
 *    before the marks get here.
 *
 * 4. NO ATTEMPT IS THE ONE EXCEPTION TO RULE 1, reported on the side rather
 *    than folded into it. `PartStat.noAttemptCount` comes from the AI
 *    grader's OWN blank detection (`StatsSubject.noAttempt`), not from
 *    `marks`, so it is real before a single part is accepted -- which
 *    matters most on exactly the papers where accept-all withholds a
 *    confidently-blank part until a teacher opens it. It is counted over
 *    every present subject, not over `n`, and is not added into any mean,
 *    median or total: a mark that has not been accepted still is not one.
 * -----------------------------------------------------------------------------
 */

// -----------------------------------------------------------------------------
// Input
// -----------------------------------------------------------------------------

/** One student's accepted marks, keyed by test_items.id. Absentees are not passed in. */
export interface StatsSubject {
  subjectId: string;
  name: string;
  /** "9D", so the general Standard Level view can break the numbers down by class. */
  className: string | null;
  marks: ReadonlyMap<string, number>;
  /**
   * Parts (test_items.id) the AI grader's OWN blank detection found no
   * attempt on, from this subject's latest COMPLETE run -- independent of
   * `marks`. A summative withholds exactly these from "Accept all"
   * (lib/summative-grading-gate.ts), so a part can be confidently no-attempt
   * here well before it is a zero in `marks`. Optional and defaults to
   * empty so every existing caller (and fixture) still builds.
   */
  noAttempt?: ReadonlySet<string>;
}

/**
 * Below this many students a discrimination figure is noise dressed as a
 * number, so it is reported as null and the page says "too few" instead.
 * Five is not a statistical threshold -- no threshold would be honest at
 * this scale -- it is the point below which a single student moves the
 * correlation by more than the spread between a good part and a bad one.
 */
export const MIN_STUDENTS_FOR_DISCRIMINATION = 5;

// -----------------------------------------------------------------------------
// Small statistics
// -----------------------------------------------------------------------------

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Population standard deviation: the class IS the population, not a sample of one. */
export function standardDeviation(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Pearson correlation. Null when either list is constant, because a part
 * every student got right (or wrong) has no correlation with anything -- and
 * `0` would read as "this part does not sort the class" when the truth is
 * "this part cannot sort the class".
 */
export function correlation(xs: readonly number[], ys: readonly number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx <= 1e-12 || syy <= 1e-12) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/** Percentage of `max`, 0 when the denominator is 0 so a bonus part cannot divide by zero. */
export function percentOf(marks: number, max: number): number {
  return max > 0 ? (marks / max) * 100 : 0;
}

function emptyLevelCounts(): Record<PerformanceLevel, number> {
  return { exceeding: 0, meeting: 0, approaching: 0, beginning: 0 };
}

// -----------------------------------------------------------------------------
// Output
// -----------------------------------------------------------------------------

export interface PartStat {
  itemId: string;
  /** "2d", the rubric's own grammar. */
  ref: string;
  /** "Q2(d)", the way every other screen writes it. */
  label: string;
  questionNumber: number;
  partLabel: string;
  max: number;
  strandCode: string | null;
  strandName: string | null;
  /** Students with a mark on THIS part. */
  n: number;
  mean: number;
  meanPercent: number;
  sd: number;
  /** How many scored full marks, and how many scored nothing. */
  fullMarks: number;
  zeroMarks: number;
  fullPercent: number;
  zeroPercent: number;
  /**
   * Students the AI grader flagged as having made no attempt on this part,
   * from its own blank detection -- counted over every present student in
   * scope (`noAttemptOf`), not just the `n` who have a mark yet. A summative
   * can hold these back from Clev's Marks (lib/summative-grading-gate.ts),
   * so this is often nonzero while `n` still excludes them.
   */
  noAttemptCount: number;
  /** Of every present student in scope, not of `n`. */
  noAttemptPercent: number;
  /** Counts at each whole mark 0..max. Half marks, if any ever appear, round down into a bucket. */
  distribution: number[];
  /**
   * Corrected item-total correlation over students with a complete paper:
   * this part's mark against the REST of the paper. Null when there are too
   * few complete papers, or when nothing varies. High means the students who
   * did well overall did well here; near zero means the part sorted nobody;
   * NEGATIVE is the one worth looking at, because the class's stronger
   * students did worse on it than the weaker ones, which usually means the
   * part or its mark scheme is saying something other than what it means.
   */
  discrimination: number | null;
}

export interface QuestionStat {
  questionNumber: number;
  /** "Q2". */
  label: string;
  parts: PartStat[];
  max: number;
  /** Students with EVERY part of this question marked. */
  n: number;
  mean: number;
  meanPercent: number;
  sd: number;
  median: number;
  /** Distinct strands this question's parts feed, in rubric order. */
  strandCodes: string[];
}

export interface StrandStat {
  code: string;
  name: string;
  max: number;
  /** Students with EVERY part of this strand marked. */
  n: number;
  mean: number;
  meanPercent: number;
  sd: number;
  levelCounts: Record<PerformanceLevel, number>;
  partRefs: string[];
}

export interface PaperStat {
  /** Students with at least one mark. */
  attempted: number;
  /** Students with every part marked -- the ones every figure below is over. */
  n: number;
  max: number;
  mean: number;
  meanPercent: number;
  median: number;
  sd: number;
  lowest: number;
  highest: number;
  levelCounts: Record<PerformanceLevel, number>;
}

export interface ClassStat {
  className: string | null;
  /** Students with every part marked. */
  n: number;
  mean: number;
  meanPercent: number;
  max: number;
}

export interface StandardsStats {
  paper: PaperStat;
  questions: QuestionStat[];
  parts: PartStat[];
  strands: StrandStat[];
  /** One row per class on the roster, for the general Standard Level view. Empty when only one class has marks. */
  classes: ClassStat[];
}

// -----------------------------------------------------------------------------
// The build
// -----------------------------------------------------------------------------

/**
 * Class statistics for one Standard Level paper.
 *
 * `items` is every part of the test in paper order; `rubric` supplies the
 * strand each part feeds (null for a paper with no rubric, or for a bonus
 * part in no strand); `subjects` is everyone whose marks should count --
 * the caller has already dropped the absentees and applied whatever class
 * filter the teacher chose.
 */
export function buildStandardsStats(args: {
  items: readonly RubricItem[];
  rubric: StandardsRubric | null;
  subjects: readonly StatsSubject[];
}): StandardsStats {
  const { items, rubric, subjects } = args;

  const markOf = (s: StatsSubject, itemId: string): number | null => {
    const v = s.marks.get(itemId);
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const hasAll = (s: StatsSubject, ids: readonly string[]) => ids.every((id) => markOf(s, id) !== null);
  const totalOver = (s: StatsSubject, ids: readonly string[]) =>
    ids.reduce((sum, id) => sum + (markOf(s, id) ?? 0), 0);

  const allIds = items.map((i) => i.id);
  const paperMax = items.reduce((sum, i) => sum + i.max_marks, 0);

  // Students who attempted anything, and the subset with a complete paper.
  // Rule 2 in the header: every cross-part figure is over the complete ones.
  const attempted = subjects.filter((s) => allIds.some((id) => markOf(s, id) !== null));
  const completeSubjects = items.length > 0 ? subjects.filter((s) => hasAll(s, allIds)) : [];
  const completeTotals = completeSubjects.map((s) => totalOver(s, allIds));

  // ---- Parts ---------------------------------------------------------------
  const parts: PartStat[] = items.map((item) => {
    const marks: number[] = [];
    for (const s of subjects) {
      const m = markOf(s, item.id);
      if (m !== null) marks.push(m);
    }
    const distribution = Array.from({ length: Math.max(1, Math.floor(item.max_marks) + 1) }, () => 0);
    for (const m of marks) {
      const bucket = Math.min(distribution.length - 1, Math.max(0, Math.floor(m)));
      distribution[bucket] += 1;
    }
    const fullMarks = marks.filter((m) => m >= item.max_marks).length;
    const zeroMarks = marks.filter((m) => m <= 0).length;
    const noAttemptCount = subjects.filter((s) => s.noAttempt?.has(item.id)).length;

    // Corrected item-total: this part against the rest of the paper, over
    // complete papers only. Subtracting the part is what makes it
    // "corrected" -- leaving it in correlates the part with itself and
    // flatters every part on a short paper.
    let discrimination: number | null = null;
    if (completeSubjects.length >= MIN_STUDENTS_FOR_DISCRIMINATION) {
      const xs = completeSubjects.map((s) => markOf(s, item.id) ?? 0);
      const ys = completeSubjects.map((s, i) => completeTotals[i] - xs[i]);
      discrimination = correlation(xs, ys);
    }

    const strand = rubric ? strandForItem(rubric, item) : null;
    const ref = partRefForItem(item);
    return {
      itemId: item.id,
      ref,
      label: partRefLabel(ref),
      questionNumber: item.question_number,
      partLabel: item.part_label ?? "",
      max: item.max_marks,
      strandCode: strand?.code ?? null,
      strandName: strand?.name ?? null,
      n: marks.length,
      mean: mean(marks),
      meanPercent: percentOf(mean(marks), item.max_marks),
      sd: standardDeviation(marks),
      fullMarks,
      zeroMarks,
      fullPercent: marks.length > 0 ? (fullMarks / marks.length) * 100 : 0,
      zeroPercent: marks.length > 0 ? (zeroMarks / marks.length) * 100 : 0,
      distribution,
      discrimination,
      noAttemptCount,
      noAttemptPercent: subjects.length > 0 ? (noAttemptCount / subjects.length) * 100 : 0,
    };
  });

  // ---- Questions (the grouping the paper itself prints) ---------------------
  const questionOrder: number[] = [];
  const partsByQuestion = new Map<number, PartStat[]>();
  for (const part of parts) {
    let list = partsByQuestion.get(part.questionNumber);
    if (!list) {
      list = [];
      partsByQuestion.set(part.questionNumber, list);
      questionOrder.push(part.questionNumber);
    }
    list.push(part);
  }

  const strandOrder = new Map((rubric?.strands ?? []).map((s, i) => [s.code, i]));
  const questions: QuestionStat[] = questionOrder.map((questionNumber) => {
    const qParts = partsByQuestion.get(questionNumber) ?? [];
    const ids = qParts.map((p) => p.itemId);
    const max = qParts.reduce((sum, p) => sum + p.max, 0);
    const totals = subjects.filter((s) => hasAll(s, ids)).map((s) => totalOver(s, ids));
    const codes = [...new Set(qParts.map((p) => p.strandCode).filter((c): c is string => c !== null))].sort(
      (a, b) => (strandOrder.get(a) ?? 0) - (strandOrder.get(b) ?? 0)
    );
    return {
      questionNumber,
      label: `Q${questionNumber}`,
      parts: qParts,
      max,
      n: totals.length,
      mean: mean(totals),
      meanPercent: percentOf(mean(totals), max),
      sd: standardDeviation(totals),
      median: median(totals),
      strandCodes: codes,
    };
  });

  // ---- Strands -------------------------------------------------------------
  const partByRef = new Map(parts.map((p) => [p.ref, p]));
  const strands: StrandStat[] = (rubric?.strands ?? []).map((strand) => {
    const strandParts = strand.parts
      .map((ref) => partByRef.get(normalisePartRef(ref)))
      .filter((p): p is PartStat => p !== undefined);
    const ids = strandParts.map((p) => p.itemId);
    const max = strandParts.reduce((sum, p) => sum + p.max, 0);
    const counted = subjects.filter((s) => hasAll(s, ids));
    const totals = counted.map((s) => totalOver(s, ids));
    const levelCounts = emptyLevelCounts();
    if (rubric) {
      for (const total of totals) {
        const level = levelForMarks(total, max, rubric.bands);
        if (level) levelCounts[level] += 1;
      }
    }
    return {
      code: strand.code,
      name: strand.name,
      max,
      n: totals.length,
      mean: mean(totals),
      meanPercent: percentOf(mean(totals), max),
      sd: standardDeviation(totals),
      levelCounts,
      partRefs: strandParts.map((p) => p.ref),
    };
  });

  // ---- Paper ---------------------------------------------------------------
  const paperLevels = emptyLevelCounts();
  if (rubric) {
    for (const total of completeTotals) {
      const level = levelForMarks(total, paperMax, rubric.bands);
      if (level) paperLevels[level] += 1;
    }
  }
  const paper: PaperStat = {
    attempted: attempted.length,
    n: completeTotals.length,
    max: paperMax,
    mean: mean(completeTotals),
    meanPercent: percentOf(mean(completeTotals), paperMax),
    median: median(completeTotals),
    sd: standardDeviation(completeTotals),
    lowest: completeTotals.length > 0 ? Math.min(...completeTotals) : 0,
    highest: completeTotals.length > 0 ? Math.max(...completeTotals) : 0,
    levelCounts: paperLevels,
  };

  // ---- Per class, for the general Standard Level view ----------------------
  const classNames: (string | null)[] = [];
  for (const s of completeSubjects) {
    if (!classNames.some((c) => c === s.className)) classNames.push(s.className);
  }
  const classes: ClassStat[] =
    classNames.length > 1
      ? classNames.map((className) => {
          const totals = completeSubjects
            .filter((s) => s.className === className)
            .map((s) => totalOver(s, allIds));
          return {
            className,
            n: totals.length,
            mean: mean(totals),
            meanPercent: percentOf(mean(totals), paperMax),
            max: paperMax,
          };
        })
      : [];

  return { paper, questions, parts, strands, classes };
}

// -----------------------------------------------------------------------------
// What to look at first
// -----------------------------------------------------------------------------

export interface StatsHighlights {
  /** Lowest mean percentage first. Only parts with enough marks to mean anything. */
  hardestParts: PartStat[];
  /** Highest mean percentage first. */
  easiestParts: PartStat[];
  /** Parts at least half the class scored nothing on, hardest first. */
  wholeClassStuck: PartStat[];
  /**
   * Parts at least half the class left with no attempt at all, worst first --
   * distinct from `wholeClassStuck`: that one is "graded zero", this one is
   * "never answered", and it is visible before any accepting happens.
   */
  mostlyNoAttempt: PartStat[];
  /**
   * Parts whose discrimination is negative: the class's stronger students did
   * WORSE here. Worth re-reading the part and its mark scheme before the
   * next paper, which is the whole reason this number is computed.
   */
  negativeDiscrimination: PartStat[];
  /** Weakest question by mean percentage, when there is one to name. */
  weakestQuestion: QuestionStat | null;
  /** Weakest strand by mean percentage, when the paper has a rubric. */
  weakestStrand: StrandStat | null;
}

/** How many students a part needs before it is allowed into a highlight list. */
export const MIN_STUDENTS_FOR_HIGHLIGHT = 3;

/** The three or four things worth reading first, picked out of the full tables. */
export function statsHighlights(stats: StandardsStats, limit = 5): StatsHighlights {
  const usable = stats.parts.filter((p) => p.n >= MIN_STUDENTS_FOR_HIGHLIGHT);
  const byMeanAsc = [...usable].sort((a, b) => a.meanPercent - b.meanPercent || a.ref.localeCompare(b.ref));
  const withQuestions = stats.questions.filter((q) => q.n > 0);
  const withStrands = stats.strands.filter((s) => s.n > 0);
  return {
    hardestParts: byMeanAsc.slice(0, limit),
    easiestParts: [...byMeanAsc].reverse().slice(0, limit),
    wholeClassStuck: byMeanAsc.filter((p) => p.zeroPercent >= 50),
    mostlyNoAttempt: stats.parts
      .filter((p) => p.noAttemptCount >= MIN_STUDENTS_FOR_HIGHLIGHT && p.noAttemptPercent >= 50)
      .sort((a, b) => b.noAttemptPercent - a.noAttemptPercent || a.ref.localeCompare(b.ref)),
    negativeDiscrimination: usable
      .filter((p) => p.discrimination !== null && p.discrimination < 0)
      .sort((a, b) => (a.discrimination ?? 0) - (b.discrimination ?? 0)),
    weakestQuestion:
      withQuestions.length > 0
        ? withQuestions.reduce((lo, q) => (q.meanPercent < lo.meanPercent ? q : lo))
        : null,
    weakestStrand:
      withStrands.length > 0 ? withStrands.reduce((lo, s) => (s.meanPercent < lo.meanPercent ? s : lo)) : null,
  };
}

// -----------------------------------------------------------------------------
// Export
// -----------------------------------------------------------------------------

function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const s = typeof value === "number" ? (Number.isInteger(value) ? String(value) : value.toFixed(2)) : value;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(cells: (string | number | null)[]): string {
  return cells.map(csvCell).join(",");
}

/**
 * The class statistics as a spreadsheet: a question section, a part section
 * and a strand section, separated by blank lines, with a header line above
 * each. Three tables in one file rather than three downloads, because a
 * teacher opening this wants to scroll from "which question" to "which part
 * of it" without changing tab. CRLF line ends, as the standards report CSV
 * uses.
 */
export function buildStandardsStatsCsv(
  stats: StandardsStats,
  meta: { testName: string; scopeLabel: string }
): string {
  const lines: string[] = [];
  lines.push(csvRow([meta.testName, meta.scopeLabel]));
  lines.push(
    csvRow([
      "Students with a complete paper",
      stats.paper.n,
      "Mean",
      stats.paper.mean,
      "out of",
      stats.paper.max,
      "Mean %",
      stats.paper.meanPercent,
      "Median",
      stats.paper.median,
      "SD",
      stats.paper.sd,
    ])
  );

  lines.push("");
  lines.push("Questions");
  lines.push(csvRow(["Question", "Parts", "Strands", "Max", "Students", "Mean", "Mean %", "Median", "SD"]));
  for (const q of stats.questions) {
    lines.push(
      csvRow([
        q.label,
        q.parts.length,
        q.strandCodes.join(" "),
        q.max,
        q.n,
        q.mean,
        q.meanPercent,
        q.median,
        q.sd,
      ])
    );
  }

  lines.push("");
  lines.push("Parts");
  lines.push(
    csvRow([
      "Question",
      "Part",
      "Strand",
      "Max",
      "Students",
      "Mean",
      "Mean %",
      "SD",
      "Full marks",
      "% full",
      "Zero",
      "% zero",
      "No attempt",
      "% no attempt",
      "Discrimination",
    ])
  );
  for (const p of stats.parts) {
    lines.push(
      csvRow([
        `Q${p.questionNumber}`,
        p.partLabel,
        p.strandCode,
        p.max,
        p.n,
        p.mean,
        p.meanPercent,
        p.sd,
        p.fullMarks,
        p.fullPercent,
        p.zeroMarks,
        p.zeroPercent,
        p.noAttemptCount,
        p.noAttemptPercent,
        p.discrimination,
      ])
    );
  }

  if (stats.strands.length > 0) {
    lines.push("");
    lines.push("Strands");
    lines.push(
      csvRow([
        "Strand",
        "Name",
        "Max",
        "Students",
        "Mean",
        "Mean %",
        "SD",
        ...PERFORMANCE_LEVELS.map((l) => l.label),
      ])
    );
    for (const s of stats.strands) {
      lines.push(
        csvRow([
          s.code,
          s.name,
          s.max,
          s.n,
          s.mean,
          s.meanPercent,
          s.sd,
          ...PERFORMANCE_LEVELS.map((l) => s.levelCounts[l.value]),
        ])
      );
    }
  }

  if (stats.classes.length > 0) {
    lines.push("");
    lines.push("Classes");
    lines.push(csvRow(["Class", "Students", "Mean", "Max", "Mean %"]));
    for (const c of stats.classes) {
      lines.push(csvRow([c.className ?? "Unknown", c.n, c.mean, c.max, c.meanPercent]));
    }
  }

  return lines.join("\r\n") + "\r\n";
}
