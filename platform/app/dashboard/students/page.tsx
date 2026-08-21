import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { removeStudent, setInvitedStudentExtraTime, setInvitedStudentHidden, setStudentExtraTime, setStudentHidden } from "./actions";
import { startStudentImpersonation } from "../impersonate-actions";
import { GoogleClassroomImport } from "./google-classroom-import";
import { GoogleClassroomLinks } from "./google-classroom-links";
import { isGoogleConnected, fetchClassroomLinks } from "./google-classroom-actions";
import { StudentsTable, type StudentRow } from "./StudentsTable";
import { CourseFilterBar } from "./CourseFilterBar";
import Link from "next/link";

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ course?: string }>;
}) {
  await requireTeacher();
  const supabase = await createClient();
  const { course: courseFilter } = await searchParams;

  const isMissingExtraTimeColumnError = (message?: string) => {
    if (!message) return false;
    const lower = message.toLowerCase();
    return lower.includes("extra_time") && (lower.includes("does not exist") || lower.includes("schema cache"));
  };

  // Fetch enrolled students with their profile and course info
  let studentsQuery = supabase
    .from("students")
    .select(`
      id,
      created_at,
      hidden,
      extra_time,
      profiles:profile_id ( id, email, display_name, nickname ),
      courses:course_id ( id, name )
    `)
    .order("created_at", { ascending: false });
  if (courseFilter) studentsQuery = studentsQuery.eq("course_id", courseFilter);

  let { data: students, error } = await studentsQuery;
  let supportsExtraTime = true;

  if (error && isMissingExtraTimeColumnError(error.message)) {
    supportsExtraTime = false;
    let fallbackQuery = supabase
      .from("students")
      .select(`
        id,
        created_at,
        hidden,
        profiles:profile_id ( id, email, display_name, nickname ),
        courses:course_id ( id, name )
      `)
      .order("created_at", { ascending: false });
    if (courseFilter) fallbackQuery = fallbackQuery.eq("course_id", courseFilter);

    const { data: fallbackStudents, error: fallbackError } = await fallbackQuery;
    error = fallbackError;
    students = (fallbackStudents ?? []).map((student) => ({ ...student, extra_time: 0 }));
  }

  // Fetch auto-registered students who haven't signed in yet (no profile_id)
  // NOTE: also includes students whose profile_id is set but aren't in the students table yet
  let importedQuery = supabase
    .from("invited_students")
    .select(`
      id,
      email,
      full_name,
      nickname,
      hidden,
      extra_time,
      created_at,
      courses:course_id ( id, name )
    `)
    .is("profile_id", null)
    .order("created_at", { ascending: false });
  if (courseFilter) importedQuery = importedQuery.eq("course_id", courseFilter);

  let { data: importedStudents, error: importedError } = await importedQuery;
  let supportsInvitedExtraTime = true;

  if (importedError && isMissingExtraTimeColumnError(importedError.message)) {
    supportsInvitedExtraTime = false;
    let fallbackImportedQuery = supabase
      .from("invited_students")
      .select(`
        id,
        email,
        full_name,
        nickname,
        hidden,
        created_at,
        courses:course_id ( id, name )
      `)
      .is("profile_id", null)
      .order("created_at", { ascending: false });
    if (courseFilter) fallbackImportedQuery = fallbackImportedQuery.eq("course_id", courseFilter);

    const { data: fallbackImportedStudents, error: fallbackImportedError } = await fallbackImportedQuery;
    importedError = fallbackImportedError;
    importedStudents = (fallbackImportedStudents ?? []).map((student) => ({ ...student, extra_time: 0 }));
  }

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

  // Fetch courses for the add form and course picker
  const { data: courses } = await supabase
    .from("courses")
    .select("id, name")
    .order("name");

  const activeCourse = courseFilter
    ? (courses ?? []).find((c) => c.id === courseFilter) ?? null
    : null;

  // Determine whether the currently-filtered class is fully archived (every
  // enrolled + invited student hidden) so the picker can offer the right
  // action (Archive vs Unarchive). Only meaningful when a course is selected
  // and it actually has students.
  const classMemberCount = (students?.length ?? 0) + pendingStudents.length;
  const classIsFullyArchived =
    Boolean(activeCourse) &&
    classMemberCount > 0 &&
    (students ?? []).every((s) => s.hidden) &&
    pendingStudents.every((s) => s.hidden);

  const gcConnected = await isGoogleConnected();
  const classroomLinks = gcConnected ? await fetchClassroomLinks() : [];

  // Normalize both enrolled and invited into unified rows
  const rows: StudentRow[] = [
    ...(students ?? []).map((student) => {
      const profile = student.profiles as unknown as {
        id: string; email: string; display_name: string; nickname: string | null;
      } | null;
      const course = student.courses as unknown as { id: string; name: string } | null;
      return {
        key: `enrolled-${student.id}`,
        type: "enrolled" as const,
        name: profile?.display_name ?? null,
        nickname: profile?.nickname ?? null,
        email: profile?.email ?? null,
        courseName: course?.name ?? null,
        profileId: profile?.id ?? null,
        invitedId: null,
        studentId: student.id,
        hidden: student.hidden ?? false,
        extraTime: student.extra_time ?? 0,
        supportsExtraTime,
        signedIn: false,
      };
    }),
    ...pendingStudents.map((inv) => {
      const course = inv.courses as unknown as { id: string; name: string } | null;
      const typedInv = inv as unknown as { nickname: string | null } & typeof inv;
      return {
        key: `invited-${inv.id}`,
        type: "invited" as const,
        name: inv.full_name ?? null,
        nickname: typedInv.nickname ?? null,
        email: inv.email,
        courseName: course?.name ?? null,
        profileId: null,
        invitedId: inv.id,
        studentId: null,
        hidden: inv.hidden ?? false,
        extraTime: inv.extra_time ?? 0,
        supportsExtraTime: supportsInvitedExtraTime,
        signedIn: false,
      };
    }),
  ];

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
          <h1 className="text-3xl font-extrabold text-da-text drop-shadow-sm">Students</h1>
          <p className="mt-1 text-base font-medium text-da-accent">
            {activeCourse
              ? `Showing students in ${activeCourse.name}`
              : "Invite students by importing from Google Classroom."}
          </p>
        </div>
      </div>

      {/* Course picker + bulk archive/unarchive */}
      <CourseFilterBar
        courses={courses ?? []}
        activeCourseId={activeCourse?.id ?? null}
        classMemberCount={classMemberCount}
        classIsFullyArchived={classIsFullyArchived}
      />

      <div className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-6">
        <h2 className="text-xl font-bold text-blue-900">
          Invite Students from Google Classroom
        </h2>
        <p className="mt-1 text-base text-blue-700">
          Connect your Google Classroom account and import your roster to create student invites.
        </p>
      </div>

      {/* Linked classes — which Google Classroom course backs which
         CleverPlatform course. Set up once per class; both the roster
         import below and the Classroom grading page read from this. */}
      <GoogleClassroomLinks
        courses={courses ?? []}
        initialConnected={gcConnected}
        initialLinks={classroomLinks}
      />

      {/* Student List */}
      <div className="mt-8">
        <h2 className="text-xl font-bold text-da-text">
          Enrolled Students ({(students?.length ?? 0) + (pendingStudents.length)})
        </h2>

        {error && (
          <p className="mt-2 text-sm text-red-600">
            Error loading students: {error.message}
          </p>
        )}

        {((students && students.length > 0) || pendingStudents.length > 0) ? (
          <StudentsTable rows={rows} />
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
            <p className="text-sm text-gray-500">
              {activeCourse
                ? "No students in this course yet."
                : "No students enrolled yet. Import students from Google Classroom below."}
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
