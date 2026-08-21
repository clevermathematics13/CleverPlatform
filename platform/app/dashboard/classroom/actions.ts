"use server";

import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  listCourses,
  listStudentsInCourse,
  ClassroomError,
  type ClassroomCourse,
} from "@/lib/google-classroom";
import {
  listCourseWork,
  listSubmissions,
  setSubmissionGrade,
  type CourseWorkItem,
  type SubmissionItem,
} from "@/lib/google-classroom-work";

export interface RosterEntry {
  userId: string;
  fullName: string;
  email: string;
}

export interface SubmissionRow extends SubmissionItem {
  fullName: string;
  email: string;
}

/** A Classroom course, annotated with the CleverPlatform course it's linked
 *  to (if any) via course_google_classroom_links, managed on the Students
 *  page. Lets the picker default to "our classes" instead of every course
 *  visible in the connected Google account (PD courses, Olympiad, etc). */
export interface ClassroomCourseWithLink extends ClassroomCourse {
  linkedCourseName: string | null;
}

function message(err: unknown): string {
  if (err instanceof ClassroomError) return err.message;
  return err instanceof Error ? err.message : "Google Classroom request failed.";
}

export async function fetchCourses(): Promise<{
  courses: ClassroomCourseWithLink[];
  error?: string;
}> {
  await requireTeacher();
  try {
    const courses = await listCourses();

    const supabase = await createClient();
    const { data: links } = await supabase
      .from("course_google_classroom_links")
      .select("google_course_id, courses:course_id ( name )");

    const linkedNameByGcId = new Map<string, string>();
    for (const link of links ?? []) {
      const course = link.courses as unknown as { name: string } | null;
      if (course) linkedNameByGcId.set(link.google_course_id, course.name);
    }

    return {
      courses: courses.map((c) => ({
        ...c,
        linkedCourseName: linkedNameByGcId.get(c.id) ?? null,
      })),
    };
  } catch (err) {
    return { courses: [], error: message(err) };
  }
}

export async function fetchCourseWork(courseId: string): Promise<{
  items: CourseWorkItem[];
  error?: string;
}> {
  await requireTeacher();
  try {
    return { items: await listCourseWork(courseId) };
  } catch (err) {
    return { items: [], error: message(err) };
  }
}

export async function fetchSubmissions(
  courseId: string,
  courseWorkId: string
): Promise<{ rows: SubmissionRow[]; error?: string }> {
  await requireTeacher();
  try {
    const [submissions, roster] = await Promise.all([
      listSubmissions(courseId, courseWorkId),
      listStudentsInCourse(courseId),
    ]);

    const byId = new Map(roster.map((r) => [r.userId, r]));

    const rows: SubmissionRow[] = submissions.map((s) => {
      const student = byId.get(s.userId);
      return {
        ...s,
        fullName: student?.fullName ?? "Unknown student",
        email: student?.email ?? "",
      };
    });

    rows.sort((a, b) => a.fullName.localeCompare(b.fullName));
    return { rows };
  } catch (err) {
    return { rows: [], error: message(err) };
  }
}

export async function saveGrade(
  courseId: string,
  courseWorkId: string,
  submissionId: string,
  draftGrade: number
): Promise<{ ok: boolean; error?: string }> {
  await requireTeacher();
  try {
    await setSubmissionGrade(courseId, courseWorkId, submissionId, {
      draftGrade,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}
