/**
 * Pure selection and ordering helpers for the AI-grade review panel
 * (app/dashboard/tests/[id]/ai-grade/ai-grade-client.tsx).
 *
 * These exist because the panel is fed by an async, per-student fetch while
 * its heading is driven by whichever roster row was clicked last. Nothing
 * correlated the two, so a slow or failed response could leave one student's
 * rows rendered under another student's name -- observed in production on
 * 2 Sep 2026, where Salim Fellah's run (22/33, Q4(b) and Q4(c) reported as
 * "no attempt found") displayed under the heading "Review - Luciana Rojas".
 * No marks were ever mis-written: the accept route resolves the student from
 * the run, never from the panel. It was a display crossing only.
 *
 * Keeping the run/row pairing and the row ordering here, as pure functions,
 * is what makes both testable without rendering the component.
 */

/** Minimal shape of ai_grade_runs needed to pick a student's current run. */
export interface ReviewRunRef {
  id: string;
  student_id: string;
  created_at?: string | null;
}

/** Minimal shape of ai_grade_results needed to bind rows to a run. */
export interface ReviewResultRef {
  run_id: string;
}

/** Minimal shape of test_items needed to order rows the way a paper reads. */
export interface ReviewItemRef {
  question_number: number;
  part_label?: string | null;
}

/**
 * The runs belonging to `studentId`, newest first.
 *
 * The API already filters by student and returns newest-first, so both the
 * student_id check and the re-sort are redundant on the happy path -- they
 * are here so that a response for the wrong student (a stale in-flight
 * request, a future caller that forgets the query parameter) yields nothing
 * rather than another student's marks, and so callers that pick the first
 * entry are not trusting array position for recency.
 *
 * Callers filter this further (e.g. to complete runs only); returning the
 * list rather than one run is what lets them do that without dropping the
 * ownership guard.
 */
export function runsForStudent<R extends ReviewRunRef>(studentId: string, runs: R[]): R[] {
  return runs
    .filter((r) => r.student_id === studentId)
    .sort((a, b) => {
      const ta = a.created_at ? Date.parse(a.created_at) : NaN;
      const tb = b.created_at ? Date.parse(b.created_at) : NaN;
      if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
      if (Number.isNaN(ta)) return 1;
      if (Number.isNaN(tb)) return -1;
      return tb - ta;
    });
}

/**
 * The rows belonging to one run. A null run id yields no rows at all: an
 * unresolved run means there is nothing safe to show, and falling back to
 * "every row in the payload" is how another run's rows leak into the panel.
 */
export function rowsForRun<T extends ReviewResultRef>(runId: string | null, rows: T[]): T[] {
  if (!runId) return [];
  return rows.filter((r) => r.run_id === runId);
}

const ROMAN_RANK: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5 };

/**
 * Sort key for a part label: "a" -> letter "a", "bii" -> letter "b", roman 2.
 * A whole-question row (empty label) sorts before any of its parts. An
 * unrecognised label falls back to comparing the raw string, so it still
 * orders deterministically instead of arbitrarily.
 */
export function partSortKey(partLabel: string | null | undefined): {
  letter: string;
  roman: number;
} {
  const p = (partLabel ?? "").trim().toLowerCase();
  if (!p) return { letter: "", roman: 0 };
  const m = p.match(/^([a-z])(i{1,3}|iv|v)?$/);
  if (m) return { letter: m[1], roman: m[2] ? ROMAN_RANK[m[2]] : 0 };
  return { letter: p, roman: 0 };
}

/**
 * Orders review rows the way the paper reads: question number, then part
 * letter, then roman sub-part. Sorting on question number alone leaves parts
 * of the same question in whatever order the model happened to emit them --
 * which is how "Q4(b), Q4(a), Q4(c)" reached a teacher's screen.
 *
 * Rows whose test item cannot be resolved sort last, keeping their relative
 * order.
 */
export function sortReviewRows<T>(rows: T[], itemFor: (row: T) => ReviewItemRef | undefined): T[] {
  return rows.slice().sort((rowA, rowB) => {
    const a = itemFor(rowA);
    const b = itemFor(rowB);
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    if (a.question_number !== b.question_number) return a.question_number - b.question_number;
    const ka = partSortKey(a.part_label);
    const kb = partSortKey(b.part_label);
    if (ka.letter !== kb.letter) return ka.letter < kb.letter ? -1 : 1;
    return ka.roman - kb.roman;
  });
}

/** Minimal shape of an ai_grade_results row needed to split the review table. */
export interface ReviewConfidenceRef {
  confidence: string;
}

/**
 * Splits already-ordered review rows into the parts a teacher still has to
 * look at and the high-confidence ones the panel groups under a single
 * summary row.
 *
 * A full paper is 20-plus rows of which most are marked "high", so the parts
 * that actually need a human -- the medium, the low, the ones with no working
 * found -- were scattered down a table the teacher had to read end to end.
 * Gathering the confident ones under one row puts the flagged parts at the
 * top and makes the rest foldable in one click; the panel leaves that row
 * open, so nothing is hidden by default.
 *
 * Relative order is preserved inside both halves, so each still reads in
 * paper order when the caller has sorted the input with sortReviewRows.
 */
export function partitionByConfidence<T extends ReviewConfidenceRef>(
  rows: T[]
): { high: T[]; needsLook: T[] } {
  const high: T[] = [];
  const needsLook: T[] = [];
  for (const row of rows) {
    if (row.confidence === "high") high.push(row);
    else needsLook.push(row);
  }
  return { high, needsLook };
}

/** Minimal shape of an ai_grade_results row needed to decide a default checkbox state. */
export interface ReviewPreselectRef {
  accepted: boolean;
  work_found: boolean;
  confidence: string;
}

/**
 * Whether a review row's "accept into Clev's Marks" checkbox should start
 * ticked when a student's results first load.
 *
 * Deliberately narrower than "not already accepted, and the model found
 * work": that pre-selected medium and low confidence suggestions the same
 * as high-confidence ones, so a teacher who trusted the pre-ticked state and
 * clicked "Accept N into Clev's Marks" without opening every row could write
 * a suggestion the model itself flagged as needing a look straight into a
 * student's grade. Only a high-confidence suggestion the model actually
 * found work for gets to default to accepted; everything gradeNeedsReview
 * (lib/ai-grading.ts) would flag starts unticked, same predicate, one place.
 */
export function shouldPreselect(row: ReviewPreselectRef): boolean {
  return !row.accepted && row.work_found && row.confidence === "high";
}
