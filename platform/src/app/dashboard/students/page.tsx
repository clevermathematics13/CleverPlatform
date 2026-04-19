import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AddStudentForm } from "./add-student-form";
import { removeStudent } from "./actions";
import { GoogleClassroomImport } from "./google-classroom-import";
import { isGoogleConnected } from "./google-classroom-actions";

export default async function StudentsPage() {
  await requireTeacher();
  const supabase = await createClient();

  // Fetch enrolled students with their profile and course info
  const { data: students, error } = await supabase
    .from("students")
    .select(`
      id,
      created_at,
      hidden,
      profiles:profile_id ( id, email, display_name, nickname ),
      courses:course_id ( id, name )
    `)
    .order("created_at", { ascending: false });

  // Fetch invited (pending) students who haven't registered yet
  const { data: invitedStudents } = await supabase
    .from("invited_students")
    .select(`
      id,
      email,
      full_name,
      registered,
      created_at,
      courses:course_id ( id, name )
    `)
    .eq("registered", false)
    .order("created_at", { ascending: false });

  // Fetch courses for the add form
  const { data: courses } = await supabase
    .from("courses")
    .select("id, name")
    .order("name");

  const gcConnected = await isGoogleConnected();

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-blue-900 drop-shadow-sm">Students</h1>
          <p className="mt-1 text-base font-medium text-blue-700">
            Manage student enrollments across courses.
          </p>
        </div>
      </div>

      {/* Add Student Form */}
      <div className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-6">
        <h2 className="text-xl font-bold text-blue-900">
          Enroll a Student
        </h2>
        <p className="mt-1 text-base text-blue-700">
          Enter a student&apos;s email to invite them to a course.
        </p>
        <AddStudentForm courses={courses ?? []} />
      </div>

      {/* Student List */}
      <div className="mt-8">
        <h2 className="text-xl font-bold text-blue-900">
          Enrolled Students ({students?.length ?? 0})
        </h2>

        {error && (
          <p className="mt-2 text-sm text-red-600">
            Error loading students: {error.message}
          </p>
        )}

        {students && students.length > 0 ? (
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
                {students.map((student) => {
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
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">
                        {profile?.nickname ? (
                          profile.nickname
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-yellow-50 px-2 py-0.5 text-xs font-medium text-yellow-700">
                            Not set
                          </span>
                        )}
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

      {/* Pending (Invited but not yet registered) Students */}
      {invitedStudents && invitedStudents.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-gray-900">
            Pending Registration ({invitedStudents.length})
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            These students have been imported but haven&apos;t logged in yet.
          </p>
          <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Email
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Course
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {invitedStudents.map((inv) => {
                  const course = inv.courses as unknown as {
                    id: string;
                    name: string;
                  };
                  return (
                    <tr key={inv.id}>
                      <td className="whitespace-nowrap px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-sm font-medium text-gray-400">
                            {inv.full_name?.[0]?.toUpperCase() ?? "?"}
                          </div>
                          <p className="text-sm font-medium text-gray-700">
                            {inv.full_name ?? "Unknown"}
                          </p>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                        {inv.email}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">
                        {course?.name ?? "Unknown"}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                          Awaiting login
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Google Classroom Import — at the bottom */}
      <GoogleClassroomImport
        courses={courses ?? []}
        initialConnected={gcConnected}
      />
    </div>
  );
}
