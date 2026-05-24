import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getStudentMastery } from "@/lib/exam-service";
import { redirect } from "next/navigation";

export default async function SubtopicMasteryPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; studentId?: string }>;
}) {
  const profile = await getProfile();
  const isTeacher = profile.role === "teacher";
  const { code, studentId } = await searchParams;
  const targetStudentId = isTeacher && studentId ? studentId : profile.id;

  if (!code) {
    redirect("/dashboard/mastery");
  }

  const supabase = await createClient();
  const [{ data: studentProfile }, { data: subtopicRow }, mastery] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name")
      .eq("id", targetStudentId)
      .single(),
    supabase
      .from("subtopics")
      .select("code, descriptor")
      .eq("code", code)
      .maybeSingle(),
    getStudentMastery(targetStudentId),
  ]);

  const selected = mastery.find((m) => m.code === code);
  const studentName = studentProfile?.display_name ?? "Student";
  const subtopicDescriptor = subtopicRow?.descriptor ?? code;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header>
        <a href={`/dashboard/mastery${isTeacher && studentId ? `?studentId=${encodeURIComponent(studentId)}` : ""}`} className="text-sm text-da-accent hover:underline">
          ← Back to mastery
        </a>
        <h1 className="mt-2 font-serif text-3xl font-bold text-da-text">
          {studentName}&apos;s mastery for {code}
        </h1>
        <p className="mt-1 text-sm text-da-muted">
          {subtopicDescriptor}
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-da-border bg-da-surface p-4 shadow-lg shadow-black/20">
          <p className="text-xs font-semibold uppercase tracking-wide text-da-muted">Code</p>
          <p className="mt-1 font-mono text-lg font-bold text-da-text">{code}</p>
        </div>
        <div className="rounded-xl border border-da-border bg-da-surface p-4 shadow-lg shadow-black/20">
          <p className="text-xs font-semibold uppercase tracking-wide text-da-muted">Teacher mastery</p>
          <p className="mt-1 text-2xl font-bold text-da-accent">
            {selected ? `${selected.percentage}%` : "—"}
          </p>
          <p className="text-sm text-da-muted">
            {selected ? `${selected.marks_awarded}/${selected.total_marks} marks` : "No mastery data yet"}
          </p>
        </div>
        <div className="rounded-xl border border-da-border bg-da-surface p-4 shadow-lg shadow-black/20">
          <p className="text-xs font-semibold uppercase tracking-wide text-da-muted">Self mastery</p>
          <p className="mt-1 text-2xl font-bold text-da-amber">
            {selected ? `${selected.self_percentage}%` : "—"}
          </p>
          <p className="text-sm text-da-muted">
            {selected ? `${selected.self_marks}/${selected.total_marks} marks` : "No self-score data yet"}
          </p>
        </div>
      </section>

      <section className="rounded-2xl border border-da-border bg-da-surface/90 p-5 shadow-lg shadow-black/30 wood-surface space-y-4">
        <h2 className="text-xl font-bold text-da-text">Question Links</h2>
        <p className="text-sm text-da-muted">
          This page is active, but question lists are temporarily unpopulated while we split banks into
          Past Paper Questions (PPQ) and IB-inspired questions.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-da-border/70 bg-da-bg/50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-da-muted">Current Bank</p>
            <p className="mt-1 font-semibold text-da-text">Past Paper Questions (PPQ)</p>
            <p className="mt-1 text-sm text-da-muted">Legacy question set retained and relabeled.</p>
          </div>
          <div className="rounded-lg border border-da-border/70 bg-da-bg/50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-da-muted">New Bank</p>
            <p className="mt-1 font-semibold text-da-text">IB-inspired Questions</p>
            <p className="mt-1 text-sm text-da-muted">Question mapping for this subtopic will be added after setup.</p>
          </div>
        </div>
        {!isTeacher && (
          <p className="text-sm text-da-muted">Student question access remains disabled during this transition.</p>
        )}
      </section>
    </div>
  );
}
