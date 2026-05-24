import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getStudentMastery } from "@/lib/exam-service";
import { redirect } from "next/navigation";

interface SubtopicQuestionPart {
  id: string;
  question_id: string;
  part_label: string;
  marks: number;
  sort_order: number;
}

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

  const { data: matchingParts } = await supabase
    .from("question_parts")
    .select("id, question_id, part_label, marks, sort_order, subtopic_codes")
    .overlaps("subtopic_codes", [code])
    .order("sort_order", { ascending: true });

  const partRows = (matchingParts ?? []) as SubtopicQuestionPart[];
  const questionIds = [...new Set(partRows.map((part) => part.question_id))];

  const { data: questions } = await supabase
    .from("ib_questions")
    .select("id, code, session, paper, level")
    .in("id", questionIds);

  const questionMap = new Map(
    (questions ?? []).map((question) => [question.id, question])
  );

  const linkedParts = partRows
    .map((part) => ({
      ...part,
      question: questionMap.get(part.question_id) ?? null,
    }))
    .filter((part) => part.question);

  linkedParts.sort((a, b) => {
    const qa = a.question?.code ?? "";
    const qb = b.question?.code ?? "";
    return qa.localeCompare(qb, undefined, { numeric: true }) || a.part_label.localeCompare(b.part_label, undefined, { numeric: true });
  });

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
        <h2 className="text-xl font-bold text-da-text">Related Questions</h2>
        {linkedParts.length === 0 ? (
          <p className="text-sm text-da-muted">No questions are tagged with this subtopic yet.</p>
        ) : (
          <div className="space-y-3">
            {linkedParts.map((part) => (
              <div key={part.id} className="rounded-lg border border-da-border/70 bg-da-bg/50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-da-text">
                      {questionLabel(part.question?.code ?? "Question")}
                    </p>
                    <p className="text-sm text-da-muted">
                      Part {part.part_label || "—"} · {part.marks} marks
                    </p>
                  </div>
                  <a
                    href={`/dashboard/questions/review?focus=${part.question_id}`}
                    className="rounded-lg border border-da-border bg-da-hover px-3 py-1.5 text-sm font-medium text-da-accent hover:opacity-90"
                  >
                    Open question
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function questionLabel(code: string): string {
  return code;
}
