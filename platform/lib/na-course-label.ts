/**
 * na-course-label.ts -- one spelling per course for a packet's `course` text.
 * -----------------------------------------------------------------------------
 * nuanced_analyses.course is free text, and it is written from whatever the
 * generator put in the draft's "course" field. The model has produced at
 * least four spellings for what are two courses:
 *
 *   "Grade 9 Extended Mathematics"      | Grade 9 Mathematics (Extended)
 *   "Grade 9 Mathematics (Extended)"    |
 *   "IBDP Mathematics AA HL"            | IBDP Mathematics: Analysis & Approaches HL
 *   "IBDP Mathematics: Analysis & Approaches HL"
 *
 * The Manage Saved Packets tab grouped its course filter on that raw string,
 * so the menu offered all four as if they were four courses. This module is
 * the single place that decides what a course is CALLED on a packet. It is
 * applied on every write (the sandbox save route and the editor's content
 * update) so new drift never reaches the table, and on the read side of the
 * manage tab so any row the migration missed still groups correctly.
 *
 * A label this module does not recognise is passed through unchanged (after
 * whitespace cleanup) rather than dropped: an unknown course is still a
 * course, and "Grade 10 Mathematics" must not be relabelled as anything.
 * -----------------------------------------------------------------------------
 */

export const GRADE_9_EXTENDED_COURSE_LABEL = "Grade 9 Mathematics (Extended)";
export const GRADE_9_STANDARD_COURSE_LABEL = "Grade 9 Mathematics (Standard)";
export const IBDP_AA_HL_COURSE_LABEL = "IBDP Mathematics: Analysis & Approaches HL";

// Anything that says it is a DP mathematics course, in any of the spellings
// the generator, the DP designer and the spec defaults have used for it.
const DP_RE =
  /\b(ibdp|ib|dp|aahl|aasl|aihl|aisl|aa|ai|analysis|approaches|applications|interpretation)\b/i;
const DP_AI_RE = /\b(aihl|aisl|ai|applications|interpretation)\b/i;
const DP_SL_RE = /\b(aasl|aisl|sl)\b/i;

const GRADE_9_RE = /\b(grade\s*9|g9|myp\s*4)\b/i;
const EXTENDED_RE = /\b(extended|ext)\b/i;
const STANDARD_RE = /\b(standard|std)\b/i;

/**
 * The canonical spelling of a packet's course label, or null when there is
 * no label at all (so the caller can fall back to a grade-derived default).
 */
export function canonicalCourseLabel(course: string | null | undefined): string | null {
  const raw = (course ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return null;

  if (GRADE_9_RE.test(raw)) {
    if (EXTENDED_RE.test(raw)) return GRADE_9_EXTENDED_COURSE_LABEL;
    if (STANDARD_RE.test(raw)) return GRADE_9_STANDARD_COURSE_LABEL;
    return raw;
  }

  if (DP_RE.test(raw)) {
    const family = DP_AI_RE.test(raw) ? "Applications & Interpretation" : "Analysis & Approaches";
    const level = DP_SL_RE.test(raw) ? "SL" : "HL";
    return `IBDP Mathematics: ${family} ${level}`;
  }

  return raw;
}

/**
 * The label to STORE on a packet row: the canonical spelling of the draft's
 * course, or "<grade> Mathematics" when the draft carries none. This is the
 * fallback the save route has always used; it lives here so the route and
 * the editor cannot disagree about it.
 */
export function packetCourseLabel(course: string | null | undefined, gradeLevel: string): string {
  return canonicalCourseLabel(course) ?? `${gradeLevel.trim()} Mathematics`;
}
