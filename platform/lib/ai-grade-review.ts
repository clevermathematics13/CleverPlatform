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
 *
 * The roster's choice of each student's run (latestRunsByStudent) lives here
 * too, and GET /api/tests/[id]/ai-grade imports it: the route counts accepted
 * parts only for the run the page will show, so the two must pick the same
 * run, and one function is how they cannot drift apart.
 */

import { formatGradingSubject } from "./grading-subject";

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

/** Minimal shape of ai_grade_runs needed to pick each student's run for the roster. */
export interface OverviewRunRef {
  id: string;
  /** The opaque subject id (lib/grading-subject.ts); null only for a run with neither identity column set. */
  student_id: string | null;
  status: string;
}

/**
 * Each student's runs as the roster reads them, out of the whole-class list:
 *
 *   latestComplete  the newest COMPLETE run -- the one reviewed, counted and
 *                   accepted. A failed or half-finished attempt has no
 *                   results, and treating it as "the" run once hid a
 *                   student's real graded work behind an empty one.
 *   newerAttempt    the newest run of any status when that is NOT the
 *                   complete one (a failed re-mark, one still running, one
 *                   queued overnight), kept so the roster can still show it.
 *
 * `runs` must already be newest first, in the order GET
 * /api/tests/[id]/ai-grade returns them (created_at desc, then id asc), and
 * the first match wins. It deliberately never re-sorts. The route picks the
 * runs whose acceptance it counts with this function over that same array,
 * and a tab still running the page from before this function existed walks
 * the array the same way, so all of them agree on a student's run by
 * construction. Re-sorting on parsed timestamps could split them: one
 * overnight submission inserts a whole class at the same microsecond, and
 * Date.parse keeps only milliseconds.
 *
 * A run with no subject is skipped -- no roster row can show it.
 */
export function latestRunsByStudent<R extends OverviewRunRef>(
  runs: readonly R[]
): { latestComplete: Record<string, R>; newerAttempt: Record<string, R> } {
  const latestComplete: Record<string, R> = {};
  const newestAny: Record<string, R> = {};
  for (const r of runs) {
    if (!r.student_id) continue;
    if (!newestAny[r.student_id]) newestAny[r.student_id] = r;
    if (r.status === "complete" && !latestComplete[r.student_id]) latestComplete[r.student_id] = r;
  }
  const newerAttempt: Record<string, R> = {};
  for (const [studentId, r] of Object.entries(newestAny)) {
    if (latestComplete[studentId]?.id !== r.id) newerAttempt[studentId] = r;
  }
  return { latestComplete, newerAttempt };
}

/** Minimal shape of ai_grade_results needed to count a run's accepted parts. */
export interface AcceptanceRef {
  run_id: string;
  accepted: boolean;
}

/**
 * How many of each run's result rows are accepted into Clev's Marks, keyed by
 * run id -- what the roster's status dot shows. A run with no rows gets no
 * entry at all, which the roster reads as "nothing to show".
 */
export function acceptanceByRunFrom(
  rows: readonly AcceptanceRef[]
): Record<string, { accepted: number; total: number }> {
  const counts: Record<string, { accepted: number; total: number }> = {};
  for (const r of rows) {
    const c = counts[r.run_id] ?? { accepted: 0, total: 0 };
    c.total += 1;
    if (r.accepted) c.accepted += 1;
    counts[r.run_id] = c;
  }
  return counts;
}

// ---- What ClevMarks holds, beside what the AI suggested ---------------------
//
// A run's coverage.suggestedTotal is the model's own total, written when the
// run finished. It never moves when a teacher accepts or changes a mark --
// suggested_marks is the audit trail's record of what the model said -- so a
// roster that showed it alone read "37/50 suggested" for a student whose
// review panel, which shows what ClevMarks holds, said 41 (Key Assessment 1,
// 25 Sep 2026: three parts the teacher had marked up). The roster now prints
// both, and these are what it prints them from.

/**
 * One result row as the roster reads it: whether it is accepted, and what
 * ClevMarks holds for its part. `marks_awarded` is null when ClevMarks has no
 * mark for the part, and absent when ClevMarks could not be read -- which
 * says nothing about the student, so it never counts as "no mark".
 */
