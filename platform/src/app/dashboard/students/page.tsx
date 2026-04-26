import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AddStudentForm } from "./add-student-form";
import { NicknameCell } from "./NicknameCell";
import { removeStudent } from "./actions";
import { GoogleClassroomImport } from "./google-classroom-import";
import { isGoogleConnected } from "./google-classroom-actions";
import Link from "next/link";

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ course?: string }>;
}) {
  await requireTeacher();
  const supabase = await createClient();
  const { course: courseFilter } = await searchParams;

  // Fetch enrolled students with their profile and course info
  let studentsQuery = supabase
    .from("students")
    .select(`
      id,
      created_at,
      hidden,
      profiles:profile_id ( id, email, display_name, nickname ),
      courses:course_id ( id, name )
    `)
    .order("created_at", { ascending: false });
  if (courseFilter) studentsQuery = studentsQuery.eq("course_id", courseFilter);

  const { data: students, error } = await studentsQuery;

  // Fetch auto-registered students who haven't signed in yet (no profile_id)
  // NOTE: also includes students whose profile_id is set but aren't in the students table yet
  let importedQuery = supabase
    .from("invited_students")
    .select(`
      id,
      email,
      full_name,
      created_at,
      courses:course_id ( id, name )
    `)
    .eq("registered", true)
    .order("created_at", { ascending: false });
  if (courseFilter) importedQuery = importedQuery.eq("course_id", courseFilter);

  const { data: importedStudents, error: importedError } = await importedQuery;
  if (importedError) {
    console.error("[StudentsPage] invited_students query error:", importedError.message, importedError.code);
  }
  console.log("[StudentsPage] invited_students count:", importedStudents?.length ?? 0, "courseFilter:", courseFilter);

  // Exclude invited students who are already enrolled (appear in students table)
  const enrolledEmails = new Set(
    (students ?? []).map((s) => {
      const p = s.profiles as unknown as { email: string } | null;
      return p?.email ?? "";
    }).filter(Boolean)
  );
  const pendingStudents = (importedStudents ?? []).filter(
    (inv) => !enrolledEmails.has(inv.email)
  );

  // Fetch courses for the add form
  const { data: courses } = await supabase
    .from("courses")
    .select("id, name")
    .order("name");

  const activeCourse = courseFilter
    ? (courses ?? []).find((c) => c.id === courseFilter) ?? null
    : null;

  const gcConnected = await isGoogleConnected();

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          {activeCourse && (
            <Link
              href="/dashboard/courses"
              className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-800"
            >
              ← Back to Courses
            </Link>
          )}
          <h1 className="text-3xl font-extrabold text-blue-900 drop-shadow-sm">Students</h1>
          <p className="mt-1 text-base font-medium text-blue-700">
            {activeCourse
              ? `Showing students in ${activeCourse.name}`
              : "Manage student enrollments across courses."}
          </p>
        </div>
        {activeCourse && (
          <Link
            href="/dashboard/students"
            className="text-sm text-gray-500 hover:text-gray-700 underline"
          >
            Clear filter
          </Link>
        )}
      </div>

      {/* Add Student Form */}
      <div className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-6">
        <h2 className="text-xl font-bold text-blue-900">
          Enroll a Student
        </h2>
        <p className="mt-1 text-base text-blue-700">
          Enter a student&apos;s email to invite them to a course.
        </p>
        <AddStudentForm courses={courses ?? []} defaultCourseId={activeCourse?.id} />
      </div>

      {/* Student List */}
      <div className="mt-8">
        <h2 className="text-xl font-bold text-blue-900">
          Enrolled Students ({(students?.length ?? 0) + (pendingStudents.length)})
        </h2>

        {error && (
          <p className="mt-2 text-sm text-red-600">
            Error loading students: {error.message}
          </p>
        )}

        {((students && students.length > 0) || pendingStudents.length > 0) ? (
          <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Student
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Nickname
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Course
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Enrolled
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {students?.map((student) => {
                  const profile = student.profiles as unknown as {
                    id: string;
                    email: string;
                    display_name: string;
                    nickname: string | null;
                  };
                  const course = student.courses as unknown as {
                    id: string;
                    name: string;
                  };
                  return (
                    <tr key={student.id}>
                      <td className="whitespace-nowrap px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-sm font-medium text-blue-700">
                            {profile?.display_name?.[0]?.toUpperCase() ?? "?"}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900">
                              {profile?.display_name ?? "Unknown"}
                              {student.hidden && <span className="ml-1 text-xs font-normal text-gray-400">(hidden)</span>}
                            </p>
                            <p className="text-xs text-gray-500">
                              {profile?.email}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <NicknameCell profileId={profile?.id} nickname={profile?.nickname ?? null} />
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">
                        {course?.name ?? "Unknown"}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                        {new Date(student.created_at).toLocaleDateString()}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-right">
                        <form action={removeStudent}>
                          <input
                            type="hidden"
                            name="student_id"
                            value={student.id}
                          />
                          <button
                            type="submit"
                            className="text-sm text-red-600 hover:text-red-800"
                          >
                            Remove
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
                {pendingStudents.map((inv) => {
                  const course = inv.courses as unknown as {
                    id: string;
                    name: string;
                  };
                  return (
                    <tr key={inv.id}>
                      <td className="whitespace-nowrap px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-sm font-medium text-gray-500">
                            {inv.full_name?.[0]?.toUpperCase() ?? "?"}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900">
                              {inv.full_name ?? "Unknown"}
                            </p>
                            <p className="text-xs text-gray-500">{inv.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <NicknameCell invitedId={inv.id} nickname={null} />
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">
                        {course?.name ?? "Unknown"}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                        {new Date(inv.created_at).toLocaleDateString()}
                        <span className="ml-2 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                          Not signed in
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-right text-sm text-gray-400">
                        —
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
            <p className="text-sm text-gray-500">
              No students enrolled yet. Use the form above to add one.
            </p>
          </div>
        )}
      </div>

      {/* Google Classroom Import — at the bottom */}
      <GoogleClassroomImport
        courses={courses ?? []}
        initialConnected={gcConnected}
        defaultTargetCourseId={activeCourse?.id}
      />
    </div>
  );
}
