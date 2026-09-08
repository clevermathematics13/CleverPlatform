/**
 * The short label an assessment carries in a filename.
 *
 * The generated PowerSchool file is named [class]_[assessment]_[how many have
 * self-assessed] -- "9C_Form1_6.csv". The middle part is tests.short_name,
 * which the teacher sets, because no rule turns "Formative Assessment 1" into
 * "Form1" reliably and a filename the teacher cannot predict is worse than one
 * they had to type once.
 *
 * abbreviateAssessmentName is the fallback for a test with no short_name set,
 * not an attempt to be clever: first token clipped to four characters, plus a
 * trailing number if the name ends in one. It gives something short and stable
 * rather than something right.
 */

/** Strip accents and anything that has no business in a filename. */
function tokens(name: string): string[] {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

/**
 * A short label derived from the assessment's name, for a test whose
 * short_name is unset. "Formative Assessment 1" -> "Form1".
 */
export function abbreviateAssessmentName(name: string): string {
  const parts = tokens(name);
  if (parts.length === 0) return "";

  const lead = parts[0].slice(0, 4);
  // A number at the very end of the name is almost always the thing that
  // distinguishes one assessment from the next ("... 1", "... 2"), so it is
  // worth keeping even when the rest is clipped away.
  const trailing = /(\d+)$/.exec(parts[parts.length - 1])?.[1] ?? "";
  return parts.length === 1 ? lead : `${lead}${trailing}`;
}

/** What to call this assessment in a filename: the teacher's short name when
 *  they set one, an abbreviation of the full name when they did not. */
export function assessmentShortName(test: {
  name: string;
  short_name?: string | null;
}): string {
  const set = test.short_name?.trim();
  if (set) return tokens(set).join("-");
  return abbreviateAssessmentName(test.name);
}

/**
 * [class]_[assessment]_[completed].csv -- the name the generated file carries.
 *
 * The count is how many students in this class have finished the
 * self-assessment, so the teacher can tell at a glance how much of the class a
 * file covers without opening it. A part that slugs to nothing is dropped
 * rather than left as an empty run of underscores.
 */
export function selfAssessmentExportFilename(
  className: string,
  test: { name: string; short_name?: string | null },
  completedCount: number
): string {
  const parts = [
    tokens(className).join("-"),
    assessmentShortName(test),
    String(completedCount),
  ].filter(Boolean);
  return `${parts.join("_")}.csv`;
}