export interface OverviewResultRef extends AcceptanceRef {
  marks_awarded?: number | null;
}

/** One student_marks row, as far as the roster reads it. */
export interface ClevMarkRow {
  test_item_id: string;
  student_id: string | null;
  invited_student_id: string | null;
  marks_awarded: number | null;
}

/**
 * The roster's result rows with what ClevMarks holds for each part attached,
 * matched on the run's student (an opaque subject id, as the roster's runs
 * carry it) and the part. test_item_id is dropped again: the page needs only
 * the mark, and this goes out for every part of every student's run.
 *
 * `marks` is null when ClevMarks could not be read; the rows then go out
 * without marks_awarded at all, so the roster leaves the figure off rather
 * than reporting nothing in ClevMarks.
 */
export function attachClevMarks(
  rows: readonly (AcceptanceRef & { test_item_id: string })[],
  runs: readonly { id: string; student_id: string | null }[],
  marks: readonly ClevMarkRow[] | null
): OverviewResultRef[] {
  if (!marks) return rows.map((r) => ({ run_id: r.run_id, accepted: r.accepted }));
  const subjectByRun = new Map(runs.map((r) => [r.id, r.student_id]));
  const markByPart = new Map<string, number>();
  for (const m of marks) {
    const subject = formatGradingSubject(m);
    if (subject && typeof m.marks_awarded === "number") markByPart.set(`${subject}:${m.test_item_id}`, m.marks_awarded);
  }
  return rows.map((r) => {
    const subject = subjectByRun.get(r.run_id);
    return {
      run_id: r.run_id,
      accepted: r.accepted,
      marks_awarded: subject ? markByPart.get(`${subject}:${r.test_item_id}`) ?? null : null,
    };
  });
}

/** What ClevMarks holds over one run's parts -- the roster's "ClevMarks 41/50". */
export interface ClevMarksSummary {
  /** The marks ClevMarks holds for the run's parts, added up. */
  total: number;
  /** How many of the run's parts ClevMarks has a mark for. */
  marked: number;
  /** How many parts the run has. */
  parts: number;
}

/**
 * What ClevMarks holds over each run's parts, keyed by run id. A row whose
 * mark could not be read (marks_awarded absent) is skipped, so a run none of
 * whose rows could be read gets no entry -- the same as a run with no rows.
 */
export function clevMarksByRunFrom(
  rows: readonly { run_id: string; marks_awarded?: number | null }[]
): Record<string, ClevMarksSummary> {
  const byRun: Record<string, ClevMarksSummary> = {};
  for (const r of rows) {
    if (r.marks_awarded === undefined) continue;
    const s = (byRun[r.run_id] ??= { total: 0, marked: 0, parts: 0 });
    s.parts += 1;
    if (typeof r.marks_awarded === "number") {
      s.total += r.marks_awarded;
      s.marked += 1;
    }
  }
  return byRun;
}

/**
 * The marks on a student's roster line, after "Last run: complete": what the
 * AI suggested, then what ClevMarks holds for the same parts, out of the same
 * maximum so the two compare directly. ClevMarks is left off until it holds a
 * mark for at least one part, and says "so far" until it holds one for all.
 */
export function rosterMarkSegments(
  coverage: { suggestedTotal?: number; maxTotal?: number; testTotalMarks?: number } | null | undefined,
  clevMarks: ClevMarksSummary | undefined
): string[] {
  const segments: string[] = [];
  const max = coverage?.maxTotal;
  if (coverage?.suggestedTotal !== undefined && max !== undefined) {
    // "of 33 total" when parts without a mark scheme were never marked, so
    // 20 is not mistaken for the whole paper.
    const ofTotal =
      typeof coverage.testTotalMarks === "number" && coverage.testTotalMarks !== max
        ? ` of ${coverage.testTotalMarks} total`
        : "";
    segments.push(`AI suggested ${coverage.suggestedTotal}/${max}${ofTotal}`);
  }
  if (clevMarks && clevMarks.marked > 0) {
    const figure = `ClevMarks ${clevMarks.total}${max !== undefined ? `/${max}` : ""}`;
    segments.push(
      clevMarks.marked === clevMarks.parts
        ? figure
        : `${figure} so far (${clevMarks.marked} of ${clevMarks.parts} parts)`
    );
  }
  return segments;
}

