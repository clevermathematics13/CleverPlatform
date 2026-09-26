import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadBoundaryPageData } from "@/lib/boundary-data";
import { scoreSummary } from "@/lib/boundary-scores";
import { BoundariesClient } from "./boundaries-client";

/**
 * One assessment's grade boundaries: the lines in force and the stated
 * decision behind them, the class's scores (ClevMarks where accepted, the
 * marker's suggestions otherwise), an AI suggestion, and the teacher's
 * guidance to the AI -- for this assessment only or as a general rule for
 * all of them. See lib/boundary-data.ts for what is loaded and
 * decide_test_boundaries() for the one write that changes a level.
 */
export default async function BoundariesPage({ params }: { params: Promise<{ id: string }> }) {
  await requireTeacher();
  const { id } = await params;
  const supabase = await createClient();
  const loaded = await loadBoundaryPageData(supabase, id);

  if (!loaded.ok && loaded.status === 404) notFound();
  if (!loaded.ok) {
    return (
      <div className="max-w-5xl">
        <a href={`/dashboard/tests/${id}`} className="text-sm text-blue-300 hover:underline">
          ← Back to the assessment
        </a>
        <div className="mt-4 rounded-md border border-red-500/40 bg-red-900/35 p-4 text-sm text-red-100">
          {loaded.error}
        </div>
      </div>
    );
  }

  const data = loaded.data;
  const summary = scoreSummary(data.scores);

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <a href={`/dashboard/tests/${data.test.id}`} className="text-sm text-blue-300 hover:underline">
          ← Back to the assessment
        </a>
        <p className="mt-2 text-xs font-medium uppercase tracking-widest text-da-muted">Grade boundaries</p>
        <h1 className="font-serif text-3xl font-bold text-da-text">{data.test.name}</h1>
        <p className="mt-1 text-sm text-da-muted">
          {data.test.courseName ?? "No class"}
          {data.test.totalMarks ? ` · ${data.test.totalMarks} marks` : ""} · {summary.scored} scored
          {summary.provisional > 0 ? ` (${summary.provisional} not final yet)` : ""}
          {summary.unmarked > 0 ? ` · ${summary.unmarked} not marked` : ""}
          {summary.absent > 0 ? ` · ${summary.absent} absent` : ""}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={`/dashboard/tests/${data.test.id}/ai-grade`}
            className="rounded border border-purple-400/40 bg-purple-500/15 px-3 py-1.5 text-xs text-purple-300 hover:bg-purple-500/25"
          >
            Mark Scans →
          </a>
          {data.test.courseId && (
            <a
              href={`/dashboard/gradebook/${data.test.courseId}`}
              className="rounded border border-blue-400/40 bg-blue-500/15 px-3 py-1.5 text-xs text-blue-300 hover:bg-blue-500/25"
            >
              Gradebook →
            </a>
          )}
          {data.test.isStandards && (
            <a
              href={`/dashboard/tests/${data.test.id}/standards-report`}
              className="rounded border border-teal-400/40 bg-teal-500/15 px-3 py-1.5 text-xs text-teal-300 hover:bg-teal-500/25"
            >
              Standards report →
            </a>
          )}
        </div>
      </div>

      {data.test.isActivity ? (
        <section className="rounded-xl border border-da-border bg-da-surface p-5 text-sm text-da-muted shadow-sm">
          This is an activity. Activities are reported by learning target (Got it / Almost / Not yet), not as a 1-7
          level, so they have no grade boundaries.{" "}
          <a href={`/dashboard/tests/${data.test.id}/activity-report`} className="text-blue-300 hover:underline">
            Activity report →
          </a>
        </section>
      ) : !data.test.totalMarks ? (
        <section className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-5 text-sm text-amber-100 shadow-sm">
          This assessment has no total marks, so its boundaries cannot be set in marks yet.{" "}
          <a href={`/dashboard/tests/${data.test.id}`} className="text-blue-300 hover:underline">
            Set the total on the assessment page →
          </a>
        </section>
      ) : (
        <BoundariesClient data={data} />
      )}
    </div>
  );
}
