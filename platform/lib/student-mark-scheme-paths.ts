/**
 * Where the platform's student mark scheme lives, and whether a test has
 * released it. Dependency-free, so the teacher's test page (a client
 * component) and the server share one definition; lib/student-mark-scheme.ts
 * re-exports these.
 */

/** The address a test releases the platform's student mark scheme at. A test
 *  whose tests.mark_scheme_url is exactly this has released it (migrations
 *  20260922182232 and 20260923152709 set it), which is what lets the
 *  self-grade form show the same content part by part. It is an API path
 *  because that is what those rows store; it redirects to the page itself,
 *  studentMarkSchemePagePath. */
export function studentMarkSchemePath(testId: string): string {
  return `/api/tests/${testId}/mark-scheme`;
}

/** The full mark-scheme page (app/mark-scheme/[id]). */
export function studentMarkSchemePagePath(testId: string): string {
  return `/mark-scheme/${testId}`;
}

/** Whether a test's students are shown this platform's mark scheme: the full
 *  page, and each part's scheme on its row of the self-grade form
 *  (attachStudentMarkScheme in lib/exam-service.ts). A test whose scheme was
 *  released as a link somewhere else, or not released at all, shows them
 *  none of it. The teacher's Re-mark Requests page asks the same question,
 *  so it never says a student saw a scheme they were not shown. */
export function releasesStudentMarkScheme(test: { id: string; mark_scheme_url: string | null }): boolean {
  return test.mark_scheme_url === studentMarkSchemePath(test.id);
}