/**
 * The review panel's total: the marks in the boxes -- ClevMarks for an
 * accepted part, the suggestion or the teacher's edit for the rest -- beside
 * the AI's own total, and how many parts the two disagree on.
 */
export function reviewMarkTotals(
  rows: readonly { id: string; suggested_marks: number }[],
  drafts: Readonly<Record<string, number>>
): { total: number; aiTotal: number; changed: number } {
  let total = 0;
  let aiTotal = 0;
  let changed = 0;
  for (const r of rows) {
    // ?? 0, as the box itself shows it.
    const mark = drafts[r.id] ?? 0;
    total += mark;
    aiTotal += r.suggested_marks;
    if (mark !== r.suggested_marks) changed += 1;
  }
  return { total, aiTotal, changed };
}

/** Minimal shape of ai_grade_runs needed for the roster's overnight counts. */
export interface OverviewStateRunRef extends OverviewRunRef {
  /** The Anthropic message batch a run is still tied to, or null once it is settled. */
  pending_message_batch_id: string | null;
}

/** What the roster shows about a test's runs (see deriveOverviewState). */
export interface OverviewState<R> {
  /** Newest COMPLETE run per student -- the one whose results are reviewable. */
  runsByStudent: Record<string, R>;
  /** Newest run of any status per student, when it is NOT the complete one. */
  newerAttemptByStudent: Record<string, R>;
  /** Accepted and total parts of each student's newest complete run, keyed by run id. */
  acceptanceByRun: Record<string, { accepted: number; total: number }>;
  /** What ClevMarks holds over each student's newest complete run, keyed by run id. */
  clevMarksByRun: Record<string, ClevMarksSummary>;
  /** Distinct students with a run still at Anthropic -- the overnight banner. */
  submittedStudentCount: number;
  /** Runs the page still owes a collect call for -- what keeps the poll going. */
  outstandingCollectCount: number;
}

/**
 * The roster's view of GET /api/tests/[id]/ai-grade's whole-class answer
 * (`runs` newest first, `results` the { run_id, accepted, marks_awarded }
 * rows it sends). The page works this out on the server for its first render
 * and in the browser on every refresh after that, so both go through here.
 */
export function deriveOverviewState<R extends OverviewStateRunRef>(
  runs: readonly R[],
  results: readonly OverviewResultRef[]
): OverviewState<R> {
  const { latestComplete, newerAttempt } = latestRunsByStudent(runs);
  return {
    runsByStudent: latestComplete,
    newerAttemptByStudent: newerAttempt,
    // The route sends a row for each part of each student's newest complete
    // run only -- exactly what these count.
    acceptanceByRun: acceptanceByRunFrom(results),
    clevMarksByRun: clevMarksByRunFrom(results),
    // Counted off the raw run list, not the newest-run-per-student map: a
    // student marked in the browser after being queued overnight has a
    // newer complete run, which would hide their still-pending one and stop
    // the poll from ever starting. Distinct students, because the banner
    // counts people -- two submissions for one student before either
    // collects is one student waiting, not two.
    submittedStudentCount: new Set(runs.filter((r) => r.status === "submitted").map((r) => r.student_id)).size,
    // Runs, not distinct students: nothing renders this, it only has to be
    // zero exactly when there is nothing left for a collect pass to do. A
    // "running" run without a batch pointer is an ordinary interactive
    // grade in flight, which collect has no business with.
    outstandingCollectCount: runs.filter(
      (r) => r.status === "submitted" || (r.status === "running" && r.pending_message_batch_id !== null)
    ).length,
  };
}

/** One roster entry as GET /api/students serves it (lib/course-roster.ts), as far as the roster reads it. */
export interface RosterSourceRef {
  profile_id?: string | null;
  profiles: { display_name: string; nickname: string | null } | null;
  course_id?: string;
  course_name?: string | null;
}

