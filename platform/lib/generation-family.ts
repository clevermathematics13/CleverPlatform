/**
 * Which family of resources a generator is writing for, and so which
 * generation_lessons/ file it gets (lib/generation-lessons.ts).
 *
 * Three families, because the three are marked differently and a lesson has to
 * be written in each one's own terms: Grade 9 Extended (M/A/R/FT mark codes),
 * Grade 9 Standard (strand descriptors, never mark codes) and IBDP AA HL (IB
 * markscheme conventions). Anything else has no lessons yet and gets none,
 * rather than borrowing a neighbour's.
 *
 * Pure, so a client component can show which lessons a generation will use.
 * Reading the files is lib/generation-lessons.ts, which is server-only.
 */
import { parseDpCourseCode } from "./dp-course-code";

export type GenerationFamily = "g9_extended" | "g9_standard" | "ibdp_aa_hl";

export const GENERATION_FAMILY_LABELS: Record<GenerationFamily, string> = {
  g9_extended: "Grade 9 Extended",
  g9_standard: "Grade 9 Standard",
  ibdp_aa_hl: "IBDP AA HL",
};

function familyForCourseName(name: string): GenerationFamily | null {
  const trimmed = (name ?? "").trim();
  if (trimmed === "Grade 9 Extended") return "g9_extended";
  if (trimmed === "Grade 9 Standard") return "g9_standard";
  // A DP cohort course such as "27AH". AA SL and the AI courses are not AAHL.
  return parseDpCourseCode(trimmed)?.subjectCode === "AH" ? "ibdp_aa_hl" : null;
}

/**
 * The family a course writes for. A Grade 9 track is named for its family; a
 * roster class ("9A") takes the family of the track it follows (track_courses);
 * a DP course is read from its cohort code. A class that follows two tracks of
 * different families is ambiguous and gets none.
 */
export function generationFamilyFor(input: {
  courseName: string;
  parentTrackNames?: readonly string[];
}): GenerationFamily | null {
  const own = familyForCourseName(input.courseName);
  if (own) return own;
  const fromTracks = new Set(
    (input.parentTrackNames ?? [])
      .map(familyForCourseName)
      .filter((f): f is GenerationFamily => f !== null)
  );
  return fromTracks.size === 1 ? [...fromTracks][0] : null;
}

/**
 * The Assessment Creator's family when no course is chosen yet, from its free
 * text grade level. Its Grade 9 papers are Grade 9 Extended ones -- Standard
 * papers are imported, not written there -- and its DP papers are AAHL.
 */
export function creatorFamilyForGradeLevel(gradeLevel: string): GenerationFamily | null {
  if (/\bgrade\s*9\b/i.test(gradeLevel ?? "")) return "g9_extended";
  if (/\bgrade\s*1[12]\b/i.test(gradeLevel ?? "")) return "ibdp_aa_hl";
  return null;
}
