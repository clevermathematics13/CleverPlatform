/**
 * Re-mark requests: a student's written case that one part of a test should
 * be re-marked, made after self-grading showed their mark and ClevMarks
 * differ on it. The teacher answers each one on /dashboard/remark-requests
 * as "Mark changed" or "Mark stands", with an optional note the student
 * reads beside the part.
 *
 * Pure and client-safe: ScoreTable and the student's re-mark row import it,
 * and so do both routes (app/api/remark-requests), which is what makes the
 * button and the route agree about who may ask. Database reads live in
 * lib/exam-service.ts (attachRemarkRequests) and
 * lib/remark-requests-service.ts (the teacher's queue).
 *
 * Everything here can reach a student's screen, so nothing in it may say
 * "AI" -- the platform rule in CLAUDE.md, pinned for the outcome text by
 * remark-requests.test.ts.
 */
import type { ReflectionItem, ReflectionRemark, RemarkStatus } from "./reflection-types";

/** Short enough to stop "pls" and "remark this", long enough for a sentence. */
export const REMARK_TEXT_MIN = 15;
export const REMARK_TEXT_MAX = 1000;
export const TEACHER_NOTE_MAX = 1000;

/** The columns of remark_requests a student may see, in ReflectionRemark order. */
export const REMARK_STUDENT_COLUMNS =
  "id, test_item_id, explanation, status, marks_at_request, self_marks_at_request, resolved_marks, teacher_note, created_at, updated_at, resolved_at";

/**
 * Line endings normalised and every control character but newline and tab
 * removed. Postgres text refuses NUL outright, which would otherwise come
 * back to a student as a server error rather than a message.
 */
function cleanText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
}

export type NormalisedText = { ok: true; text: string } | { ok: false; error: string };

/**
 * A student's explanation, cleaned and checked. Too long is refused rather
 * than cut: cutting silently drops the end of their argument, and can split
 * a character in half.
 */
export function normaliseExplanation(raw: unknown): NormalisedText {
  if (typeof raw !== "string") return { ok: false, error: "Write your explanation first." };
  const text = cleanText(raw);
  if (text.length < REMARK_TEXT_MIN) {
    return {
      ok: false,
      error: `Say a little more: at least ${REMARK_TEXT_MIN} characters, so your teacher can see what you mean.`,
    };
  }
  if (text.length > REMARK_TEXT_MAX) {
    return { ok: false, error: `Keep it to ${REMARK_TEXT_MAX} characters or fewer.` };
  }
  return { ok: true, text };
}

/** The teacher's note: optional, so an empty one is simply no note. */
export function normaliseTeacherNote(
  raw: unknown
): { ok: true; text: string | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, text: null };
  if (typeof raw !== "string") return { ok: false, error: "note must be text" };
  const text = cleanText(raw);
  if (text.length === 0) return { ok: true, text: null };
  if (text.length > TEACHER_NOTE_MAX) {
    return { ok: false, error: `The note must be ${TEACHER_NOTE_MAX} characters or fewer.` };
  }
  return { ok: true, text };
}

export type RemarkEligibility =
  | "ok"
  | "not-self-assessed"
  | "no-clevmark"
  | "agrees"
  | "pending"
  | "resolved";

/**
 * Whether a student may ask for this part to be re-marked. One answer for
 * the button and the route: the route decides, the button only avoids
 * offering what the route would refuse.
 *
 * It reads the SAVED self mark, not a number typed into the Compare table
 * and not yet saved -- the route can only see what is stored. A blank counts
 * as a claim of 0 once the student has self-graded, as computeDisagreement
 * reads it. Any difference qualifies, including a student who thinks they
 * were given too much.
 */
export function remarkEligibility(input: {
  hasSelfAssessed: boolean;
  marksAwarded: number | null;
  savedSelfMarks: number | null;
  existingStatus: RemarkStatus | null;
}): RemarkEligibility {
  if (input.existingStatus === "pending") return "pending";
  if (input.existingStatus) return "resolved";
  if (!input.hasSelfAssessed) return "not-self-assessed";
  if (input.marksAwarded === null) return "no-clevmark";
  if ((input.savedSelfMarks ?? 0) === input.marksAwarded) return "agrees";
  return "ok";
}