/** One student as the AI-grade roster lists them. */
export interface RosterOption {
  /**
   * The opaque subject id every AI-grade endpoint expects as studentId --
   * usually a real profiles.id, but "invited-<invited_students.id>" for a
   * roster entry imported (e.g. via Google Classroom) that has never logged
   * in and so has no profiles row yet. See parseGradingSubject in
   * lib/grading-subject.ts; the page never needs to tell the two apart.
   */
  profile_id: string;
  display_name: string;
  /**
   * The real class the student is in ("9A"). A Grade 9 test sits on one
   * class but its roster pools every class in the track, so the page groups
   * by this. Null when the roster could not name the class.
   */
  class_name: string | null;
  /**
   * That class's course id, which the Batch upload tab sends as the class a
   * scan came from (names on its cover pages are matched against that class
   * only). Null when the roster could not say.
   */
  class_id: string | null;
}

/**
 * The one collation the roster is sorted with. The page sorts it on the
 * server for its first render and again in the browser whenever it reloads
 * the roster, and localeCompare with no locale uses each runtime's own: a
 * Spanish-language browser sorts n-tilde after every "n" ("Munro" before
 * "Munoz" spelt with the tilde), the server as a plain "n", so the list could
 * reorder itself under the teacher on the first refresh. "en" is the
 * server's own order, the one the report pages sort by.
 */
const ROSTER_COLLATOR = new Intl.Collator("en");

/**
 * The roster in the order the page lists it: the test's own class first,
 * then the classes pooled with it alphabetically, then students whose class
 * is unknown; by name within each. A row with no subject id is dropped --
 * nothing on the page could act on it.
 *
 * Full name first -- the batch-upload dropdown needs it to tell apart
 * students who share a first name or nickname. The nickname is shown
 * alongside when it differs, since that is often what a teacher recognises
 * a cover-page name against.
 */
