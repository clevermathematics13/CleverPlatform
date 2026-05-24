import { getProfile } from "@/lib/auth";
import { getStudentMastery, getClassHeatmap } from "@/lib/exam-service";
import { StudentDashboard } from "@/components/reflection/stats/StudentDashboard";
import { Heatmap } from "@/components/reflection/stats/Heatmap";

export default async function MasteryPage() {
  const profile = await getProfile();
  const isTeacher = profile.role === "teacher";

  if (isTeacher) {
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