/** The parts whose request is still waiting for the teacher: the set
 *  computeDisagreement leaves out. */
export function pendingRemarkItemIds(
  items: ReadonlyArray<Pick<ReflectionItem, "test_item_id" | "remark_request">>
): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    if (item.remark_request?.status === "pending") ids.add(item.test_item_id);
  }
  return ids;
}

/** A remark_requests row cut down to what its student may see. */
export function toReflectionRemark(row: Record<string, unknown>): ReflectionRemark {
  return {
    id: String(row.id),
    test_item_id: String(row.test_item_id),
    explanation: String(row.explanation ?? ""),
    status: row.status as RemarkStatus,
    marks_at_request: Number(row.marks_at_request),
    self_marks_at_request: row.self_marks_at_request == null ? null : Number(row.self_marks_at_request),
    resolved_marks: row.resolved_marks == null ? null : Number(row.resolved_marks),
    teacher_note: row.teacher_note == null ? null : String(row.teacher_note),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    resolved_at: row.resolved_at == null ? null : String(row.resolved_at),
  };
}

/**
 * The line a student reads under a part about their request. "Mark stands"
 * after the mark had already moved (say, a gradebook correction before the
 * teacher got to the request) says what the mark now is, rather than that
 * it stayed where it was.
 */
export function remarkOutcomeText(
  r: Pick<ReflectionRemark, "status" | "marks_at_request" | "resolved_marks">
): string {
  if (r.status === "pending") return "Re-mark requested — waiting for your teacher.";
  const resolved = r.resolved_marks ?? r.marks_at_request;
  if (r.status === "changed") {
    return `Re-marked: ClevMarks changed from ${r.marks_at_request} to ${resolved}.`;
  }
  if (resolved !== r.marks_at_request) {
    return `Re-mark reviewed: ClevMarks are now ${resolved} (${r.marks_at_request} when you asked).`;
  }
  return `Re-mark reviewed: ClevMarks stay at ${resolved}.`;
}

export type ResolutionOutcome = "changed" | "stands";

export type ResolutionResult =
  | {
      ok: true;
      outcome: ResolutionOutcome;
      /** The ClevMark once resolved. */
      resolvedMarks: number;
      note: string | null;
      /** Whether student_marks has to be written: false when the mark is
       *  already there, which is also what makes a retry after a failed
       *  second half safe. */
      writeMark: boolean;
    }
  | { ok: false; status: 400 | 409; error: string };

/**
 * The teacher's answer, checked against the part and the mark as it stands
 * now.
 *
 * `expectedCurrentMarks` is the ClevMark the teacher's page showed. If the
 * mark moved in between -- a gradebook edit, an accept on the marking
 * screen -- the answer was given against numbers that no longer exist, so it
 * is refused (409) rather than applied on top of them.
 */
