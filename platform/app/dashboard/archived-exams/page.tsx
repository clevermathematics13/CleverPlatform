import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

type ArchivedPayload = {
  test?: Record<string, unknown>;
  items?: Array<Record<string, unknown>>;
  marks?: Array<Record<string, unknown>>;
  selfScores?: Array<Record<string, unknown>>;
};

export default async function ArchivedExamsPage() {
  const profile = await getProfile();
  if (profile.role !== "teacher") redirect("/dashboard");

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("archived_tests")
    .select("id, original_test_id, deleted_at, test_name, course_id, test_date, exam_time, total_marks, archived_payload, courses(name)")
    .order("deleted_at", { ascending: false });

  if (error) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-6">
        <h1 className="font-serif text-3xl font-bold text-da-text">Archived Exams</h1>
        <p className="rounded-lg border border-red-700 bg-red-900/20 p-3 text-sm text-red-300">
          Failed to load archived exams: {error.message}
        </p>
      </div>
    );
  }

  const rows = data ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="font-serif text-3xl font-bold text-da-text">Archived Exams</h1>
        <p className="mt-1 text-sm text-da-muted">
          Deleted exams are kept here for audit and recovery reference.
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-da-border bg-da-surface p-4 text-sm text-da-muted">
          No archived exams yet.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const payload = (row.archived_payload ?? {}) as ArchivedPayload;
            const items = payload.items ?? [];
            const marks = payload.marks ?? [];
            const selfScores = payload.selfScores ?? [];
            return (
              <details
                key={row.id}
                className="rounded-xl border border-da-border bg-da-surface p-4 shadow-sm shadow-black/30"
              >
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-da-text">{row.test_name}</p>
                      <p className="text-xs text-da-muted">
                        {(row.courses as { name?: string } | null)?.name ?? "Unknown class"}
                        {row.test_date ? ` · ${row.test_date}` : ""}
                        {row.exam_time ? ` ${String(row.exam_time).slice(0, 5)}` : ""}
                        {typeof row.total_marks === "number" ? ` · ${row.total_marks} marks` : ""}
                      </p>
                    </div>
                    <p className="text-xs text-da-muted">
                      Deleted: {new Date(row.deleted_at).toLocaleString()}
                    </p>
                  </div>
                </summary>

                <div className="mt-4 space-y-3 border-t border-da-border/60 pt-3 text-sm text-da-text">
                  <p className="text-xs text-da-muted">
                    Original Test ID: {row.original_test_id ?? "—"}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div className="rounded border border-da-border/70 bg-da-bg/40 p-2">
                      <p className="text-xs text-da-muted">Archived Items</p>
                      <p className="font-semibold">{items.length}</p>
                    </div>
                    <div className="rounded border border-da-border/70 bg-da-bg/40 p-2">
                      <p className="text-xs text-da-muted">Teacher Marks Rows</p>
                      <p className="font-semibold">{marks.length}</p>
                    </div>
                    <div className="rounded border border-da-border/70 bg-da-bg/40 p-2">
                      <p className="text-xs text-da-muted">Self Score Rows</p>
                      <p className="font-semibold">{selfScores.length}</p>
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
