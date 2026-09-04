import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { resolveViewAs } from "@/lib/view-as";
import { getShowHiddenStudents } from "@/lib/teacher-preferences";
import { DeployCard } from "./deploy-card";
import { FeedbackIcon, SelfAssessIcon, StudentTile } from "./student-tiles";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ viewAs?: string }>;
}) {
  const { viewAs: viewAsParam } = await searchParams;
  const profile = await getProfile();
  const supabase = await createClient();
  const viewAs = await resolveViewAs(viewAsParam);
  const viewRole = viewAs ? "student" : profile.role;

  return (
    <div>
      <h1 className="text-2xl font-bold text-da-text font-serif">
        Welcome, {profile.display_name}
      </h1>
      <p className="mt-1 text-sm text-da-muted">
        {getRoleDescription(viewRole)}
      </p>

      {/* Quick Stats / Cards. The student view is two large tiles, so it
          gets a two-column grid of its own rather than sitting in the first
          two cells of the teacher's three. */}
      <div
        className={
          viewRole === "student"
            ? "mt-10 grid max-w-3xl grid-cols-1 gap-8 sm:grid-cols-2"
            : "mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
        }
      >
        {viewRole === "teacher" && <TeacherDashboard supabase={supabase} teacherId={profile.id} />}
        {viewRole === "student" && (
          <StudentDashboard viewAsId={viewAs?.invitedStudentId ?? null} />
        )}
        {viewRole === "parent" && <ParentDashboard supabase={supabase} profileId={profile.id} />}
        {viewRole === "teacher" && <DeployCard />}
      </div>
    </div>
  );
}

async function TeacherDashboard({
  supabase,
  teacherId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  teacherId: string;
}) {
  const showHidden = await getShowHiddenStudents(supabase, teacherId);

  let studentsQuery = supabase.from("students").select(`
    id,
    profiles:profile_id ( email )
  `);
  if (!showHidden) studentsQuery = studentsQuery.eq("hidden", false);

  let invitedQuery = supabase
    .from("invited_students")
    .select("id, email")
    .eq("registered", true);
  if (!showHidden) invitedQuery = invitedQuery.eq("hidden", false);

  const [studentsRes, invitedRes, assignmentsRes, questionsRes, coursesRes] = await Promise.all([
    studentsQuery,
    invitedQuery,
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
        title="PPQ Questions"
        value={String(questionsRes.count ?? 0)}
        description="In Past Paper Questions bank"
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

/** The student's own landing tiles. viewAsId is set only when a teacher is
 *  previewing this student in this tab; it rides along on each link so the
 *  destination page knows whose data to show and the view survives the
 *  navigation. A real student sees the same tiles with no param. */
async function StudentDashboard({ viewAsId }: { viewAsId: string | null }) {
  const q = viewAsId ? `?viewAs=${viewAsId}` : "";

  return (
    <>
      <StudentTile
        title="Self-Assess"
        description="Grade your own exams and review feedback"
        href={`/dashboard/reflection${q}`}
        icon={<SelfAssessIcon />}
      />
      <StudentTile
        title="My Feedback"
        description="See Clev's Marks feedback on your work"
        href={`/dashboard/na-feedback${q}`}
        icon={<FeedbackIcon />}
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
      className="block rounded-xl border border-da-border bg-da-surface p-6 shadow-sm shadow-black/30 transition-all hover:shadow-md hover:shadow-black/40 hover:border-da-accent/50 group"
    >
      <p className="text-sm font-medium text-da-muted">{title}</p>
      <p className="mt-2 text-3xl font-bold text-da-accent font-serif">{value}</p>
      <p className="mt-1 text-sm text-da-muted/70">{description}</p>
    </a>
  );
}

function getRoleDescription(role: string): string {
  switch (role) {
    case "teacher":
      return "Manage your courses, students, and assignments.";
    case "student":
      return "Grade your own work and read Clev's Marks feedback on it.";
    case "parent":
      return "View your student's progress and grades.";
    default:
      return "";
  }
}
