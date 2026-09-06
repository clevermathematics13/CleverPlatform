/**
 * Every AI-grade endpoint's "studentId" is an opaque subject id in one of two
 * forms: a real `profiles.id` (the historical case, and still what most
 * graded students are), or the composite form `"invited-<invited_students.id>"`
 * for a roster entry that has been imported (e.g. via Google Classroom import
 * or a manual invite) but has never logged in, so has no profiles row yet.
 * This mirrors the NA scanning pipeline's invited_students-first identity
 * model (lib/na-scanning.ts, na_packet_scans.invited_student_id) rather than
 * requiring every student to sign in before their work can be graded -- see
 * ai_grade_runs.invited_student_id.
 *
 * These live in their own module, separate from lib/ai-grading.ts, purely so
 * a CLIENT component can parse a subject id. ai-grading imports fs and path
 * to read the grading policy at runtime, so importing it from the browser
 * bundle fails to build with "Can't resolve 'fs'". ai-grading re-exports
 * everything here, so server-side callers can keep importing it from there.
 */
export const INVITED_SUBJECT_PREFIX = "invited-";

export type GradingSubject = { kind: "profile"; id: string } | { kind: "invited"; id: string };

export function parseGradingSubject(studentId: string): GradingSubject {
  if (studentId.startsWith(INVITED_SUBJECT_PREFIX)) {
    return { kind: "invited", id: studentId.slice(INVITED_SUBJECT_PREFIX.length) };
  }
  return { kind: "profile", id: studentId };
}

/**
 * The inverse: rebuild the opaque subject id from a row that stores the two
 * identities in separate columns (ai_grade_runs, ai_grade_results and friends
 * all carry `student_id` / `invited_student_id` this way).
 *
 * Worth having in one place because the subject id is not only what the UI
 * keys its state by -- it is also a path segment in every evidence object's
 * storage key (`{testId}/{subjectId}/evidence/...`), so two callers spelling
 * it differently would write a student's crops to two different folders.
 *
 * Returns null when neither column is set, which is not a legitimate state
 * for a run but is representable in the schema (both columns are nullable).
 */
export function formatGradingSubject(row: {
  student_id?: string | null;
  invited_student_id?: string | null;
}): string | null {
  if (row.student_id) return row.student_id;
  if (row.invited_student_id) return `${INVITED_SUBJECT_PREFIX}${row.invited_student_id}`;
  return null;
}
