/**
 * Pure client-safe utilities for the reflection portal.
 * No server imports — safe for both server and client components.
 */
import type { ReflectionItem } from "@/lib/reflection-types";

/**
 * Compute disagreement % between teacher marks and self-scores.
 * Formula: sum(|teacher - self|) / sum(max) * 100, one decimal place.
 * Returns null if there are no teacher marks (grading not started).
 *
 * A null self_mark is read two different ways, because it means two
 * different things:
 *
 * - Nobody has self-graded this test at all (every self_mark is null). Then
 *   there is no judgement to compare, and each marked item counts as full
 *   disagreement -- a student who has not self-graded sits at 100%, which is
 *   what the teacher dashboard has always shown for them.
 * - The student HAS self-graded and left this one question blank. The
 *   self-grade form defines a blank as "no attempt" and a 0 as "attempted and
 *   earned nothing" -- a distinction about effort, not about marks. Either
 *   way the student is claiming they earned nothing on that question, so it
 *   is compared as a claim of 0.
 *
 * Reading the second case as full disagreement (which is what happened until
 * student_self_scores.self_marks became nullable, and before that to anyone
 * whose row-at-a-time submit died halfway) locks the student out of the rest
 * of the flow for following the form's own instructions: Upload Corrections
 * only unlocks at 0%, and a blank they can never take back kept them above
 * it forever.
 */
export function computeDisagreement(items: ReflectionItem[]): number | null {
  let totalDiff = 0;
  let totalMax = 0;
  let hasTeacherMark = false;
  const hasSelfAssessed = items.some((item) => item.self_marks !== null);

  for (const item of items) {
    if (item.marks_awarded !== null) hasTeacherMark = true;
    // "Did not attempt" is a claim of zero marks, once we know the student
    // actually filled the form in.
    const selfMarks =
      item.self_marks === null && hasSelfAssessed ? 0 : item.self_marks;

    if (item.marks_awarded !== null && selfMarks !== null) {
      totalDiff += Math.abs(item.marks_awarded - selfMarks);
      totalMax += item.max_marks;
    } else if (item.marks_awarded !== null || selfMarks !== null) {
      // One side exists but not the other → full disagreement on this item
      totalDiff += item.max_marks;
      totalMax += item.max_marks;
    }
  }

  if (!hasTeacherMark) return null;
  if (totalMax === 0) return 0;
  return Math.round((totalDiff / totalMax) * 1000) / 10; // one decimal
}
