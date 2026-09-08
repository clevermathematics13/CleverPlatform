/**
 * PowerSchool score export
 * ------------------------
 * Builds the CSV that PowerTeacher Pro's per-assignment "Import Scores" reads.
 *
 * What the format has to be, from PowerSchool's own documentation:
 *
 * - The file must carry, at minimum, a **student identifier column holding the
 *   school-defined student number**, and a **score column**. A student name
 *   column is allowed and optional; it powers the "Validate Student Names"
 *   option, which checks the name against the number. Name is never a matching
 *   key on its own, which is why lib has nothing to offer without
 *   students.student_number / invited_students.student_number populated.
 * - A header row is normal. The import dialog's "Include First Row" option is
 *   for files WITHOUT one ("select this option if there is no header row and
 *   all rows contain data to import"), so leaving it off means row 1 is
 *   treated as headers.
 * - The field separator defaults to a comma.
 * - Several score columns are allowed in a CSV and the teacher maps one at
 *   import time. We emit a single Score column, because the achievement level
 *   is the number this platform is authoritative about.
 * - "File Score Type" is declared in the dialog, not in the file, and has to
 *   match how the assignment is set up. A real PST from this school's
 *   PowerSchool reads "Points Possible: 7.0" and "Score Type: GRADESCALE", so
 *   a 1-7 level lands unchanged there; against a differently configured
 *   assignment PowerSchool translates the value into whatever that assignment
 *   uses, which is rarely what anyone wanted.
 * - ABS is one of PowerTeacher Pro's default special codes (alongside INC and
 *   MIS). Typed into a score field it sets the Absent flag and exempts the
 *   assignment from the student's total, which is exactly what a recorded
 *   absence means here.
 *
 * No UTF-8 BOM. It would help Excel render "Tomás" if the teacher opened the
 * file before importing, but it also prefixes the first header with U+FEFF,
 * and this file's job is to be read by PowerSchool rather than by Excel.
 */

/** PowerTeacher Pro's default special code for an absence. */
export const POWERSCHOOL_ABSENT_CODE = "ABS";

/**
 * Spelled the way PowerSchool spells them. A real PST exported from
 * PowerTeacher Pro heads its columns "Student Num,Student Name,Score", so
 * matching that wording gives the import dialog the best chance of mapping
 * them without being told, and gives the teacher nothing to translate when it
 * asks. The values are unchanged: Score holds the 1-7 achievement level.
 */
export const POWERSCHOOL_HEADERS = ["Student Num", "Student Name", "Score"] as const;

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
 * RFC 4180 field: quote when the value holds a comma, a quote or a line break,
 * and double any embedded quote. Names here routinely contain a comma
 * ("Caipo, Santiago"), so this is load-bearing rather than defensive.
 */
function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

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

/** The rows whose student number is missing, so the caller can say so before
 *  the teacher takes the file to PowerSchool and finds it half-matched. */
export function rowsMissingStudentNumber(rows: PowerSchoolScoreRow[]): PowerSchoolScoreRow[] {
  return rows.filter((r) => !r.studentNumber || r.studentNumber.trim() === "");
}

/** CRLF per RFC 4180. */
export function buildPowerSchoolCsv(rows: PowerSchoolScoreRow[]): string {
  const lines = [POWERSCHOOL_HEADERS.join(",")];
  for (const row of rows) {
    lines.push(
      [
        csvField(row.studentNumber?.trim() ?? ""),
        csvField(row.studentName),
        csvField(scoreCell(row)),
      ].join(",")
    );
  }
  return lines.join("\r\n") + "\r\n";
}

/**
 * A filename that survives a Content-Disposition header and a Finder window.
 *
 * The suffix says which of the two files this is: "levels" for the plain CSV,
 * "pst" for a filled scores template. Both are named after the test in this
 * platform rather than the assignment in PowerSchool, because the name in
 * Finder is the one the teacher has to recognise.
 */
export function powerSchoolFilename(
  courseName: string,
  testName: string,
  suffix = "levels"
): string {
  const slug = (s: string) =>
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
  const parts = [slug(courseName), slug(testName), slug(suffix)].filter(Boolean);
  return `${parts.join("-")}.csv`;
}
