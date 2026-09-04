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
