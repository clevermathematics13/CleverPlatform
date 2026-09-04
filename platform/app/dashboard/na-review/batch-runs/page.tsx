import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { BatchRunsClient, type BatchRunRow } from "./batch-runs-client";

// Same reasoning as the scan-test page: this list reflects live pipeline
// state (na_batch_runs rows changing every few seconds while a run is
// active), so it must never be statically cached.
export const dynamic = "force-dynamic";

/**
 * /dashboard/na-review/batch-runs — "Active Batch Runs".
 *
 * Read-only view over na_batch_runs (see migration
 * 20260829031808_na_batch_runs_tracking.sql), the server-side ledger that
 * lets an automatic crop+assess run on the scan-test page survive a closed
 * tab or dropped connection. This page doesn't drive any pipeline work
 * itself -- it's a monitor: which batches have a run in flight, how far
 * along, and a Resume link back into scan-test (which does the actual
 * work, and picks the run back up automatically once loaded -- see
 * scan-test-client.tsx's loadBatch/autoCropAndAssessAll).
 */
export default async function BatchRunsPage() {
  await requireTeacher();
  const supabase = await createClient();

  // Same 48h staleness rule as the polling GET route -- a run that hasn't
  // checkpointed in that long almost certainly means a crashed tab or an
  // abandoned upload, not one still quietly working.
  const cutoffIso = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  await supabase
    .from("na_batch_runs")
    .update({ status: "stale", finished_at: new Date().toISOString() })
    .in("status", ["active", "paused"])
    .lt("updated_at", cutoffIso);

  const { data } = await supabase
    .from("na_batch_runs")
    .select(
      "id, batch_id, packet_version_id, stage, total_students, students_done, student_ids_pending, status, started_at, updated_at, finished_at, na_scan_batches(source_filename, page_count), na_packet_versions(version_label, nuanced_analyses(title))"
    )
    .in("status", ["active", "paused"])
    .order("updated_at", { ascending: false });

  const runs: BatchRunRow[] = (data ?? []).map((row) => {
    const batch = Array.isArray(row.na_scan_batches) ? row.na_scan_batches[0] : row.na_scan_batches;
    const version = Array.isArray(row.na_packet_versions) ? row.na_packet_versions[0] : row.na_packet_versions;
    const naRow = version
      ? Array.isArray(version.nuanced_analyses)
        ? version.nuanced_analyses[0]
        : version.nuanced_analyses
      : null;
    return {
      id: row.id,
      batchId: row.batch_id,
      stage: row.stage,
      totalStudents: row.total_students,
      studentsDone: row.students_done,
      status: row.status,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      sourceFilename: (batch as { source_filename: string | null } | null)?.source_filename ?? null,
      versionLabel: (version as { version_label: string } | null)?.version_label ?? null,
      packetTitle: (naRow as { title: string | null } | null)?.title ?? null,
    };
  });

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-bold text-da-text">Active Batch Runs</h1>
        <p className="mt-1 text-sm text-da-muted">
          Automatic crop + assess runs from the scan-test page that are still in progress on the
          server, even if the browser that started them is closed. Resume opens the scan-test page
          pre-loaded with that batch, which picks the run back up exactly where it left off.
        </p>
      </div>
      <BatchRunsClient initialRuns={runs} />
    </div>
  );
}
