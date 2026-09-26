import fs from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generationFamilyFor, type GenerationFamily } from "./generation-family";

/**
 * Lessons from marking, for the generators that write papers and packets.
 *
 * When a review of marked scripts finds a paper that made marking harder than
 * it had to be -- a scheme that never said what a common wrong route earns, a
 * variable that reads as a digit, a part with no space of its own -- the
 * lesson is written into generation_lessons/<family>_generation_lessons.md,
 * and every generator writing for that family appends it to its system
 * prompt. The grader's side of the same review is
 * grading_policies/reading_integrity_principles.md and the paper's marking
 * notes.
 *
 * One file per family (lib/generation-family.ts), because the three families
 * are marked differently and each lesson is written in its own family's terms.
 * Edit the .md files, not a copy of their text.
 *
 * Loaded once at module init, and fatal if a file is missing, like the
 * grading policies: lessons that can silently vanish because a file moved are
 * worse than a route that fails loudly. HTML comments hold notes to the files'
 * maintainers and are stripped, as for the NA feedback voice.
 *
 * Server-only (it reads files). The prompt builders that run in the browser
 * -- buildActivityGeneratorSystemPrompt, buildFormativeAssessmentSystemPrompt
 * -- take the lessons as a string, fetched from /api/nuanced-analyses/
 * continuity or /api/generation-lessons. The paths are written out in full so
 * the build's file tracing ships the files with the routes that read them.
 */

const G9_EXTENDED_LESSONS_PATH = path.join(
  process.cwd(),
  "generation_lessons",
  "g9_extended_generation_lessons.md"
);
const G9_STANDARD_LESSONS_PATH = path.join(
  process.cwd(),
  "generation_lessons",
  "g9_standard_generation_lessons.md"
);
const IBDP_AA_HL_LESSONS_PATH = path.join(
  process.cwd(),
  "generation_lessons",
  "ibdp_aa_hl_generation_lessons.md"
);

function loadLessons(filePath: string): string {
  try {
    return fs
      .readFileSync(filePath, "utf8")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } catch (e) {
    throw new Error(
      `Could not load the generation lessons from ${filePath}: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

const LESSONS: Record<GenerationFamily, string> = {
  g9_extended: loadLessons(G9_EXTENDED_LESSONS_PATH),
  g9_standard: loadLessons(G9_STANDARD_LESSONS_PATH),
  ibdp_aa_hl: loadLessons(IBDP_AA_HL_LESSONS_PATH),
};

/** The lessons text for one family, ready to append to a system prompt. */
export function generationLessonsBlock(family: GenerationFamily): string {
  return LESSONS[family];
}

/** A system prompt with a family's lessons appended after everything else it says. */
export function withGenerationLessons(systemPrompt: string, family: GenerationFamily): string {
  return `${systemPrompt}\n\n${generationLessonsBlock(family)}`;
}

/**
 * The family a course writes for, read from the course's name and, for a
 * roster class, the tracks it follows. Null for a course that has no lessons,
 * or that cannot be found. Throws when a read fails, so a caller can say the
 * lessons could not be loaded rather than generate without them unawares.
 */
export async function loadGenerationFamilyForCourse(
  supabase: SupabaseClient,
  courseId: string
): Promise<GenerationFamily | null> {
  const { data: course, error: courseErr } = await supabase
    .from("courses")
    .select("name")
    .eq("id", courseId)
    .maybeSingle();
  if (courseErr) throw new Error(courseErr.message);
  if (!course) return null;

  const { data: links, error: linksErr } = await supabase
    .from("track_courses")
    .select("track_course_id")
    .eq("member_course_id", courseId);
  if (linksErr) throw new Error(linksErr.message);

  const trackIds = [...new Set((links ?? []).map((row: { track_course_id: string }) => row.track_course_id))];
  let parentTrackNames: string[] = [];
  if (trackIds.length > 0) {
    const { data: tracks, error: tracksErr } = await supabase.from("courses").select("name").in("id", trackIds);
    if (tracksErr) throw new Error(tracksErr.message);
    parentTrackNames = (tracks ?? []).map((row: { name: string }) => row.name);
  }

  return generationFamilyFor({ courseName: (course as { name: string }).name, parentTrackNames });
}
