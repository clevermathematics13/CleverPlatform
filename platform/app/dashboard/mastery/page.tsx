import { getProfile } from "@/lib/auth";
import { getStudentMastery, getClassHeatmap } from "@/lib/exam-service";
import { StudentDashboard } from "@/components/reflection/stats/StudentDashboard";
import { Heatmap } from "@/components/reflection/stats/Heatmap";
import { createClient } from "@/lib/supabase/server";

export default async function MasteryPage({
  searchParams,
}: {
  searchParams: Promise<{ studentId?: string }>;
}) {
  const profile = await getProfile();
  const isTeacher = profile.role === "teacher";
  const { studentId } = await searchParams;

  if (isTeacher) {
    if (studentId) {
      const supabase = await createClient();
      const { data: studentProfile } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", studentId)
        .single();
      const mastery = await getStudentMastery(studentId);
      const studentName = studentProfile?.display_name ?? "Student";

      return (
        <div className="mx-auto max-w-5xl space-y-5">
          <header>
            <a href="/dashboard/mastery" className="text-sm text-da-accent hover:underline">
              ← Back to Class Mastery
            </a>
            <h1 className="mt-2 font-serif text-3xl font-bold text-da-text">{studentName}&apos;s Mastery</h1>
            <p className="mt-1 text-sm text-da-muted">
              Student-level mastery breakdown across syllabus subtopics.
            </p>
          </header>
          <section className="rounded-2xl border border-da-border bg-da-surface/90 p-5 shadow-lg shadow-black/30 wood-surface">
            <StudentDashboard mastery={mastery} studentName={studentName} />
          </section>
        </div>
      );
    }

    const cells = await getClassHeatmap();
    return (
      <div className="mx-auto max-w-7xl space-y-5">
        <header>
          <h1 className="font-serif text-3xl font-bold text-da-text">Class Mastery</h1>
          <p className="mt-1 text-sm text-da-muted">
            Track subtopic performance across your class with a high-contrast heatmap.
          </p>
        </header>
        <section className="rounded-2xl border border-da-border bg-da-surface/90 p-5 shadow-lg shadow-black/30 wood-surface">
          <Heatmap cells={cells} />
        </section>
      </div>
    );
  }

  const mastery = await getStudentMastery(profile.id);
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header>
        <h1 className="font-serif text-3xl font-bold text-da-text">My Mastery</h1>
        <p className="mt-1 text-sm text-da-muted">
          See how your understanding is progressing in each syllabus strand.
        </p>
      </header>
      <section className="rounded-2xl border border-da-border bg-da-surface/90 p-5 shadow-lg shadow-black/30 wood-surface">
        <StudentDashboard
          mastery={mastery}
          studentName={profile.display_name}
        />
      </section>
    </div>
  );
}
