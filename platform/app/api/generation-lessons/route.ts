import { NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { generationLessonsBlock, loadGenerationFamilyForCourse } from "@/lib/generation-lessons";
import {
  GENERATION_FAMILY_LABELS,
  creatorFamilyForGradeLevel,
  type GenerationFamily,
} from "@/lib/generation-family";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/generation-lessons?courseId=...&gradeLevel=...
 *
 * The writing lessons a paper generated in the Assessment Creator gets: what
 * marking real scripts showed a paper for this family should do differently
 * (generation_lessons/, lib/generation-lessons.ts). The Creator builds its
 * prompt in the browser, so it cannot read the files itself.
 *
 * A chosen course decides the family, including deciding there is none (a
 * course with no lessons gets none rather than a guess from the grade). With
 * no course, the Creator's free-text grade level is the fallback
 * (creatorFamilyForGradeLevel). A course that cannot be read is a 500, so the
 * Creator can refuse to generate rather than silently leave the lessons out.
 * Teacher-only, like every generator that uses it.
 */
export async function GET(req: Request) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const { searchParams } = new URL(req.url);
  const courseId = (searchParams.get("courseId") ?? "").trim();
  const gradeLevel = searchParams.get("gradeLevel") ?? "";

  let family: GenerationFamily | null;
  if (courseId) {
    if (!UUID_RE.test(courseId)) {
      return NextResponse.json({ error: "courseId must be a UUID" }, { status: 400 });
    }
    try {
      family = await loadGenerationFamilyForCourse(supabase, courseId);
    } catch (e) {
      return NextResponse.json(
        { error: `Could not read the course to choose its writing lessons: ${e instanceof Error ? e.message : String(e)}` },
        { status: 500 }
      );
    }
  } else {
    family = creatorFamilyForGradeLevel(gradeLevel);
  }

  return NextResponse.json({
    family,
    label: family ? GENERATION_FAMILY_LABELS[family] : null,
    lessons: family ? generationLessonsBlock(family) : "",
  });
}
