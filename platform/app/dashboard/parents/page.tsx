import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { LinkParentForm, type StudentOption } from "./link-parent-form";
import { unlinkParent } from "./actions";

export default async function ParentsPage() {
  await requireTeacher();
  const supabase = await createClient();

  const [linksRes, studentsRes] = await Promise.all([
    supabase
      .from("parent_links")
      .select(`
        id,
        created_at,
        parent:parent_profile_id ( id, email, display_name ),
        student:student_id (
          id,
          profiles:profile_id ( email, display_name ),
          courses:course_id ( name )
        )
      `)
      .order("created_at", { ascending: false }),
    supabase
      .from("students")
      .select(`
        id,
        hidden,
        profiles:profile_id ( display_name, email ),
        courses:course_id ( name )
      `)
      .eq("hidden", false)
      .order("created_at", { ascending: false }),
  ]);

  const { data: links, error } = linksRes;

  const studentOptions: StudentOption[] = (studentsRes.data ?? [])
    .map((s) => {
      const profile = s.profiles as unknown as { display_name: string; email: string } | null;
      const course = s.courses as unknown as { name: string } | null;
      if (!profile) return null;
      return {
        studentId: s.id,
        studentName: profile.display_name ?? profile.email,
        courseName: course?.name ?? "—",
      };
    })
    .filter((s): s is StudentOption => s !== null);

  return (
    <div>
      <h1 className="text-3xl font-extrabold text-blue-900 drop-shadow-sm">Parents</h1>
      <p className="mt-1 text-base font-medium text-blue-700">
        Link parent accounts to students so they can view progress and Clev&apos;s Marks.
      </p>

      <div className="mt-6">
        <LinkParentForm students={studentOptions} />
      </div>

      <div className="mt-8">
        <h2 className="text-xl font-bold text-blue-900">
          Linked Parents ({links?.length ?? 0})
        </h2>

        {error && (
          <p className="mt-2 text-sm text-red-600">
            Error loading parent links: {error.message}
          </p>
        )}

        {links && links.length > 0 ? (
          <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Parent
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Student
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Course
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {links.map((link) => {
                  const parent = link.parent as unknown as {
                    id: string; email: string; display_name: string;
                  } | null;
                  const student = link.student as unknown as {
                    id: string;
                    profiles: { email: string; display_name: string } | null;
                    courses: { name: string } | null;
                  } | null;

                  return (
                    <tr key={link.id}>
                      <td className="whitespace-nowrap px-6 py-3 text-sm text-gray-900">
                        <div className="font-medium">{parent?.display_name ?? "Unknown"}</div>
                        <div className="text-xs text-gray-500">{parent?.email}</div>
                      </td>
                      <td className="whitespace-nowrap px-6 py-3 text-sm text-gray-900">
                        <div className="font-medium">
                          {student?.profiles?.display_name ?? student?.profiles?.email ?? "Unknown"}
                        </div>
                        <div className="text-xs text-gray-500">{student?.profiles?.email}</div>
                      </td>
                      <td className="whitespace-nowrap px-6 py-3 text-sm text-gray-700">
                        {student?.courses?.name ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <form action={unlinkParent}>
                          <input type="hidden" name="link_id" value={link.id} />
                          <button
                            type="submit"
                            className="text-xs font-medium text-red-600 hover:text-red-800"
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
              No parents linked yet. Use the form above to link a parent by email.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
