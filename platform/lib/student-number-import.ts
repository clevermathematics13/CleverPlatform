/**
 * Bulk-filling student numbers from a pasted PowerSchool roster.
 *
 * PowerSchool matches imported scores on the school-defined student number, so
 * every student needs one stored here before an export is worth anything.
 * Typing ~50 of them by hand is the kind of task that gets done wrong once and
 * then silently produces half-matching imports forever, so this takes a paste
 * straight out of a PowerSchool roster export or a spreadsheet.
 *
 * Lines are tab- or comma-separated in either order -- "120451  Caipo,
 * Santiago" and "Santiago Caipo,120451" both work -- because which way round
 * the columns come out depends on how the roster was exported, and asking the
 * teacher to rearrange them first is asking for a mistake.
 *
 * Matching is on a normalised token SET, so "Caipo, Santiago" matches "Santiago
 * Caipo": word order carries no information here and the two systems disagree
 * about it constantly. Accents and punctuation are stripped, since "Tomás" and
 * "Tomas" are the same student and only one of the two systems thinks so.
 *
 * A line is only applied when exactly one student matches. Two students who
 * normalise identically are reported as unmatched rather than guessed at --
 * writing the wrong number is worse than writing none, because the resulting
 * import silently attaches one student's level to another.
 */

export type RosterEntry = {
  /** Opaque to this module; the caller maps it back to a students /
   *  invited_students row. */
  key: string;
  name: string;
};

export type StudentNumberMatch = {
  key: string;
  /** The roster name, for reporting. */
  name: string;
  studentNumber: string;
};

export type StudentNumberPasteResult = {
  matched: StudentNumberMatch[];
  /** Pasted lines that matched no student, or matched more than one. */
  unmatchedLines: string[];
  /** Roster names the paste said nothing about. */
  unmatchedStudents: string[];
};

/** Lowercase, unaccented, punctuation-free, order-independent name key. */
function nameKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

/** A student number is a run of digits, optionally with leading zeros; names
 *  never are. Anything else on the line is treated as part of the name. */
function isStudentNumber(field: string): boolean {
  return /^\d{2,}$/.test(field.trim());
}

export function parseStudentNumberPaste(
  text: string,
  roster: RosterEntry[]
): StudentNumberPasteResult {
  // Roster keys that are ambiguous get dropped from the lookup entirely, so an
  // ambiguous line falls through to unmatchedLines rather than picking one.
  const byKey = new Map<string, RosterEntry[]>();
  for (const entry of roster) {
    const key = nameKey(entry.name);
    if (!key) continue;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(entry);
    else byKey.set(key, [entry]);
  }

  const matched: StudentNumberMatch[] = [];
  const unmatchedLines: string[] = [];
  const claimed = new Set<string>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const fields = line.split(/\t|,/).map((f) => f.trim()).filter(Boolean);
    const numberIdx = fields.findIndex(isStudentNumber);
    if (numberIdx === -1) {
      unmatchedLines.push(line);
      continue;
    }
    const studentNumber = fields[numberIdx].trim();
    const name = fields.filter((_, i) => i !== numberIdx).join(" ");
    const candidates = byKey.get(nameKey(name)) ?? [];

    if (candidates.length !== 1) {
      unmatchedLines.push(line);
      continue;
    }
    const entry = candidates[0];
    // A second line naming the same student would otherwise overwrite the
    // first with no warning; report the later one instead.
    if (claimed.has(entry.key)) {
      unmatchedLines.push(line);
      continue;
    }
    claimed.add(entry.key);
    matched.push({ key: entry.key, name: entry.name, studentNumber });
  }

  const unmatchedStudents = roster
    .filter((entry) => !claimed.has(entry.key))
    .map((entry) => entry.name);

  return { matched, unmatchedLines, unmatchedStudents };
}
