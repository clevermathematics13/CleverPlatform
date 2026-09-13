/**
 * Shaping a class's practice answers for the marking view.
 *
 * The pure half lives here so the two things that actually decide whether this
 * screen is usable -- what counts as marked, and how a class's work is pivoted
 * for reading -- can be checked without a database.
 *
 * Marking is read BY QUESTION by default, not by student. Reading one
 * student's whole paper and then the next is how you mark an exam; it is the
 * wrong shape for practice, where the useful question is "how did the class
 * find part (b)". Seeing fourteen answers to the same part side by side is
 * what makes a shared misconception obvious in seconds, and it keeps the
 * teacher in one piece of mathematics instead of switching topic every card.
 */

export const VERDICTS = ["correct", "almost", "not_yet"] as const;
export type Verdict = (typeof VERDICTS)[number];

export function isVerdict(value: unknown): value is Verdict {
  return typeof value === "string" && (VERDICTS as readonly string[]).includes(value);
}

/** Short label for each state, in the teacher's language rather than the column's. */
export const VERDICT_LABEL: Record<Verdict, string> = {
  correct: "Correct",
  almost: "Almost",
  not_yet: "Not yet",
};

export interface MarkedAnswer {
  /** practice_answers.id. Null when the student has not answered this part. */
  answerId: string | null;
  answerLatex: string;
  /** When the student last touched it, for the stale-mark comparison. */
  answerUpdatedAt: string | null;
  verdict: Verdict | null;
  note: string | null;
  markUpdatedAt: string | null;
}

export interface StudentAnswerCell extends MarkedAnswer {
  invitedId: string;
  profileId: string | null;
  fullName: string;
  /** True when there is nothing to read: no account, or nothing typed. */
  empty: boolean;
  /** True when the student edited the answer after the teacher marked it. */
  stale: boolean;
}

/**
 * Whether a mark still describes the answer it was given to.
 *
 * A student who reopens a set and adds a line to part (b) does not invalidate
 * the teacher's note, but it does mean the note was written about something
 * else. Comparing timestamps is enough; storing a copy of the marked text
 * would be a second source of truth for the same string.
 */
export function isStale(answerUpdatedAt: string | null, markUpdatedAt: string | null): boolean {
  if (!answerUpdatedAt || !markUpdatedAt) return false;
  return Date.parse(answerUpdatedAt) > Date.parse(markUpdatedAt);
}

/** An answer with nothing in it is not work, whatever whitespace it holds. */
export function isEmptyAnswer(latex: string | null | undefined): boolean {
  if (!latex) return true;
  return latex.replace(/\\placeholder\s*(\{[^}]*\})?/g, "").replace(/[{}\s]/g, "").length === 0;
}

export interface PartProgress {
  /** Students who wrote something. */
  answered: number;
  /** Of those, how many the teacher has read. */
  marked: number;
  /** Of those read, how many were marked stale by a later edit. */
  stale: number;
  /** Everyone on the roster, answered or not. */
  onRoster: number;
}

export function summariseCells(cells: readonly StudentAnswerCell[]): PartProgress {
  let answered = 0;
  let marked = 0;
  let stale = 0;
  for (const cell of cells) {
    if (cell.empty) continue;
    answered += 1;
    if (cell.verdict) marked += 1;
    if (cell.stale) stale += 1;
  }
  return { answered, marked, stale, onRoster: cells.length };
}

/**
 * How the class did on one part, as a count per verdict.
 *
 * Deliberately counts rather than a percentage: with fourteen students a
 * percentage invents precision, and "9 correct, 3 almost, 2 not yet" is the
 * sentence a teacher actually wants.
 */
export function verdictTally(cells: readonly StudentAnswerCell[]): Record<Verdict, number> {
  const tally: Record<Verdict, number> = { correct: 0, almost: 0, not_yet: 0 };
  for (const cell of cells) {
    if (cell.verdict) tally[cell.verdict] += 1;
  }
  return tally;
}

/**
 * Ordering for the marking queue: unmarked work first.
 *
 * A teacher opening a part wants the answers they have not read yet at the
 * top, then the ones a student has since changed, then the settled ones, and
 * the students who wrote nothing last -- there is nothing to mark there and
 * they would otherwise pad the top of the list. Names break ties so the order
 * is stable between refreshes.
 */
export function markingOrder(cells: readonly StudentAnswerCell[]): StudentAnswerCell[] {
  const rank = (cell: StudentAnswerCell): number => {
    if (cell.empty) return 3;
    if (cell.stale) return 1;
    return cell.verdict ? 2 : 0;
  };
  return [...cells].sort(
    (a, b) => rank(a) - rank(b) || a.fullName.localeCompare(b.fullName)
  );
}

/** The database key for one answer cell, matching practice_answers' unique key. */
export function cellKey(itemId: string, profileId: string, partLabel: string): string {
  return `${itemId}::${profileId}::${partLabel}`;
}
