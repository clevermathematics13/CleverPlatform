/**
 * Turning a form's worth of per-class settings into the writes that realise it.
 *
 * `test_course_self_assessment` has three states per class and only two of
 * them are rows: no row (the test's own flag applies), a row saying released,
 * a row saying required. The form edits all three as one value, so saving has
 * to work out which classes need a row written and which need theirs removed.
 *
 * Pure, and separate from the route, because getting it backwards is silent:
 * a missed delete leaves a class released that the teacher just set back to
 * following the test, and nothing in the UI would say so -- the next page load
 * would simply show the stale value as if it were chosen.
 */

/** null means "follow the test" -- no row for that class. */
export type OverrideValue = boolean | null;
export type OverrideMap = Record<string, OverrideValue>;

export type OverrideWrites = {
  /** Rows to insert or update, as (course_id, require_self_assessment). */
  upserts: { courseId: string; requireSelfAssessment: boolean }[];
  /** Course ids whose row must go, because they are back to following the test. */
  deletes: string[];
};

/**
 * What to write so the stored overrides match `next`.
 *
 * Only differences are emitted: a class the teacher did not touch produces no
 * write at all, so saving the form does not churn `updated_at` across every
 * class in the track every time one of them changes.
 *
 * `next` is the authority for the classes it mentions and only those. A class
 * absent from it is left exactly as it is rather than deleted -- the form
 * shows the classes that sit this assessment, and a class it never listed is
 * not a class the teacher just cleared.
 */
export function diffOverrides(current: OverrideMap, next: OverrideMap): OverrideWrites {
  const upserts: OverrideWrites["upserts"] = [];
  const deletes: string[] = [];

  for (const [courseId, value] of Object.entries(next)) {
    const before = courseId in current ? current[courseId] : null;
    if (value === before) continue;
    if (value === null) deletes.push(courseId);
    else upserts.push({ courseId, requireSelfAssessment: value });
  }

  return { upserts, deletes };
}
