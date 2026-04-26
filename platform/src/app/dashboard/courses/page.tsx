import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CourseList } from "./course-list";

export default async function CoursesPage() {
  await requireTeacher();
  const supabase = await createClient();

  const [coursesRes, studentsRes, invitedRes, testsRes] = await Promise.all([
    supabase.from("courses").select("id, name, description, created_at").order("name"),
    supabase.from("students").select("course_id"),
    // Only count invited students who haven't signed in yet (no profile_id) to avoid double-counting
    supabase.from("invited_students").select("course_id").eq("registered", true).is("profile_id", null),
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
          <h1 className="text-3xl font-extrabold text-blue-900 drop-shadow-sm">Courses</h1>
          <p className="mt-1 text-base font-medium text-blue-700">
            Manage class groups and their enrollments.
          </p>
        </div>
      </div>

      <CourseList courses={courses} />
    </div>
  );
}
