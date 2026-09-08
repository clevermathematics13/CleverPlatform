/**
 * Filling in a PowerTeacher Scores Template (PST).
 *
 * PowerSchool's per-assignment export hands the teacher a blank template: seven
 * metadata lines, a `Student Num,Student Name,Score` header, and one row per
 * enrolled student with the Score cell empty. Filling that file in and
 * re-importing it is the workflow PowerSchool itself intends.
 *
 * Generating a lookalike from scratch was the alternative and is worse in every
 * way that matters. The metadata names the assignment PowerSchool is expecting
 * ("Unit 1 Formative Assessment", not what this platform calls the test), the
 * roster is exactly the section being graded, and the identifiers are already
 * whatever PowerSchool believes them to be. Echoing the file back with one
 * column filled means none of that has to be guessed at, and the name
 * differences that break every other integration -- "Roberto GAMIO" here
 * against "Roberto Aurelio Gamio" in this database, "Santiago CAIPO" in caps --
 * stop mattering, because matching is on Student Num alone.
 *
 * Everything except the Score cells is preserved byte for byte, including the
 * metadata block, row order, the original line endings and any trailing
 * newline. The file that comes back should differ from the file that went in
 * only where a score was written.
 */

/** A row of the PST that this module could not score, reported rather than zeroed. */
export type UnfilledPstRow = { studentNumber: string; studentName: string };

export type PstFillResult = {
  csv: string;
  /** Rows whose Score cell was written. */
  filled: number;
  /** Rows left blank because no score was supplied for that student number. */
  unfilled: UnfilledPstRow[];
  /** Student numbers we had a score for that the PST does not list -- normally
   *  students in another section of the same course. */
  notInTemplate: string[];
};

export class PstFormatError extends Error {}

/** RFC 4180 field parse: honours quotes and doubled quotes inside them. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** PowerSchool writes "Student Num"; accept "Student Number" too rather than
 *  failing on a variant that means the same thing. */
const STUDENT_NUM_HEADER = /^student\s*num(ber)?$/i;
const SCORE_HEADER = /^score$/i;

export function fillPstScores(
  pstText: string,
  scoreByStudentNumber: Map<string, string>
): PstFillResult {
  if (!pstText.trim()) throw new PstFormatError("The file is empty.");

  // Preserve the file's own line endings: it is going straight back into
  // PowerSchool, and this module has no reason to have an opinion.
  const eol = pstText.includes("\r\n") ? "\r\n" : "\n";
  const lines = pstText.split(/\r?\n/);

  let headerIdx = -1;
  let numCol = -1;
  let scoreCol = -1;
  for (let i = 0; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]).map((f) => f.trim());
    const n = fields.findIndex((f) => STUDENT_NUM_HEADER.test(f));
    const s = fields.findIndex((f) => SCORE_HEADER.test(f));
    if (n !== -1 && s !== -1) {
      headerIdx = i;
      numCol = n;
      scoreCol = s;
      break;
    }
  }
  if (headerIdx === -1) {
    throw new PstFormatError(
      'No "Student Num" and "Score" header row found. Export the scores template from the assignment in PowerTeacher Pro and upload that file.'
    );
  }

  const out = lines.slice(0, headerIdx + 1);
  const unfilled: UnfilledPstRow[] = [];
  const seen = new Set<string>();
  let filled = 0;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const raw = lines[i];
    // A blank line (the trailing one PowerSchool writes, say) is structure, not
    // a student; pass it through untouched.
    if (raw.trim() === "") {
      out.push(raw);
      continue;
    }
    const fields = parseCsvLine(raw);
    const studentNumber = (fields[numCol] ?? "").trim();
    const score = scoreByStudentNumber.get(studentNumber);

    if (studentNumber) seen.add(studentNumber);

    if (score === undefined) {
      unfilled.push({
        studentNumber,
        studentName: (fields[scoreCol > numCol ? numCol + 1 : numCol - 1] ?? "").trim(),
      });
      out.push(raw); // untouched, so an unscored row is byte-identical
      continue;
    }

    // Widen a short row rather than dropping the score off the end.
    while (fields.length <= scoreCol) fields.push("");
    fields[scoreCol] = score;
    out.push(fields.map(csvField).join(","));
    filled++;
  }

  const notInTemplate = [...scoreByStudentNumber.keys()].filter((n) => !seen.has(n));

  return { csv: out.join(eol), filled, unfilled, notInTemplate };
}
