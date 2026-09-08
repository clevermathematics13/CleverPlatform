/**
 * PowerSchool score export
 * ------------------------
 * The pieces of a PowerTeacher Pro score import that are about the scores
 * rather than the file: what goes in a Score cell, which rows cannot be
 * placed, and what to call the download. The file itself is always a filled-in
 * PowerTeacher Scores Template (PST); see lib/pst-fill.ts.
 *
 * What we know about PowerTeacher Pro's per-assignment "Import Scores", from
 * PowerSchool's documentation and from watching it reject files:
 *
 * - It matches rows on the **school-defined student number** and nothing
 *   else. A student name column is accepted but only powers the optional
 *   "Validate Student Names" check. This is why students.student_number and
 *   invited_students.student_number exist.
 * - It wants **its own template shape**: seven `Label:,value,` metadata lines,
 *   then `Student Num,Student Name,Score`, then one row per student. A bare
 *   three-column CSV with the same header is not read as data at all -- every
 *   row previews as "Ignored header line" and the dialog reports "0 of 0
 *   scores will be imported", whatever the Include First Row and mapping
 *   options are set to. This platform used to offer exactly that bare file;
 *   it never imported once, so it is gone.
 * - The metadata is read, not just skipped: an Assignment Name on line 3 that
 *   does not match the assignment being imported into draws a warning. It does
 *   not block the import.
 * - `Score Type: GRADESCALE` with `Points Possible: 7.0` is how this school's
 *   1-7 assignments are set up, and a plain numeral (`5`) is what PowerSchool
 *   itself writes into the Score column for them. Achievement levels go in
 *   unchanged.
 * - ABS is one of PowerTeacher Pro's default special codes (alongside INC and
 *   MIS). In a score cell it sets the Absent flag and exempts the assignment
 *   from the student's total, which is exactly what a recorded absence means
 *   here.
 */

/** PowerTeacher Pro's default special code for an absence. */
export const POWERSCHOOL_ABSENT_CODE = "ABS";

export type PowerSchoolScoreRow = {
  /** students.student_number / invited_students.student_number. */
  studentNumber: string | null;
  studentName: string;
  /** Achievement level 1-7, or null when the student has no marks. */
  level: number | null;
  /** Recorded in test_absences for this test. */
  absent: boolean;
};

/**
 * The score cell. An absence beats a level: a student marked absent is exempt
 * from the assignment, so writing a level for them would both contradict the
 * gradebook and count a paper they never sat. An empty cell is left alone by
 * PowerSchool, which is what "not graded yet" should do -- writing 0 would be
 * a claim about the student.
 */
export function scoreCell(row: PowerSchoolScoreRow): string {
  if (row.absent) return POWERSCHOOL_ABSENT_CODE;
  return row.level === null ? "" : String(row.level);
}

/** The rows whose student number is missing. They cannot be placed in the
 *  template at all, so the caller should say so rather than let the teacher
 *  find a blank in PowerSchool. */
export function rowsMissingStudentNumber(rows: PowerSchoolScoreRow[]): PowerSchoolScoreRow[] {
  return rows.filter((r) => !r.studentNumber || r.studentNumber.trim() === "");
}

/**
 * A filename that survives a Content-Disposition header and a Finder window,
 * in the shape PowerSchool uses for its own export (`9A_Unit1FormativeAs_pst.csv`):
 * class, assignment, `_pst`, `.csv`. Keeping the `_pst.csv` ending costs
 * nothing and removes one way the import could decide this is not a template.
 * The assignment part is the test's name in this platform, because the name
 * in Finder is the one the teacher has to recognise.
 */
export function powerSchoolFilename(courseName: string, testName: string): string {
  const slug = (s: string) =>
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
  const parts = [slug(courseName), slug(testName)].filter(Boolean);
  return `${[...parts, "pst"].join("_")}.csv`;
}
