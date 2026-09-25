/**
 * block-rotation.ts
 * -----------------------------------------------------------------------------
 * When each class actually meets, Semester 1 of 2026-2027.
 *
 * FDR runs an eight-block rotation, not a weekly timetable: a class meets on
 * different weekdays at different times as the rotation turns. That is why a
 * key assessment is a two-day window rather than a date -- "September 14, 15",
 * "November 9, 10" -- and why the classes sharing one paper sit it on
 * different days. 9A and 9C sat Key Assessment 1 on Monday the 14th because
 * blocks A and C met that day; 9G sat it on Tuesday the 15th because block G
 * did not meet on the 14th at all.
 *
 * Without this table the platform cannot tell which day of a window belongs to
 * which class, and the question has to go back to the teacher every time.
 *
 * SOURCE. The four per-block "HS Grade 9 Daily Schedule 2026-2027" sheets in
 * the teacher's Drive, which derive from "S1 Rotation 2026-27". Each lists 39
 * dated Semester 1 classes, and each of the four transcribed here has exactly
 * 39 -- asserted in the tests, because a dropped row would silently turn a
 * meeting day into a non-meeting day.
 *
 * SEMESTER 1 ONLY, deliberately. Those same sheets mark every Semester 2 date
 * as a planning prediction ("Replace predicted dates and times when official
 * Semester 2 HS Schedule events are published"), and a predicted date in a
 * table named "rotation" would be read as fact. Semester 2 goes in when the
 * official schedule does; until then `meetsOn` answers false for those dates
 * and callers must treat "not in the table" as "unknown", not "no class".
 *
 * These are the four blocks this platform has courses for. Blocks B, E, F and
 * H are real and simply not represented: B is common planning, and the rest
 * are other teachers' or other courses'.
 * -----------------------------------------------------------------------------
 */

/** A rotation block, as the school names it. */
export type Block = "A" | "C" | "D" | "G";

export interface BlockMeeting {
  /** "YYYY-MM-DD" -- a calendar day, never parsed as an instant. */
  date: string;
  /** 24-hour "HH:MM", so it sorts and compares as text. */
  startsAt: string;
}

/** The course each block is taught as, in this platform's own course names. */
export const BLOCK_FOR_COURSE: Readonly<Record<string, Block>> = {
  "9A": "A",
  "9C": "C",
  "9D": "D",
  "9G": "G",
};

/** The first and last day the table covers. Outside this, it knows nothing. */
export const ROTATION_FIRST_DAY = "2026-08-05";
export const ROTATION_LAST_DAY = "2026-12-18";

const m = (date: string, startsAt: string): BlockMeeting => ({ date, startsAt });

/**
 * Semester 1, 2026-2027. 39 meetings per block, in date order.
 *
 * Transcribed from the per-block daily schedules; the "Dated Semester 1
 * classes, 39" figure each sheet reports is the check on the transcription.
 */
