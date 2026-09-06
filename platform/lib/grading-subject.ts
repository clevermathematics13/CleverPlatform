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
