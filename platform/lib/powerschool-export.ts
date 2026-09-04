import { normaliseName, tokensMatch } from "./ai-grading";

/**
 * Fills a PowerTeacher Pro "Export Template" blank-score CSV with this
 * app's own recorded scores for one test, so a teacher can re-import it
 * straight into PowerSchool.
 *
 * PowerTeacher Pro's own per-assignment score import requires a
 * school-assigned Student Number this app has no way to know or safely
 * invent (see https://ps.powerschool-docs.com/powerteacher-pro/latest/importing-and-exporting-scores).
 * Rather than storing that mapping ourselves, the teacher downloads
 * PowerTeacher's own blank template for the target assignment (Grading >
 * Assignment List > assignment > gear icon > Export Template) -- which
 * already carries the correct Student Number for every enrolled student,
 * straight from the source of truth -- and uploads it here. This module
 * only fills in the blank score column by matching each row's name against
 * our own roster; it never writes a Student Number itself.
 */

// -- Minimal RFC4180 CSV parse/stringify -------------------------------------
// No existing CSV dependency in this project (checked package.json), and a
// full library is overkill for a handful of columns / rows. Handles quoted
// fields, embedded commas/quotes/newlines, and CRLF or LF line endings.

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      endField();
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // Final field/row, unless the file ended cleanly on a newline (no trailing
  // empty row in that case).
  if (field.length > 0 || row.length > 0) endRow();

  return rows;
}

function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function stringifyCsv(rows: string[][]): string {
  return rows.map((r) => r.map(csvField).join(",")).join("\r\n");
}

// -- Header detection ----------------------------------------------------------

function normaliseHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const STUDENT_NUMBER_HEADERS = ["studentnumber", "studentid", "id"];
const FULL_NAME_HEADERS = ["studentname", "name", "student"];
const LAST_NAME_HEADERS = ["lastname", "last", "surname"];
const FIRST_NAME_HEADERS = ["firstname", "first", "givenname"];

function findHeaderIndex(headers: string[], candidates: string[]): number {
  const normalised = headers.map(normaliseHeader);
  for (const candidate of candidates) {
    const idx = normalised.indexOf(candidate);
    if (idx !== -1) return idx;
  }
  return -1;
}

export interface PowerSchoolRosterEntry {
  profileId: string;
  displayName: string;
  /** This test's recorded score for this student, or null if nothing has
   *  been entered yet in our gradebook. */
  score: number | null;
}

export type PowerSchoolFillResult =
  | { ok: true; csvText: string; warnings: string[] }
  | { ok: false; error: string };

/**
 * Fills the blank score column of a PowerTeacher Pro export template with
 * scores from `roster`, matching rows to students by name.
 *
 * Never invents a Student Number or a score: a row that can't be matched
 * confidently, or a matched student with no recorded score, is left blank
 * with a warning rather than guessed -- this writes directly into a real
 * school SIS, so a wrong number here is worse than an empty cell a teacher
 * notices and fills in by hand.
 */
