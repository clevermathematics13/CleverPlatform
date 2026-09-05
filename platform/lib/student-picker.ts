/**
 * Pure helpers behind the AI grader's "Matched student" picker: a typeahead
 * over the pooled Grade 9 roster, grouped by class.
 *
 * Kept free of React so the matching rules can be unit-tested directly.
 */

export interface PickableStudent {
  /** Opaque subject id the AI-grade endpoints accept (see parseGradingSubject). */
  profile_id: string;
  display_name: string;
  /** Real class the student belongs to ("9A"), or null when unknown. */
  class_name: string | null;
}

export interface StudentGroup<T extends PickableStudent = PickableStudent> {
  /** Class heading; "Other" when the student's class is unknown. */
  label: string;
  students: T[];
}

/**
 * Loosely normalise for matching: lowercase, strip accents. Apostrophes are
 * dropped so "O'Brien" stays one word ("obrien"); every other punctuation
 * mark becomes a word break so "Nunez-Ortiz" yields both surnames.
 */
export function normaliseForSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether a typed query locates a student. Each word of the query must be
 * the START of some word in the student's name (first, middle, last, or a
 * nickname shown in parentheses) -- so "fr" finds Freya Delisle, "del" finds
 * her too, and "fr de" narrows to her when another Freya is in the class.
 * An empty query matches everyone.
 */
export function matchesStudentQuery(displayName: string, query: string): boolean {
  const queryWords = normaliseForSearch(query).split(" ").filter(Boolean);
  if (queryWords.length === 0) return true;
  const nameWords = normaliseForSearch(displayName).split(" ").filter(Boolean);
  return queryWords.every((q) => nameWords.some((w) => w.startsWith(q)));
}

/**
 * Groups students by class, in the order the classes first appear in the
 * input (the caller sorts so the test's own class comes first), each group
 * sorted by name. Students with no class land in a trailing "Other" group.
 */
export function groupStudentsByClass<T extends PickableStudent>(students: T[]): StudentGroup<T>[] {
  const groups = new Map<string, T[]>();
  let other: T[] = [];
  for (const s of students) {
    if (!s.class_name) {
      other = [...other, s];
      continue;
    }
    groups.set(s.class_name, [...(groups.get(s.class_name) ?? []), s]);
  }
  const byName = (a: T, b: T) => a.display_name.localeCompare(b.display_name);
  const result: StudentGroup<T>[] = [...groups.entries()].map(([label, list]) => ({
    label,
    students: [...list].sort(byName),
  }));
  if (other.length > 0) result.push({ label: "Other", students: [...other].sort(byName) });
  return result;
}

/** groupStudentsByClass over only the students the query locates; empty groups are dropped. */
export function filterStudentGroups<T extends PickableStudent>(
  students: T[],
  query: string
): StudentGroup<T>[] {
  return groupStudentsByClass(students.filter((s) => matchesStudentQuery(s.display_name, query)));
}