export function validateResolution(input: {
  outcome: unknown;
  newMarks: unknown;
  note: unknown;
  maxMarks: number;
  marksAtRequest: number;
  currentMarks: number | null;
  expectedCurrentMarks: unknown;
}): ResolutionResult {
  if (input.outcome !== "changed" && input.outcome !== "stands") {
    return { ok: false, status: 400, error: 'outcome must be "changed" or "stands"' };
  }
  const expected = input.expectedCurrentMarks;
  if (!(expected === null || (typeof expected === "number" && Number.isInteger(expected)))) {
    return { ok: false, status: 400, error: "expectedCurrentMarks must be the mark the page showed, or null" };
  }
  const note = normaliseTeacherNote(input.note);
  if (!note.ok) return { ok: false, status: 400, error: note.error };

  if (expected !== input.currentMarks) {
    return {
      ok: false,
      status: 409,
      error:
        `ClevMarks for this part changed since the page loaded (now ${input.currentMarks ?? "none"}). ` +
        "Reload and decide again.",
    };
  }

  if (input.outcome === "stands") {
    if (input.currentMarks === null) {
      return {
        ok: false,
        status: 409,
        error: "This part has no ClevMark to keep. Enter a mark and choose Mark changed.",
      };
    }
    return { ok: true, outcome: "stands", resolvedMarks: input.currentMarks, note: note.text, writeMark: false };
  }

  const newMarks = input.newMarks;
  if (typeof newMarks !== "number" || !Number.isInteger(newMarks)) {
    return { ok: false, status: 400, error: "The new mark must be a whole number." };
  }
  if (newMarks < 0 || newMarks > input.maxMarks) {
    return { ok: false, status: 400, error: `The new mark must be between 0 and ${input.maxMarks}.` };
  }
  if (newMarks === input.marksAtRequest) {
    return {
      ok: false,
      status: 400,
      error: `${newMarks} is the mark the student asked about. Choose Mark stands to keep it.`,
    };
  }
  return {
    ok: true,
    outcome: "changed",
    resolvedMarks: newMarks,
    note: note.text,
    writeMark: newMarks !== input.currentMarks,
  };
}

// ---- The teacher's queue ------------------------------------------------------

export interface RemarkQueueEntry {
  id: string;
  testId: string;
  testName: string;
  testItemId: string;
  /** test_items.sort_order: paper order within the test. */
  sortOrder: number;
  createdAt: string;
  marksAtRequest: number;
  currentMarks: number | null;
  currentSelfMarks: number | null;
}

export interface RemarkQueuePart<T extends RemarkQueueEntry> {
  testItemId: string;
  sortOrder: number;
  requests: T[];
}

export interface RemarkQueueTest<T extends RemarkQueueEntry> {
  testId: string;
  testName: string;
  /** created_at of the longest-waiting request in this test. */
  oldestCreatedAt: string;
  count: number;
  parts: RemarkQueuePart<T>[];
}

/**
 * Waiting requests laid out for answering: the test whose request has waited
 * longest first, then its parts in paper order, then the oldest request on
 * each part first. Grouping by part is what lets the page print one part's
 * mark scheme once above every request about it -- a single assessment can
 * produce well over a hundred.
 */
export function buildRemarkQueue<T extends RemarkQueueEntry>(rows: readonly T[]): RemarkQueueTest<T>[] {
  const byTest = new Map<string, RemarkQueueTest<T>>();
  for (const row of rows) {
    let test = byTest.get(row.testId);
    if (!test) {
      test = { testId: row.testId, testName: row.testName, oldestCreatedAt: row.createdAt, count: 0, parts: [] };
      byTest.set(row.testId, test);
    }
    test.count += 1;
    if (row.createdAt < test.oldestCreatedAt) test.oldestCreatedAt = row.createdAt;
    let part = test.parts.find((p) => p.testItemId === row.testItemId);
    if (!part) {
      part = { testItemId: row.testItemId, sortOrder: row.sortOrder, requests: [] };
      test.parts.push(part);
    }
    part.requests.push(row);
  }
  const tests = [...byTest.values()];
  for (const test of tests) {
    test.parts.sort((a, b) => a.sortOrder - b.sortOrder);
    for (const part of test.parts) {
      part.requests.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }
  }
  return tests.sort((a, b) => a.oldestCreatedAt.localeCompare(b.oldestCreatedAt));
}

/** The ClevMark is no longer the one the student disputed. */
export function remarkMarkMoved(e: Pick<RemarkQueueEntry, "marksAtRequest" | "currentMarks">): boolean {
  return e.currentMarks !== e.marksAtRequest;
}

/** The student's saved mark now matches the ClevMark (a blank is a 0). */
export function remarkNowAgrees(e: Pick<RemarkQueueEntry, "currentMarks" | "currentSelfMarks">): boolean {
  return e.currentMarks !== null && (e.currentSelfMarks ?? 0) === e.currentMarks;
}
