import { notFound } from "next/navigation";
import { getProfile, requireRole } from "@/lib/auth";
import { getLesson } from "@/lib/lessons";
import { LessonClient } from "./lesson-client";

/** One mini lesson.
 *
 *  Both roles open the same page. There is no per-student data on it, so
 *  unlike na-feedback and practice it needs no ?viewAs= resolution: a
 *  teacher previewing a student is already seeing what that student sees,
 *  except for the teacher layer, which is keyed off their own role. That is
 *  the right way round -- a teacher with ?viewAs= set is checking the
 *  student's view, and hiding the notes for them would tell them nothing
 *  they could not get by reading the slide. */
export default async function LessonPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await requireRole("student", "teacher");
  const profile = await getProfile();
  const { slug } = await params;

  const lesson = getLesson(slug);
  if (!lesson) notFound();

  return <LessonClient lesson={lesson} isTeacher={profile.role === "teacher"} />;
}
