import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getImpersonatedRole } from "./impersonate-actions";

export default async function DashboardPage() {
  const profile = await getProfile();
  const supabase = await createClient();
  const impersonating = profile.role === "teacher"
    ? await getImpersonatedRole()
    : null;
  const viewRole = impersonating ?? profile.role;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">
        Welcome, {profile.display_name}
      </h1>
      <p className="mt-1 text-sm text-gray-600">
        {getRoleDescription(viewRole)}
      </p>

      {/* Quick Stats / Cards */}
      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {viewRole === "teacher" && <TeacherDashboard supabase={supabase} />}
        {viewRole === "student" && <StudentDashboard supabase={supabase} profileId={profile.id} />}
        {viewRole === "parent" && <ParentDashboard supabase={supabase} profileId={profile.id} />}
      </div>
    </div>
  );
}

async function TeacherDashboard({ supabase }: { supabase: Awaited<ReturnType<typeof createClient>> }) {
  const [studentsRes, invitedRes, assignmentsRes, questionsRes, coursesRes] = await Promise.all([
    supabase.from("students").select(`
      id,
      profiles:profile_id ( email )
    `).eq("hidden", false),
    supabase
      .from("invited_students")
      .select("id, email")
      .eq("registered", true)
      .eq("hidden", false),
    supabase.from("assignments").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase
      .from("ib_questions")
      .select("id", { count: "exact", head: true })
      .or("google_doc_id.not.is.null,source_pdf_path.not.is.null"),
    supabase.from("courses").select("id", { count: "exact", head: true }),
  ]);

  const enrolledEmails = new Set(
    (studentsRes.data ?? [])
      .map((s) => {
        const profile = s.profiles as unknown as { email: string } | null;
        return profile?.email ?? "";
      })
      .filter(Boolean)
  );

  const pendingStudents = (invitedRes.data ?? []).filter(
    (inv) => !enrolledEmails.has(inv.email)
  );

  const enrolledStudentCount = (studentsRes.data?.length ?? 0) + pendingStudents.length;

  return (
    <>
      <DashboardCard
        title="Students"
        value={String(enrolledStudentCount)}
        description="Enrolled (including not yet signed in)"
        href="/dashboard/students"
      />
      <DashboardCard
        title="Assignments"
        value={String(assignmentsRes.count ?? 0)}
        description="Active assignments"
        href="/dashboard/assignments"
      />
      <DashboardCard
        title="Questions"
        value={String(questionsRes.count ?? 0)}
        description="In question bank"
        href="/dashboard/questions"
      />
      <DashboardCard
        title="Courses"
        value={String(coursesRes.count ?? 0)}
        description="Available courses"
        href="/dashboard/courses"
      />
    </>
  );
}

async function StudentDashboard({ supabase, profileId }: { supabase: Awaited<ReturnType<typeof createClient>>; profileId: string }) {
  void supabase;
  void profileId;

  return (
    <>
      <DashboardCard
        title="Interactive Activity"
        value="→"
        description="Open your assigned activity"
        href="/dashboard/student-start"
      />
    </>
  );
}

async function ParentDashboard({ supabase, profileId }: { supabase: Awaited<ReturnType<typeof createClient>>; profileId: string }) {
  const { count } = await supabase
    .from("parent_links")
    .select("id", { count: "exact", head: true })
    .eq("parent_profile_id", profileId);

  return (
    <>
      <DashboardCard
        title="Linked Students"
        value={String(count ?? 0)}
        description="Students you can view"
        href="/dashboard/progress"
      />
    </>
  );
}

function DashboardCard({
  title,
  value,
  description,
  href,
}: {
  title: string;
  value: string;
  description: string;
  href: string;
}) {
  return (
    <a
      href={href}
      className="block rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
    >
      <p className="text-sm font-medium text-gray-600">{title}</p>
      <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
      <p className="mt-1 text-sm text-gray-500">{description}</p>
    </a>
  );
}

function getRoleDescription(role: string): string {
  switch (role) {
    case "teacher":
      return "Manage your courses, students, and assignments.";
    case "student":
      return "Open your activity from the student start page.";
    case "parent":
      return "View your student's progress and grades.";
    default:
      return "";
  }
}
