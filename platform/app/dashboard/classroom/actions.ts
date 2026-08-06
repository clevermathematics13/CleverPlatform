"use server";

import { requireTeacher } from "@/lib/auth";
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

function message(err: unknown): string {
  if (err instanceof ClassroomError) return err.message;
  return err instanceof Error ? err.message : "Google Classroom request failed.";
}

export async function fetchCourses(): Promise<{
  courses: ClassroomCourse[];
  error?: string;
}> {
  await requireTeacher();
  try {
    return { courses: await listCourses() };
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
