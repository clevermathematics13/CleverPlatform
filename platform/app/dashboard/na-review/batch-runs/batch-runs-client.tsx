"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export interface BatchRunRow {
  id: string;
  batchId: string;
  stage: string;
  totalStudents: number;
  studentsDone: number;
  status: string;
  startedAt: string;
  updatedAt: string;
  sourceFilename: string | null;
  versionLabel: string | null;
  packetTitle: string | null;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Rough estimate only -- based on this run's own average pace so far
 *  (elapsed / studentsDone), not any external benchmark. Deliberately not
 *  shown until at least one student is done, since a rate computed from
 *  zero completions is meaningless. */
function estimateRemaining(run: BatchRunRow, nowMs: number): string | null {
  if (run.studentsDone === 0) return null;
  const remaining = run.totalStudents - run.studentsDone;
  if (remaining <= 0) return null;
  const elapsedMs = nowMs - new Date(run.startedAt).getTime();
  const msPerStudent = elapsedMs / run.studentsDone;
  return formatElapsed(msPerStudent * remaining);
}

export function BatchRunsClient({ initialRuns }: { initialRuns: BatchRunRow[] }) {
  const router = useRouter();
  const [runs, setRuns] = useState(initialRuns);
  const [now, setNow] = useState(() => Date.now());
  const [actioningId, setActioningId] = useState<string | null>(null);

  useEffect(() => setRuns(initialRuns), [initialRuns]);

  // Live-ticking elapsed/ETA display -- purely cosmetic, doesn't refetch.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const setRunStatus = async (runId: string, status: "paused" | "failed" | "active") => {
    setActioningId(runId);
    try {
      const res = await fetch(`/api/na-review/batch-runs/${runId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        if (status === "paused") {
          setRuns((prev) => prev.map((r) => (r.id === runId ? { ...r, status } : r)));
        } else {
          // "Cancel" (failed) removes it from this active/paused list.
          setRuns((prev) => prev.filter((r) => r.id !== runId));
        }
      }
      router.refresh();
    } finally {
      setActioningId(null);
    }
  };

  if (runs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-da-border bg-da-surface p-12 text-center">
        <p className="text-da-muted text-sm">No batch runs are currently active or paused.</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-da-border/60 rounded-xl border border-da-border bg-da-surface">
      {runs.map((run) => {
        const pct = run.totalStudents > 0 ? Math.round((run.studentsDone / run.totalStudents) * 100) : 0;
        const elapsed = formatElapsed(now - new Date(run.startedAt).getTime());
        const eta = estimateRemaining(run, now);
        const busy = actioningId === run.id;
        return (
          <div key={run.id} className="px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-da-text">
                  {run.packetTitle ?? run.versionLabel ?? "Untitled packet"}
                  {run.sourceFilename && <span className="font-normal text-da-muted"> — {run.sourceFilename}</span>}
                </p>
                <p className="mt-0.5 text-xs text-da-muted">
                  batch {run.batchId.slice(0, 8)}… · stage: {run.stage} · elapsed {elapsed}
                  {eta ? ` · ~${eta} remaining` : ""}
                  {run.status === "paused" && " · paused"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={`/dashboard/na-review/scan-test?batchId=${run.batchId}`}
                  className="rounded-lg bg-da-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                >
                  Resume
                </a>
                {run.status === "active" ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void setRunStatus(run.id, "paused")}
                    className="rounded-lg border border-da-border px-3 py-1.5 text-xs font-medium text-da-text hover:bg-da-hover disabled:opacity-50"
                  >
                    Pause
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void setRunStatus(run.id, "active")}
                    className="rounded-lg border border-da-border px-3 py-1.5 text-xs font-medium text-da-text hover:bg-da-hover disabled:opacity-50"
                  >
                    Unpause
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void setRunStatus(run.id, "failed")}
                  className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-da-muted">
              <span>
                {run.studentsDone} / {run.totalStudents} students
              </span>
              <span>{pct}%</span>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-da-hover overflow-hidden">
              <div className="h-full bg-da-accent transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