export function fillPowerSchoolTemplate(
  templateCsvText: string,
  roster: PowerSchoolRosterEntry[],
  testName: string
): PowerSchoolFillResult {
  const rows = parseCsv(templateCsvText).filter((r) => !(r.length === 1 && r[0] === ""));
  if (rows.length === 0) return { ok: false, error: "The uploaded file is empty." };

  const [headerRow, ...dataRows] = rows;
  if (dataRows.length === 0) {
    return { ok: false, error: "The uploaded file has a header row but no student rows." };
  }

  const studentNumberIdx = findHeaderIndex(headerRow, STUDENT_NUMBER_HEADERS);
  if (studentNumberIdx === -1) {
    return {
      ok: false,
      error:
        `Could not find a "Student Number" column in the uploaded file (saw: ${headerRow.join(", ")}). ` +
        `Make sure you uploaded PowerTeacher Pro's own Export Template for this assignment.`,
    };
  }

  const fullNameIdx = findHeaderIndex(headerRow, FULL_NAME_HEADERS);
  const lastNameIdx = findHeaderIndex(headerRow, LAST_NAME_HEADERS);
  const firstNameIdx = findHeaderIndex(headerRow, FIRST_NAME_HEADERS);
  if (fullNameIdx === -1 && (lastNameIdx === -1 || firstNameIdx === -1)) {
    return {
      ok: false,
      error:
        `Could not find a student name column in the uploaded file (saw: ${headerRow.join(", ")}) -- ` +
        `needed to match rows against your roster.`,
    };
  }

  const usedIdx = new Set([studentNumberIdx, fullNameIdx, lastNameIdx, firstNameIdx].filter((i) => i >= 0));
  const remainingIdx = headerRow.map((_, i) => i).filter((i) => !usedIdx.has(i));

  let scoreIdx: number;
  if (remainingIdx.length === 1) {
    scoreIdx = remainingIdx[0];
  } else if (remainingIdx.length === 0) {
    return {
      ok: false,
      error: "The uploaded file has no score column left to fill after the ID and name columns.",
    };
  } else {
    const normalisedTest = normaliseHeader(testName);
    const matches = remainingIdx.filter((i) => {
      const h = normaliseHeader(headerRow[i]);
      return h.includes(normalisedTest) || normalisedTest.includes(h);
    });
    if (matches.length === 1) {
      scoreIdx = matches[0];
    } else {
      return {
        ok: false,
        error:
          `This file has more than one score column (${remainingIdx.map((i) => headerRow[i]).join(", ")}) ` +
          `and none of them clearly matches "${testName}". Export a single-assignment template from ` +
          `PowerTeacher Pro (Grading > Assignment List > this assignment > gear icon > Export Template) ` +
          `rather than a multi-assignment one.`,
      };
    }
  }

  const normalisedRoster = roster.map((r) => {
    const normalised = normaliseName(r.displayName);
    return { ...r, normalised, tokens: [...new Set(normalised.split(" ").filter(Boolean))] };
  });

  const warnings: string[] = [];
  const outRows: string[][] = [headerRow];

  for (const row of dataRows) {
    const out = [...row];
    while (out.length < headerRow.length) out.push("");

    const rawName =
      fullNameIdx !== -1
        ? (row[fullNameIdx] ?? "")
        : `${row[firstNameIdx] ?? ""} ${row[lastNameIdx] ?? ""}`.trim();
    const studentNumber = row[studentNumberIdx] ?? "";
    const rowLabel = rawName.trim() || studentNumber || "(unnamed row)";

    const target = normaliseName(rawName);
    const targetTokens = [...new Set(target.split(" ").filter(Boolean))];

    const scored: { entry: (typeof normalisedRoster)[number]; score: number }[] = [];
    for (const entry of normalisedRoster) {
      let s = 0;
      if (entry.normalised === target) {
        s = 1;
      } else if (targetTokens.length > 0 && entry.tokens.length > 0) {
        let shared = 0;
        for (const t of targetTokens) {
          if (entry.tokens.some((et) => tokensMatch(t, et))) shared++;
        }
        s = shared / Math.min(targetTokens.length, entry.tokens.length);
      }
      if (s > 0) scored.push({ entry, score: s });
    }
    scored.sort((a, b) => b.score - a.score);
    const [best, second] = scored;
    const matched =
      best && best.score >= 0.5 && (!second || best.score - second.score >= 0.15) ? best.entry : null;

    if (!matched) {
      warnings.push(`"${rowLabel}" could not be matched to a student in your roster -- left blank.`);
    } else if (matched.score === null) {
      warnings.push(`${matched.displayName} has no recorded score for "${testName}" yet -- left blank.`);
    } else {
      out[scoreIdx] = String(matched.score);
    }

    outRows.push(out);
  }

  return { ok: true, csvText: stringifyCsv(outRows), warnings };
}
