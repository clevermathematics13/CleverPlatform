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
  const [studentsRes, assignmentsRes, questionsRes, coursesRes] = await Promise.all([
    supabase.from("students").select("id", { count: "exact", head: true }),
    supabase.from("assignments").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("questions").select("id", { count: "exact", head: true }),
    supabase.from("courses").select("id", { count: "exact", head: true }),
  ]);

  return (
    <>
      <DashboardCard
        title="Students"
        value={String(studentsRes.count ?? 0)}
        description="Enrolled students"
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
  const [gradesRes, assignmentsRes] = await Promise.all([
    supabase.from("grades").select("percentage").eq("student_id", profileId),
    supabase.from("assignments").select("id", { count: "exact", head: true }).contains("assigned_to", [profileId]).eq("status", "active"),
  ]);

  const grades = gradesRes.data ?? [];
  const avg = grades.length > 0
    ? Math.round(grades.reduce((sum, g) => sum + Number(g.percentage ?? 0), 0) / grades.length)
    : null;

  return (
    <>
      <DashboardCard
        title="My Progress"
        value={avg !== null ? `${avg}%` : "—"}
        description={grades.length > 0 ? `Across ${grades.length} assessments` : "No grades yet"}
        href="/dashboard/progress"
      />
      <DashboardCard
        title="Assignments"
        value={String(assignmentsRes.count ?? 0)}
        description="Active assignments"
        href="/dashboard/assignments"
      />
      <DashboardCard
        title="Textbook"
        value="→"
        description="Continue learning"
        href="/dashboard/textbook"
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
      return "Access your textbook, assignments, and track your progress.";
    case "parent":
      return "View your student's progress and grades.";
    default:
      return "";
  }
}
