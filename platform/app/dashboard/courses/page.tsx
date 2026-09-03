import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getShowHiddenStudents } from "@/lib/teacher-preferences";
import { CourseList } from "./course-list";
import Link from "next/link";

export default async function CoursesPage() {
  const profile = await requireTeacher();
  const supabase = await createClient();
  const showHidden = await getShowHiddenStudents(supabase, profile.id);

  let studentsQuery = supabase.from("students").select("course_id");
  if (!showHidden) studentsQuery = studentsQuery.eq("hidden", false);

  // Only count invited students who haven't signed in yet (no profile_id) to avoid double-counting
  let invitedQuery = supabase
    .from("invited_students")
    .select("course_id")
    .eq("registered", true)
    .is("profile_id", null);
  if (!showHidden) invitedQuery = invitedQuery.eq("hidden", false);

  const [coursesRes, studentsRes, invitedRes, testsRes, archivedCountRes] = await Promise.all([
    supabase
      .from("courses")
      .select("id, name, description, created_at")
      .eq("archived", false)
      .order("name"),
    studentsQuery,
    invitedQuery,
    supabase.from("tests").select("course_id"),
    supabase.from("courses").select("id", { count: "exact", head: true }).eq("archived", true),
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

  const archivedCount = archivedCountRes.count ?? 0;

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl font-bold text-da-text">Courses</h1>
          <p className="mt-1 text-base text-da-muted">
            Manage class groups and their enrollments.
          </p>
        </div>
        <Link
          href="/dashboard/archived-courses"
          className="inline-flex items-center gap-2 rounded-lg border border-da-border px-4 py-2 text-sm font-medium text-da-text transition-colors hover:bg-da-hover"
        >
          🗄️ Archived Courses{archivedCount > 0 ? ` (${archivedCount})` : ""}
        </Link>
      </div>

      <CourseList courses={courses} />
    </div>
  );
}
