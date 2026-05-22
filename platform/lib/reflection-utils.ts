/**
 * Pure client-safe utilities for the reflection portal.
 * No server imports — safe for both server and client components.
 */
import type { ReflectionItem } from "@/lib/reflection-types";

/**
 * Compute disagreement % between teacher marks and self-scores.
 * Formula: sum(|teacher - self|) / sum(max) * 100, one decimal place.
 * Returns null if there are no teacher marks (grading not started).
 */
export function computeDisagreement(items: ReflectionItem[]): number | null {
  let totalDiff = 0;
  let totalMax = 0;
  let hasTeacherMark = false;

  for (const item of items) {
    if (item.marks_awarded !== null) hasTeacherMark = true;
    if (item.marks_awarded !== null && item.self_marks !== null) {
      totalDiff += Math.abs(item.marks_awarded - item.self_marks);
      totalMax += item.max_marks;
    } else if (item.marks_awarded !== null || item.self_marks !== null) {
      // One side exists but not the other → full disagreement on this item
      totalDiff += item.max_marks;
      totalMax += item.max_marks;
    }
  }

  if (!hasTeacherMark) return null;
  if (totalMax === 0) return 0;
  return Math.round((totalDiff / totalMax) * 1000) / 10; // one decimal
}