export function buildRosterOptions(rows: readonly RosterSourceRef[], ownCourseId: string | null): RosterOption[] {
  const ownClass = rows.find((s) => s.course_id === ownCourseId)?.course_name ?? null;
  const classRank = (name: string | null) => (name === ownClass ? 0 : name ? 1 : 2);
  return rows
    .filter((s): s is RosterSourceRef & { profile_id: string } => !!s.profile_id)
    .map((s) => {
      const fullName = s.profiles?.display_name;
      const nickname = s.profiles?.nickname;
      const label =
        fullName && nickname && nickname !== fullName
          ? `${fullName} (${nickname})`
          : fullName || nickname || "Unknown";
      return {
        profile_id: s.profile_id,
        display_name: label,
        class_name: s.course_name ?? null,
        class_id: s.course_id ?? null,
      };
    })
    .sort(
      (a, b) =>
        classRank(a.class_name) - classRank(b.class_name) ||
        ROSTER_COLLATOR.compare(a.class_name ?? "", b.class_name ?? "") ||
        ROSTER_COLLATOR.compare(a.display_name, b.display_name)
    );
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

// ---- Why a row is not "high" ------------------------------------------------
//
// The validator (lib/ai-grading.ts, validateGradeResponse) records every
// reason it touched a part's mark or confidence as one string in the run's
// coverage.warnings, prefixed with the part's label exactly as unitLabel()
// prints it: "1(b): reasoning hedges on reading ...". The review panel and
// scripts/confidence-calibration.ts both need to read those back per part, so
// the label format and the cause classification live here, once, where the
// browser can import them (lib/ai-grading.ts reads policy files from disk and
// cannot be bundled for the client).

/** Minimal shape of a test item needed to rebuild its warning label. */
export interface WarningLabelRef {
  question_number: number;
  part_label?: string | null;
}

/**
 * The label unitLabel() in lib/ai-grading.ts prints for a part -- "3(b)(ii)",
 * "5" -- rebuilt from the test_items row the browser has. The two must agree
 * character for character or a part's warnings are never found; the test
 * beside this module pins them together.
 */
export function partWarningLabel(item: WarningLabelRef): string {
  const p = (item.part_label ?? "").trim();
  if (!p) return String(item.question_number);
  const m = p.match(/^([a-z])(i{1,3}|iv|v)?$/i);
  if (m) {
    return m[2]
      ? `${item.question_number}(${m[1].toLowerCase()})(${m[2].toLowerCase()})`
      : `${item.question_number}(${m[1].toLowerCase()})`;
  }
  return `${item.question_number}(${p})`;
}

/**
 * The warnings that belong to one part, with the "label: " prefix removed.
 * A warning about another part, or one with no part prefix (an assembly
 * warning about the whole test), is left out.
 */
export function warningsForPart(label: string, warnings: readonly string[] | null | undefined): string[] {
  const prefix = `${label}: `;
  return (warnings ?? []).filter((w) => w.startsWith(prefix)).map((w) => w.slice(prefix.length));
}

/**
 * The warnings that belong to any of these parts, prefix KEPT, in the order
 * they were written. This is what a partial re-mark copies from the previous
 * run for the parts it carries forward (lib/ai-grading-run.ts,
 * persistGradeOutcome): the row is copied verbatim, so the reason it is not
 * "high" must travel with it, or the panel reads the carried part's warnings
 * from the new run, finds none, and calls a validator cap the marker's own
 * call.
 */
export function warningsForParts(
  labels: Iterable<string>,
  warnings: readonly string[] | null | undefined
): string[] {
  const prefixes = [...labels].map((label) => `${label}: `);
  if (prefixes.length === 0) return [];
  return (warnings ?? []).filter((w) => prefixes.some((prefix) => w.startsWith(prefix)));
}

/**
 * Why the validator flagged a part, classified from the warning text it
 * wrote. "none" means every warning on the part is some other kind (or there
 * are none), so a non-high label is the model's own call.
 */
export type CapCause = "hedge" | "deliberation" | "breakdown" | "clamp" | "numeric" | "none";

export function capCauseForPart(label: string, warnings: readonly string[] | null | undefined): CapCause {
  const own = warningsForPart(label, warnings);
  // Ordered by how much each says about the MARK: a deliberation or breakdown
  // flag forces "low" and means the mark itself is suspect, a clamp likewise;
  // a hedge only asks for a glance at the crop.
  if (own.some((w) => w.includes("exposes internal deliberation"))) return "deliberation";
  if (own.some((w) => w.includes("breakdown only awards") || w.includes("breakdown awards"))) return "breakdown";
  if (own.some((w) => w.includes("clamped to"))) return "clamp";
  if (own.some((w) => w.includes("hedges on reading"))) return "hedge";
  if (own.some((w) => w.includes("deterministic"))) return "numeric";
  return "none";
}

/** A few words for the row, so a teacher can tell a wording flag from a mark in doubt. */
export const CAP_CAUSE_SHORT: Record<CapCause, string> = {
  hedge: "careful wording, glance at the crop",
  deliberation: "reasoning changed its mind",
  breakdown: "breakdown disagreed with the total",
  clamp: "mark exceeded the maximum",
  numeric: "a mark was re-checked",
  none: "the marker's own call",
};

// ---- The student's own self-assessment --------------------------------------
//
// student_self_scores holds what a student judged they earned on each part,
// entered on the reflection page's self-grade form. The review panel prints
// it beside the suggested mark, so a teacher can see where the student's
// judgement and the marker's part ways before accepting either.
//
// Each part has one of three states, and they are different facts about the
// student (migration 20260907152544_student_self_scores_allow_unattempted):
//
//   a number   the marks the student claimed
//   blank      a row whose self_marks is NULL: the form's "no attempt", which
//              computeDisagreement reads as a claim of 0
//   no row     nothing on file for the part (e.g. added after they submitted)
//
// A student has self-assessed the test only if at least one self_marks is
// non-null. That is the platform's own test (hasSelfScores in
// reflection-client, and the self-assessment export): a form submitted blank
// end to end still reads as not done, so every part then reads as "none"
// rather than as a column of blanks under a heading that says otherwise.

/** One student_self_scores row, as the review route serves it. */
export interface SelfScoreRef {
  test_item_id: string;
  self_marks: number | null;
  submitted_at?: string | null;
}

/** What the Self column shows for one part. */
export type SelfMark = { kind: "none" } | { kind: "blank" } | { kind: "marks"; marks: number };

export interface SelfAssessmentSummary {
  /** False when the self-scores could not be read -- which says nothing about the student. */
  available: boolean;
  /** At least one part carries a claimed mark. */
  assessed: boolean;
  /** self_marks per test_item_id, blanks included as null. Empty unless assessed. */
  byItem: Map<string, number | null>;
  /** The claimed total over every part on file; a blank adds nothing, as on the student's own form. */
  total: number;
  /** When the rows were last written. The Compare step lets a student revise them after seeing Clev's Marks. */
  lastSavedAt: string | null;
}

/**
 * Summarises one student's self-assessment of one test. `rows` is null when
 * the route could not read them, which the panel must not report as "has not
 * self-assessed" -- a failed query is not evidence about the student.
 */
export function summariseSelfAssessment(rows: readonly SelfScoreRef[] | null | undefined): SelfAssessmentSummary {
  if (!rows) return { available: false, assessed: false, byItem: new Map(), total: 0, lastSavedAt: null };
  const assessed = rows.some((r) => typeof r.self_marks === "number");
  if (!assessed) return { available: true, assessed: false, byItem: new Map(), total: 0, lastSavedAt: null };
  const byItem = new Map<string, number | null>();
  let total = 0;
  let lastSavedAt: string | null = null;
  let lastSavedMs = -Infinity;
  for (const r of rows) {
    const marks = typeof r.self_marks === "number" ? r.self_marks : null;
    byItem.set(r.test_item_id, marks);
    total += marks ?? 0;
    const ms = r.submitted_at ? Date.parse(r.submitted_at) : NaN;
    if (!Number.isNaN(ms) && ms > lastSavedMs) {
      lastSavedMs = ms;
      lastSavedAt = r.submitted_at ?? null;
    }
  }
  return { available: true, assessed, byItem, total, lastSavedAt };
}

/** The student's own mark for one part. */
export function selfMarkFor(summary: SelfAssessmentSummary, testItemId: string): SelfMark {
  if (!summary.assessed || !summary.byItem.has(testItemId)) return { kind: "none" };
  const marks = summary.byItem.get(testItemId);
  return typeof marks === "number" ? { kind: "marks", marks } : { kind: "blank" };
}

/**
 * Whether the student claimed something other than `mark`. A blank is a claim
 * of 0, the way computeDisagreement reads it once the student has
 * self-assessed; a part with nothing on file has no claim to differ.
 */
export function selfMarkDiffers(self: SelfMark, mark: number): boolean {
  if (self.kind === "none") return false;
  return (self.kind === "marks" ? self.marks : 0) !== mark;
}

/** Minimal shape of ai_grade_runs needed to pick each student's newest run. */
export interface SubjectRunRef {
  id: string;
  student_id: string | null;
  invited_student_id: string | null;
  created_at: string;
}

/**
 * The newest run per student, newest first.
 *
 * A subject is a registered student OR an invited-roster entry
 * (formatGradingSubject), so a student who logged in halfway through the
 * year does not count twice. Ties on created_at (a batch writes a class
 * within the same second) break on id, the same order the API lists runs
 * in, so two callers agree on which run is "the" latest. A run with no
 * subject on it is dropped: it is not any student's.
 *
 * Callers pre-filter by status; this does not know what "complete" means.
 */
export function latestRunPerSubject<R extends SubjectRunRef>(runs: R[]): R[] {
  const ordered = [...runs].sort((a, b) => {
    const t = Date.parse(b.created_at) - Date.parse(a.created_at);
    if (!Number.isNaN(t) && t !== 0) return t;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const seen = new Set<string>();
  const out: R[] = [];
  for (const run of ordered) {
    const subject = formatGradingSubject(run);
    if (!subject || seen.has(subject)) continue;
    seen.add(subject);
    out.push(run);
  }
  return out;
}
