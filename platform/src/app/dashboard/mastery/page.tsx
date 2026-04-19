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
      <div className="max-w-6xl">
        <h1 className="text-2xl font-bold mb-4">Class Mastery</h1>
        <Heatmap cells={cells} />
      </div>
    );
  }

  const mastery = await getStudentMastery(profile.id);
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold mb-4">My Mastery</h1>
      <StudentDashboard
        mastery={mastery}
        studentName={profile.display_name}
      />
    </div>
  );
}
