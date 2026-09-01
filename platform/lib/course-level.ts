/** True for a Grade 9 course.
 *
 *  Matches the class codes ("9A", "9C", "9G", and archived variants like
 *  "9A (2025-2026)") plus the virtual "Grade 9 Extended"/"Grade 9 Standard"
 *  courses. Deliberately does NOT match DP course codes -- "27AH", "26AH",
 *  "28IH" -- nor a bare leading 9 followed by more letters, so a future
 *  "9Ext" style code does not silently become Grade 9.
 *
 *  Kept simple and readable rather than clever: course naming here is a
 *  small set controlled by one teacher, so the failure mode that matters
 *  is an unreadable regex nobody dares change, not an exotic course name. */
export function isGrade9Course(name: string): boolean {
  const n = name.trim().toLowerCase();
  return /^9[a-z]\b/.test(n) || n.startsWith("grade 9");
}
