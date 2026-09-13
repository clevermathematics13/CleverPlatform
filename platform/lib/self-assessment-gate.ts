/**
 * Whether a student still has to self-grade before Clev's Marks appear.
 *
 * `tests.require_self_assessment` is the gate, and it lives on the test.
 * A test belongs to one course but is sat by its whole track family
 * (migration 20260905182550), so switching that flag off for one class
 * switched it off for every class in the track -- Formative Assessment 1
 * hangs off 9G and is sat by 9A, 9C, 9D and 9G alike.
 *
 * `test_course_self_assessment` is the per-class exception, and this is how
 * its rows and the test's own flag combine.
 */

/**
 * The effective gate for one viewer.
 *
 * `overrides` is the override value for each of the viewer's OWN courses that
 * has a row -- their class, never its track family. Widening that lookup to
 * the family would let one class's release reach its siblings, which is the
 * thing the table exists to prevent.
 *
 * No rows means nobody has said anything about this class, so the test's own
 * flag stands and every existing test behaves exactly as it did before this
 * table existed.
 *
 * With rows, it fails closed: one course still requiring self-assessment
 * keeps the gate up, even if another releases it. A student enrolled in two
 * classes sitting one test is not a shape this app has today, so the rule
 * will almost never be load-bearing -- but the two ways to be wrong here are
 * not symmetrical. Leaving the gate up on a student who should have been
 * released is a complaint. Dropping it on a student who should not have been
 * shows them marks their teacher had not released, and cannot be taken back
 * once they have read them.
 */
export function resolveSelfAssessmentRequired(
  testRequiresSelfAssessment: boolean,
  overrides: boolean[]
): boolean {
  if (overrides.length === 0) return testRequiresSelfAssessment;
  return overrides.some((required) => required);
}
