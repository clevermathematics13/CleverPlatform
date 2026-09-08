/**
 * Reading and filling a PowerTeacher Scores Template (PST).
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
 *
 * Storing the template turns the upload into a one-off: see clearPstScores,
 * which blanks the Score column so a stored template can never carry an old
 * score forward, and retargetPst, which rewrites the two metadata lines that
 * are about the assignment rather than the class.
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

/**
 * The metadata lines PowerSchool writes above the header, as `Label:,value,`.
 * Only the two that describe the assignment are rewritable; the rest describe
 * the class or the score format and are the same for every assignment in it.
 */
const ASSIGNMENT_NAME_LABEL = /^assignment\s*name:?$/i;
const DUE_DATE_LABEL = /^due\s*date:?$/i;
const METADATA_LABELS = {
  teacherName: /^teacher\s*name:?$/i,
  className: /^class:?$/i,
  assignmentName: ASSIGNMENT_NAME_LABEL,
  dueDate: DUE_DATE_LABEL,
  pointsPossible: /^points\s*possible:?$/i,
  scoreType: /^score\s*type:?$/i,
} as const;

export type PstMetadata = {
  [K in keyof typeof METADATA_LABELS]: string | null;
} & {
  /** Non-blank rows below the header -- the section PowerSchool exported. */
  studentCount: number;
};

/** The template split into the parts every operation here needs. Kept in one
 *  place so reading, blanking, retargeting and filling cannot disagree about
 *  where the header is. */
type ParsedPst = {
  lines: string[];
  /** The file's own line ending, preserved on the way out. */
  eol: string;
  headerIdx: number;
  numCol: number;
  scoreCol: number;
};

function parsePst(pstText: string): ParsedPst {
  if (!pstText.trim()) throw new PstFormatError("The file is empty.");

  // Preserve the file's own line endings: it is going straight back into
  // PowerSchool, and this module has no reason to have an opinion.
  const eol = pstText.includes("\r\n") ? "\r\n" : "\n";
  const lines = pstText.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]).map((f) => f.trim());
    const numCol = fields.findIndex((f) => STUDENT_NUM_HEADER.test(f));
    const scoreCol = fields.findIndex((f) => SCORE_HEADER.test(f));
    if (numCol !== -1 && scoreCol !== -1) return { lines, eol, headerIdx: i, numCol, scoreCol };
  }

  throw new PstFormatError(
    'No "Student Num" and "Score" header row found. Export the scores template from the assignment in PowerTeacher Pro and upload that file.'
  );
}

/** A blank line -- the trailing one PowerSchool writes, say -- is structure,
 *  not a student. */
const isBlank = (line: string) => line.trim() === "";

/**
 * What the template says about itself. Used to tell the teacher which
 * assignment the stored template came from, and to decide whether its
 * assignment metadata still applies.
 */
export function readPstMetadata(pstText: string): PstMetadata {
  const { lines, headerIdx } = parsePst(pstText);

  const values: Record<string, string | null> = {};
  for (const key of Object.keys(METADATA_LABELS)) values[key] = null;

  for (let i = 0; i < headerIdx; i++) {
    const fields = parseCsvLine(lines[i]);
    const label = (fields[0] ?? "").trim();
    for (const [key, pattern] of Object.entries(METADATA_LABELS)) {
      if (values[key] === null && pattern.test(label)) {
        const value = (fields[1] ?? "").trim();
        values[key] = value === "" ? null : value;
      }
    }
  }

  let studentCount = 0;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (!isBlank(lines[i])) studentCount++;
  }

  return { ...(values as { [K in keyof typeof METADATA_LABELS]: string | null }), studentCount };
}

/**
 * The template with every Score cell emptied.
 *
 * A stored template is re-filled for whatever test the teacher asks for next,
 * and a row we have no score for is passed through untouched -- so a score left
 * in the file at upload time would be handed back as though this platform had
 * just written it. Blanking on the way in makes that impossible.
 *
 * A row whose Score cell is already empty is not rewritten at all, so a blank
 * template -- the normal case -- survives byte for byte.
 */
export function clearPstScores(pstText: string): string {
  const { lines, eol, headerIdx, scoreCol } = parsePst(pstText);
  const out = lines.slice(0, headerIdx + 1);

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (isBlank(raw)) {
      out.push(raw);
      continue;
    }
    const fields = parseCsvLine(raw);
    if ((fields[scoreCol] ?? "") === "") {
      out.push(raw);
      continue;
    }
    fields[scoreCol] = "";
    out.push(fields.map(csvField).join(","));
  }

  return out.join(eol);
}

/**
 * Point a stored template at a different assignment.
 *
 * Of the seven metadata lines, five describe the class or the score format --
 * teacher, section, points possible, extra points, score type -- and hold for
 * every assignment in it. Two describe the assignment itself, and go stale the
 * moment the template is reused: a file whose header still reads "Unit 1
 * Formative Assessment" while its Score column holds Unit 2's levels is a trap
 * for whoever opens it next.
 *
 * Only ever called when the template is being reused for a different test than
 * it was uploaded from. Re-exporting the test it came from leaves the file
 * exactly as PowerSchool wrote it, which is the safer default and costs
 * nothing, because in that case the stored metadata is already right.
 *
 * A field with no value to write is left alone rather than blanked, and a label
 * the template does not carry is not invented.
 */
export function retargetPst(
  pstText: string,
  target: { assignmentName?: string | null; dueDate?: string | null }
): string {
  const { lines, eol, headerIdx } = parsePst(pstText);
  const out = [...lines];

  for (let i = 0; i < headerIdx; i++) {
    const fields = parseCsvLine(lines[i]);
    const label = (fields[0] ?? "").trim();
    const value =
      ASSIGNMENT_NAME_LABEL.test(label) && target.assignmentName
        ? target.assignmentName
        : DUE_DATE_LABEL.test(label) && target.dueDate
        ? target.dueDate
        : null;
    if (value === null) continue;
    while (fields.length <= 1) fields.push("");
    fields[1] = value;
    out[i] = fields.map(csvField).join(",");
  }

  return out.join(eol);
}

export function fillPstScores(
  pstText: string,
  scoreByStudentNumber: Map<string, string>
): PstFillResult {
  const { lines, eol, headerIdx, numCol, scoreCol } = parsePst(pstText);

  const out = lines.slice(0, headerIdx + 1);
  const unfilled: UnfilledPstRow[] = [];
  const seen = new Set<string>();
  let filled = 0;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (isBlank(raw)) {
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
