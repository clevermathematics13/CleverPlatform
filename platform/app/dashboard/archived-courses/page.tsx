import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ArchivedCourseList } from "./archived-course-list";
import Link from "next/link";

export default async function ArchivedCoursesPage() {
  await requireTeacher();
  const supabase = await createClient();

  const [coursesRes, studentsRes, invitedRes, testsRes] = await Promise.all([
    supabase
      .from("courses")
      .select("id, name, description, created_at")
      .eq("archived", true)
      .order("name"),
    supabase.from("students").select("course_id"),
    supabase
      .from("invited_students")
      .select("course_id")
      .eq("registered", true)
      .is("profile_id", null),
    supabase.from("tests").select("course_id"),
  ]);

  const studentsByCourse: Record<string, number> = {};
  for (const s of studentsRes.data ?? []) {
    studentsByCourse[s.course_id] = (studentsByCourse[s.course_id] ?? 0) + 1;
  }
  for (const inv of invitedRes.data ?? []) {
    studentsByCourse[inv.course_id] = (studentsByCourse[inv.course_id] ?? 0) + 1;
  }

  const testsByCourse: Record<string, number> = {};
  for (const t of testsRes.data ?? []) {
    if (t.course_id) {
      testsByCourse[t.course_id] = (testsByCourse[t.course_id] ?? 0) + 1;
    }
  }

  const courses = (coursesRes.data ?? []).map((c) => ({
    ...c,
    studentCount: studentsByCourse[c.id] ?? 0,
    testCount: testsByCourse[c.id] ?? 0,
  }));

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/dashboard/courses"
            className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-blue-300 hover:text-blue-200"
          >
            ← Back to Courses
          </Link>
          <h1 className="font-serif text-3xl font-bold text-da-text">Archived Courses</h1>
          <p className="mt-1 text-base text-da-muted">
            Courses hidden from Students, Gradebook, and other pickers. Unarchive to restore, or
            delete permanently.
          </p>
        </div>
      </div>

      <ArchivedCourseList courses={courses} />
    </div>
  );
}
