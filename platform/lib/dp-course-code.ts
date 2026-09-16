/**
 * dp-course-code.ts -- reading a DP course code.
 * -----------------------------------------------------------------------------
 * The courses table names a DP course by COHORT, not by subject: "27AH" is the
 * group of students who will graduate in 2027, taking Analysis & Approaches at
 * Higher Level. The scheme is <two-digit graduation year><two-letter course>:
 *
 *   27AH -> AA HL, class of 2027
 *   30AS -> AA SL, class of 2030
 *   32IH -> AI HL, class of 2032
 *
 * Both halves matter and they answer different questions. The cohort half is
 * what a gradebook and a syllabus tracker need, because it identifies a
 * specific group of students. The subject half is what a Nuanced Analysis
 * needs, because a packet is written for AAHL -- the two-year course -- and
 * every cohort taking it works through the same material.
 *
 * WHY A MODULE. The first version of the packet picker matched /^\d{2}AH$/ in
 * the component and called anything it found "AAHL". That is wrong twice: a
 * "30AS" course would never appear in the picker at all, and if it somehow did
 * it would be mislabelled as Higher Level.
 *
 * ON THE DP YEAR. AAHL spans Grade 11 and Grade 12, so a course code alone
 * does not fix a grade -- the cohort's position in it does. A class graduating
 * in 2027 is in Grade 12 through the 2026-27 school year and was in Grade 11
 * the year before. That is derivable from the graduation year and the date,
 * and deriving it is what keeps the picker honest as cohorts roll without
 * anybody editing a constant each August.
 * -----------------------------------------------------------------------------
 */

/** The four IB DP mathematics courses, by their two-letter code. */
const COURSE_BY_CODE: Record<string, string> = {
  AH: "AAHL",
  AS: "AASL",
  IH: "AIHL",
  IS: "AISL",
};

export type DpCourseCode = {
  /** Four-digit graduation year, e.g. 2027. */
  graduationYear: number;
  /** Two-letter subject code as written, e.g. "AH". */
  subjectCode: string;
  /** What the teacher calls the course, e.g. "AAHL". */
  courseName: string;
};

/**
 * Parse a cohort course name, or null if it is not one.
 *
 * Deliberately strict: exactly two digits and one of the four known subject
 * codes. A roster course ("9A", "9C") and a virtual track ("Grade 9 Extended")
 * both correctly return null, which is what keeps them out of the DP picker.
 */
export function parseDpCourseCode(name: string): DpCourseCode | null {
  const match = /^([0-9]{2})([A-Z]{2})$/.exec((name ?? "").trim().toUpperCase());
  if (!match) return null;
  const courseName = COURSE_BY_CODE[match[2]];
  if (!courseName) return null;
  return {
    // Two digits are unambiguous for the century this school runs in.
    graduationYear: 2000 + Number(match[1]),
    subjectCode: match[2],
    courseName,
  };
}

/**
 * Which DP year a cohort is in, on a given date.
 *
 * The school year turns in August: from August onwards, the year that is
 * ending is the next calendar year. A cohort graduating then is in Grade 12;
 * the one behind it is in Grade 11.
 *
 * Anything further out than that is reported as Grade 11, the year they would
 * be starting -- it is the safer of the two, because it is where a cohort
 * enters the course.
 */
export function dpGradeLevelFor(graduationYear: number, now: Date): "Grade 11" | "Grade 12" {
  const AUGUST = 7;
  const schoolYearEnds = now.getMonth() >= AUGUST ? now.getFullYear() + 1 : now.getFullYear();
  return graduationYear <= schoolYearEnds ? "Grade 12" : "Grade 11";
}
