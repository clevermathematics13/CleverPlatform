import { parseGradingSubject } from "./grading-subject";

/**
 * Where "Open full student view" points for one row of the teacher's
 * reflection dashboard.
 *
 * A row's id is the opaque subject id, so it is a profiles.id only for a
 * student who has signed in. ?viewStudent= resolves its value against uuid
 * columns (profiles.id, then student_marks.student_id), so handing it an
 * "invited-<uuid>" produced a blank page for every student who has not --
 * which, on a freshly scanned class, is all of them.
 *
 * The roster kind goes to ?viewAs= instead, which is keyed on
 * invited_students.id and reads marks through the invited fallback. The
 * profile kind keeps ?viewStudent=: that is a different, older mechanism
 * which can write on the student's behalf, and nothing here needs it changed.
 */
export function studentViewHref(testId: string, subjectId: string): string {
  const subject = parseGradingSubject(subjectId);
  const param = subject.kind === "invited" ? "viewAs" : "viewStudent";
  return `/dashboard/reflection?testId=${testId}&${param}=${subject.id}`;
}