export const BLOCK_ROTATION_S1_2026_27: Readonly<Record<Block, readonly BlockMeeting[]>> = {
  A: [
    m("2026-08-05", "09:35"), m("2026-08-10", "11:00"), m("2026-08-12", "11:00"),
    m("2026-08-14", "13:55"), m("2026-08-18", "13:55"), m("2026-08-21", "07:50"),
    m("2026-08-25", "07:50"), m("2026-09-01", "07:50"), m("2026-09-03", "09:35"),
    m("2026-09-07", "09:35"), m("2026-09-10", "09:35"), m("2026-09-14", "09:35"),
    m("2026-09-16", "09:35"), m("2026-09-18", "11:00"), m("2026-09-22", "11:35"),
    m("2026-09-24", "13:55"), m("2026-09-28", "13:55"), m("2026-10-12", "07:50"),
    m("2026-10-14", "07:50"), m("2026-10-16", "09:35"), m("2026-10-20", "09:35"),
    m("2026-10-22", "11:00"), m("2026-10-26", "11:00"), m("2026-10-28", "11:00"),
    m("2026-10-30", "13:55"), m("2026-11-03", "13:55"), m("2026-11-06", "07:50"),
    m("2026-11-10", "07:50"), m("2026-11-12", "09:35"), m("2026-11-16", "09:35"),
    m("2026-11-18", "09:35"), m("2026-11-20", "11:00"), m("2026-11-24", "11:35"),
    m("2026-11-30", "13:55"), m("2026-12-03", "07:50"), m("2026-12-07", "07:50"),
    m("2026-12-11", "07:50"), m("2026-12-15", "07:50"), m("2026-12-17", "09:35"),
  ],
  C: [
    m("2026-08-07", "07:50"), m("2026-08-11", "07:50"), m("2026-08-13", "09:35"),
    m("2026-08-17", "09:35"), m("2026-08-19", "09:35"), m("2026-08-21", "11:00"),
    m("2026-08-25", "11:00"), m("2026-09-01", "11:00"), m("2026-09-03", "13:55"),
    m("2026-09-07", "13:55"), m("2026-09-10", "13:55"), m("2026-09-14", "13:55"),
    m("2026-09-17", "07:50"), m("2026-09-21", "07:50"), m("2026-09-23", "07:50"),
    m("2026-09-25", "09:35"), m("2026-09-29", "09:35"), m("2026-10-12", "11:00"),
    m("2026-10-14", "11:00"), m("2026-10-16", "13:55"), m("2026-10-20", "13:55"),
    m("2026-10-23", "07:50"), m("2026-10-27", "07:50"), m("2026-10-29", "09:35"),
    m("2026-11-02", "09:35"), m("2026-11-04", "09:35"), m("2026-11-06", "11:00"),
    m("2026-11-10", "11:35"), m("2026-11-12", "13:55"), m("2026-11-16", "13:55"),
    m("2026-11-19", "07:50"), m("2026-11-23", "07:50"), m("2026-11-25", "07:50"),
    m("2026-12-01", "09:35"), m("2026-12-03", "11:00"), m("2026-12-07", "11:00"),
    m("2026-12-11", "11:00"), m("2026-12-15", "11:00"), m("2026-12-17", "13:55"),
  ],
  D: [
    m("2026-08-07", "09:35"), m("2026-08-11", "09:35"), m("2026-08-13", "11:00"),
    m("2026-08-17", "11:00"), m("2026-08-19", "11:00"), m("2026-08-21", "13:55"),
    m("2026-08-25", "13:55"), m("2026-09-01", "13:55"), m("2026-09-04", "07:50"),
    m("2026-09-08", "07:50"), m("2026-09-11", "07:50"), m("2026-09-15", "07:50"),
    m("2026-09-17", "09:35"), m("2026-09-21", "09:35"), m("2026-09-23", "09:35"),
    m("2026-09-25", "11:00"), m("2026-09-29", "11:35"), m("2026-10-12", "13:55"),
    m("2026-10-15", "07:50"), m("2026-10-19", "07:50"), m("2026-10-21", "07:50"),
    m("2026-10-23", "09:35"), m("2026-10-27", "09:35"), m("2026-10-29", "11:00"),
    m("2026-11-02", "11:00"), m("2026-11-04", "11:00"), m("2026-11-06", "13:55"),
    m("2026-11-10", "13:55"), m("2026-11-13", "07:50"), m("2026-11-17", "07:50"),
    m("2026-11-19", "09:35"), m("2026-11-23", "09:35"), m("2026-11-25", "09:35"),
    m("2026-12-01", "11:35"), m("2026-12-03", "13:55"), m("2026-12-07", "13:55"),
    m("2026-12-11", "13:55"), m("2026-12-15", "13:55"), m("2026-12-18", "07:50"),
  ],
  G: [
    m("2026-08-10", "07:50"), m("2026-08-12", "07:50"), m("2026-08-14", "09:35"),
    m("2026-08-18", "09:35"), m("2026-08-20", "11:00"), m("2026-08-24", "11:00"),
    m("2026-08-31", "11:00"), m("2026-09-02", "11:00"), m("2026-09-04", "13:55"),
    m("2026-09-08", "13:55"), m("2026-09-11", "13:55"), m("2026-09-15", "13:55"),
    m("2026-09-18", "07:50"), m("2026-09-22", "07:50"), m("2026-09-24", "09:35"),
    m("2026-09-28", "09:35"), m("2026-09-30", "09:35"), m("2026-10-13", "11:35"),
    m("2026-10-15", "13:55"), m("2026-10-19", "13:55"), m("2026-10-22", "07:50"),
    m("2026-10-26", "07:50"), m("2026-10-28", "07:50"), m("2026-10-30", "09:35"),
    m("2026-11-03", "09:35"), m("2026-11-05", "11:00"), m("2026-11-09", "11:00"),
    m("2026-11-11", "11:00"), m("2026-11-13", "13:55"), m("2026-11-17", "13:55"),
    m("2026-11-20", "07:50"), m("2026-11-24", "07:50"), m("2026-11-30", "09:35"),
    m("2026-12-02", "09:35"), m("2026-12-04", "11:00"), m("2026-12-10", "11:00"),
    m("2026-12-14", "11:00"), m("2026-12-16", "11:00"), m("2026-12-18", "13:55"),
  ],
};

