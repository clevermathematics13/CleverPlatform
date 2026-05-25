import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

type ArchivedSavedExamPayload = {
  id?: string;
  name?: string;
  questions?: Array<Record<string, unknown>>;
  created_at?: string;
  updated_at?: string;
};

export default async function ArchivedSavedExamsPage() {
  const profile = await getProfile();
  if (profile.role !== "teacher") redirect("/dashboard");

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("archived_saved_exams")
    .select("id, original_saved_exam_id, archived_at, exam_name, curriculum, level, paper, course_id, exam_date, exam_time, questions, archived_payload, courses(name)")
    .order("archived_at", { ascending: false });

  if (error) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-6">
        <h1 className="font-serif text-3xl font-bold text-da-text">Archived Saved Exams</h1>
        <p className="rounded-lg border border-red-700 bg-red-900/20 p-3 text-sm text-red-300">
          Failed to load archived saved exams: {error.message}
        </p>
      </div>
    );
  }

  const rows = data ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="font-serif text-3xl font-bold text-da-text">Archived Saved Exams</h1>
        <p className="mt-1 text-sm text-da-muted">
          Saved exams archived from Question Bank are stored here.
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-da-border bg-da-surface p-4 text-sm text-da-muted">
          No archived saved exams yet.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const payload = (row.archived_payload ?? {}) as ArchivedSavedExamPayload;
            const qCount = Array.isArray(row.questions)
              ? row.questions.length
              : Array.isArray(payload.questions)
                ? payload.questions.length
                : 0;
            return (
              <details
                key={row.id}
                className="rounded-xl border border-da-border bg-da-surface p-4 shadow-sm shadow-black/30"
              >
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-da-text">{row.exam_name}</p>
                      <p className="text-xs text-da-muted">
                        {(row.courses as { name?: string } | null)?.name ?? "Unknown class"}
                        {row.curriculum ? ` · ${row.curriculum}` : ""}
                        {row.level ? `${row.level}` : ""}
                        {typeof row.paper === "number" ? ` P${row.paper}` : ""}
                        {row.exam_date ? ` · ${row.exam_date}` : ""}
                        {row.exam_time ? ` ${String(row.exam_time).slice(0, 5)}` : ""}
                      </p>
                    </div>
                    <p className="text-xs text-da-muted">
                      Archived: {new Date(row.archived_at).toLocaleString()}
                    </p>
                  </div>
                </summary>

                <div className="mt-4 space-y-3 border-t border-da-border/60 pt-3 text-sm text-da-text">
                  <p className="text-xs text-da-muted">
                    Original Saved Exam ID: {row.original_saved_exam_id ?? payload.id ?? "-"}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div className="rounded border border-da-border/70 bg-da-bg/40 p-2">
                      <p className="text-xs text-da-muted">Questions</p>
                      <p className="font-semibold">{qCount}</p>
                    </div>
                    <div className="rounded border border-da-border/70 bg-da-bg/40 p-2">
                      <p className="text-xs text-da-muted">Created</p>
                      <p className="font-semibold">{payload.created_at ? new Date(payload.created_at).toLocaleDateString() : "-"}</p>
                    </div>
                    <div className="rounded border border-da-border/70 bg-da-bg/40 p-2">
                      <p className="text-xs text-da-muted">Last Updated</p>
                      <p className="font-semibold">{payload.updated_at ? new Date(payload.updated_at).toLocaleDateString() : "-"}</p>
                    </div>
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}
