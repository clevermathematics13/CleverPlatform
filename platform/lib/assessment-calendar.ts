/**
 * assessment-calendar.ts
 * -----------------------------------------------------------------------------
 * The key assessment dates, as the teacher's calendar reads them.
 *
 * "Key assessment" is what these are called to a class; `assessment_kind =
 * 'summative'` is what the database calls them. This module is the one place
 * that equation is written down, so a calendar that quietly started showing
 * formatives would have to say so here first.
 *
 * WHY THE DATES ARE NEVER PUT THROUGH `new Date(...)` FOR DISPLAY.
 * `tests.test_date` is a DATE column -- a day on a wall calendar, with no time
 * and no timezone. `new Date("2026-09-14")` does not mean that: it is parsed as
 * UTC midnight, so west of Greenwich it renders as the day BEFORE.
 *
 *     new Date("2026-09-14")  in America/Chicago  ->  Sun 13 Sept
 *
 * Every Monday assessment on this calendar would have printed as Sunday. The
 * gradebook already hit this and guards it by appending "T00:00:00"
 * (GradebookGrid.tsx), which anchors the parse to local midnight instead.
 *
 * That guard works, and it still leaves the answer depending on which clock the
 * code is running against -- the teacher's browser in Chicago, or a Vercel
 * server in UTC, for the same row. A date with no time in it should not have an
 * answer that varies by machine. So this module never builds a Date from the
 * string for display at all: it reads the year, month and day as three
 * integers and formats from those. The only Date it constructs is at UTC noon,
 * used solely to derive the weekday and to count days between two dates, where
 * UTC-on-both-sides cancels out.
 * -----------------------------------------------------------------------------
 */

/** A dated key assessment, as the calendar page needs it. */
export interface CalendarAssessment {
  id: string;
  name: string;
  courseName: string;
  /** Exactly as `tests.test_date` stores it: "YYYY-MM-DD". */
  testDate: string;
  totalMarks: number | null;
}

export interface CalendarMonth {
  /** "2026-09" -- sorts correctly as a string, which is why it is the key. */
  key: string;
  /** "September 2026" */
  label: string;
  assessments: Array<CalendarAssessment & { relative: string; isPast: boolean }>;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

interface DateParts {
  year: number;
  month: number;
  day: number;
}

/**
 * The three integers in a "YYYY-MM-DD", or null if it is not one.
 *
 * Round-tripped through Date.UTC rather than merely range-checked, so that
 * "2026-02-30" is rejected instead of silently becoming 2 March: Date.UTC
 * rolls an out-of-range day over without complaint, and a calendar that
 * invents a date is worse than one that admits it cannot read the value.
 */
export function parseTestDate(testDate: string): DateParts | null {
  const match = DATE_ONLY.exec(testDate);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/** UTC NOON, not midnight -- far enough from either boundary that no DST
 *  shift can move the date, for the two things a Date is used for here. */
function atUtcNoon(parts: DateParts): Date {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12));
}

/** "Monday 14 September 2026", or the raw value when it cannot be read. */
export function formatAssessmentDate(testDate: string): string {
  const parts = parseTestDate(testDate);
  if (!parts) return testDate;
  const weekday = WEEKDAYS[atUtcNoon(parts).getUTCDay()];
  return `${weekday} ${parts.day} ${MONTHS[parts.month - 1]} ${parts.year}`;
}

/** "Mon 14 Sep" -- for a dense list where the year is already the heading. */
export function formatAssessmentDateShort(testDate: string): string {
  const parts = parseTestDate(testDate);
  if (!parts) return testDate;
  const weekday = WEEKDAYS[atUtcNoon(parts).getUTCDay()].slice(0, 3);
  return `${weekday} ${parts.day} ${MONTHS[parts.month - 1].slice(0, 3)}`;
}

/** "2026-09" for grouping; "September 2026" to print above the group. */
export function monthKeyOf(testDate: string): string {
  const parts = parseTestDate(testDate);
  if (!parts) return "unknown";
  return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
}

export function monthLabelOf(testDate: string): string {
  const parts = parseTestDate(testDate);
  if (!parts) return "Undated";
  return `${MONTHS[parts.month - 1]} ${parts.year}`;
}

/**
 * Whole days from `today` to `testDate`. Negative once it is past.
 *
 * Both sides are taken to UTC noon first, so the subtraction is a whole number
 * of days whatever timezone either value came from and whatever DST does in
 * between.
 */
export function daysUntil(testDate: string, today: string): number | null {
  const a = parseTestDate(testDate);
  const b = parseTestDate(today);
  if (!a || !b) return null;
  const ms = atUtcNoon(a).getTime() - atUtcNoon(b).getTime();
  return Math.round(ms / 86_400_000);
}

/**
 * How near it is, in the words a teacher would use.
 *
 * "in 6 days" rather than a weekday name inside the coming week: "on Monday"
 * is ambiguous the moment the week turns, and this list spans a whole term.
 */
export function relativeLabel(testDate: string, today: string): string {
  const days = daysUntil(testDate, today);
  if (days === null) return "";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 0) return days < 14 ? `in ${days} days` : `in ${Math.round(days / 7)} weeks`;
  const ago = -days;
  return ago < 14 ? `${ago} days ago` : `${Math.round(ago / 7)} weeks ago`;
}

/**
 * The assessments grouped into months, earliest first.
 *
 * Undated assessments are not the calendar's business and are dropped by the
 * query, not here -- this function is given what it is asked to lay out.
 * A row whose date cannot be parsed is KEPT, under an "Undated" heading that
 * sorts last: dropping it silently would hide a real paper from the one page
 * whose job is to say when papers happen.
 */
export function groupAssessmentsByMonth(
  assessments: CalendarAssessment[],
  today: string,
): CalendarMonth[] {
  const months = new Map<string, CalendarMonth>();

  for (const assessment of assessments) {
    const key = monthKeyOf(assessment.testDate);
    let month = months.get(key);
    if (!month) {
      month = { key, label: monthLabelOf(assessment.testDate), assessments: [] };
      months.set(key, month);
    }
    const days = daysUntil(assessment.testDate, today);
    month.assessments.push({
      ...assessment,
      relative: relativeLabel(assessment.testDate, today),
      isPast: days !== null && days < 0,
    });
  }

  for (const month of months.values()) {
    month.assessments.sort(
      (a, b) => a.testDate.localeCompare(b.testDate) || a.courseName.localeCompare(b.courseName),
    );
  }

  // "unknown" sorts after every real "YYYY-MM" because 'u' > '2'.
  return [...months.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * The timezone the school's day is measured in.
 *
 * Only ever affects the wording "today" / "tomorrow" / "yesterday": the dates
 * themselves are read off the string and cannot shift. Left as an environment
 * variable rather than a guessed constant, because guessing wrong is a page
 * that says "today" a few hours early and nothing here can detect that. UTC is
 * the fallback because it is what the Vercel runtime already uses, so the
 * default changes nothing about today's behaviour.
 */
export const SCHOOL_TIME_ZONE = process.env.SCHOOL_TIME_ZONE || "UTC";

/** Today as "YYYY-MM-DD" in a named timezone -- the school's, not the server's. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  // en-CA renders ISO-shaped "YYYY-MM-DD", which is the point of picking it.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