export const BLOCKS: readonly Block[] = ["A", "C", "D", "G"];

/** The block a course is taught in, or null for a course with no block here. */
export function blockForCourse(courseName: string): Block | null {
  return BLOCK_FOR_COURSE[courseName] ?? null;
}

/** Whether the table covers this date at all. Outside it, nothing is known. */
export function isWithinRotation(date: string): boolean {
  return date >= ROTATION_FIRST_DAY && date <= ROTATION_LAST_DAY;
}

/** The meeting this block has on this date, or null if it does not meet. */
export function meetingOn(block: Block, date: string): BlockMeeting | null {
  return BLOCK_ROTATION_S1_2026_27[block].find((x) => x.date === date) ?? null;
}

export function meetsOn(block: Block, date: string): boolean {
  return meetingOn(block, date) !== null;
}

/** Every block meeting on this date, in block order. */
export function blocksMeetingOn(date: string): Block[] {
  return BLOCKS.filter((b) => meetsOn(b, date));
}

/**
 * Which day of a key assessment's window this block sits it on.
 *
 * The Course Outline gives a window ("November 9, 10") and the rotation
 * decides: only block G meets on the 9th, only A, C and D on the 10th, so
 * there is exactly one answer per class and no judgement involved.
 *
 * Returns null when the block meets on NONE of the window's days -- which is
 * a real answer, and a sign the window or the rotation is wrong rather than
 * something to paper over with a guess. When a block meets on more than one
 * day of the window the EARLIEST is returned, since a window is a window and
 * something has to be picked; the caller can see the full list with
 * `meetingDaysWithin` if that matters.
 */
export function dayWithinWindow(block: Block, window: readonly string[]): string | null {
  return meetingDaysWithin(block, window)[0] ?? null;
}

/** Every day of the window on which this block meets, in date order. */
export function meetingDaysWithin(block: Block, window: readonly string[]): string[] {
  return [...window].sort().filter((d) => meetsOn(block, d));
}

/**
 * The window split across classes: which class sits it on which day.
 *
 * Keyed by COURSE name (9A, 9C, ...) rather than block, because that is what
 * the rest of the platform holds and what the teacher reads.
 */
export function splitWindowByCourse(
  window: readonly string[],
  courseNames: readonly string[],
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const courseName of courseNames) {
    const block = blockForCourse(courseName);
    out[courseName] = block ? dayWithinWindow(block, window) : null;
  }
  return out;
}

/**
 * Whether a date is a day this course actually meets.
 *
 * `null` means "cannot say" -- the course has no block in this table, or the
 * date falls outside Semester 1 -- and is deliberately distinct from `false`,
 * which is the positive claim that the class does NOT meet that day. A caller
 * that collapses the two will tell the teacher a date is wrong when all it
 * knows is that it has no data.
 */
export function courseMeetsOn(courseName: string, date: string): boolean | null {
  const block = blockForCourse(courseName);
  if (!block || !isWithinRotation(date)) return null;
  return meetsOn(block, date);
}
