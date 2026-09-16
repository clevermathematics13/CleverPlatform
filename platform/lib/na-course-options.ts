/**
 * na-course-options.ts -- what a Nuanced Analysis can be written FOR.
 * -----------------------------------------------------------------------------
 * One list, built from the teacher's active courses, of the only things a
 * packet may target. It is deliberately a pure function rather than inline
 * useMemo logic, because two separate bugs have now been shipped inside that
 * useMemo and neither was reachable by a test:
 *
 *   1. A grade selector sat beside the course list and filtered it. Grade 9
 *      showed the two tracks and every other grade showed "all the rest" --
 *      so the ROSTER courses 9A, 9C, 9D and 9G fell through and appeared
 *      under Grade 11 and Grade 12, where saving a packet would have written
 *      a DP packet's continuity onto a single Grade 9 class.
 *   2. The DP course was matched with an inline /^\d{2}AH$/ and labelled
 *      "AAHL" with a hardcoded Grade 12. A 30AS (AA SL, class of 2030) course
 *      could therefore never appear in the picker at all, and AAHL spans
 *      Grade 11 AND Grade 12, so the grade was wrong for any cohort not in
 *      its final year.
 *
 * Both are now decidable, and the tests beside this file decide them.
 *
 * ON ROSTER COURSES. 9A, 9C, 9D and 9G stay OUT on purpose. They remain the
 * FK target for students, gradebook, tests and Google Classroom sync, but a
 * Grade 9 packet is taught to a whole TRACK, so its continuity must target
 * the virtual track course (see migration
 * add_grade9_extended_standard_virtual_courses), never one class.
 * -----------------------------------------------------------------------------
 */

import { dpGradeLevelFor, parseDpCourseCode } from "./dp-course-code";

export type GradeLevel = "Grade 9" | "Grade 10" | "Grade 11" | "Grade 12";

/** A course row, narrowed to what this picker reads. */
export type CourseRow = { id: string; name: string };

export type NaCourseOption = {
  id: string;
  /** What the teacher sees, e.g. "AAHL" or "Grade 9 Extended". */
  label: string;
  /** Derived, never chosen. */
  gradeLevel: GradeLevel;
};

/**
 * The two virtual Grade 9 courses, in the order they should appear.
 * Named, not pattern-matched: these two rows exist for exactly this purpose.
 */
export const GRADE_9_TRACK_COURSE_NAMES = ["Grade 9 Extended", "Grade 9 Standard"] as const;

/**
 * Build the picker's options from the teacher's ACTIVE courses.
 *
 * `now` is passed in rather than read from the clock so the DP year a cohort
 * is in is testable and so a component can hold it fixed for a render.
 */
export function buildNaCourseOptions(courses: readonly CourseRow[], now: Date): NaCourseOption[] {
  const dpCourses = courses
    .map((course) => ({ course, code: parseDpCourseCode(course.name) }))
    .filter((x): x is { course: CourseRow; code: NonNullable<typeof x.code> } => x.code !== null)
    // Oldest cohort first, so the graduating class leads the list.
    .sort((a, b) => a.code.graduationYear - b.code.graduationYear);

  // Two cohorts of the SAME course can be active at once -- AAHL is two years
  // long, so a Grade 11 and a Grade 12 cohort overlap for most of the
  // calendar. They are separate courses with separate continuity, so when that
  // happens both are listed under the cohort code the teacher already uses for
  // them, rather than one silently winning the "AAHL" label.
  const countByCourseName = new Map<string, number>();
  for (const { code } of dpCourses) {
    countByCourseName.set(code.courseName, (countByCourseName.get(code.courseName) ?? 0) + 1);
  }

  const dp: NaCourseOption[] = dpCourses.map(({ course, code }) => ({
    id: course.id,
    label:
      (countByCourseName.get(code.courseName) ?? 0) > 1
        ? `${code.courseName} (${course.name})`
        : code.courseName,
    gradeLevel: dpGradeLevelFor(code.graduationYear, now),
  }));

  const tracks: NaCourseOption[] = GRADE_9_TRACK_COURSE_NAMES.map(
    (name) => courses.find((c) => c.name === name) ?? null,
  )
    .filter((c): c is CourseRow => c !== null)
    .map((c) => ({ id: c.id, label: c.name, gradeLevel: "Grade 9" as const }));

  return [...dp, ...tracks];
}
