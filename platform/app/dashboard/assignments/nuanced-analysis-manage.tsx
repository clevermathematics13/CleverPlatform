"use client";

/**
 * Browse and manage saved Nuanced Analysis packets.
 *
 * WHY THIS EXISTS: /api/nuanced-analyses's GET has always returned a full
 * list (id, title, course, section_code, created_at, ...), but nothing in
 * the app ever called it — the only UI action on this table was
 * nuanced-analysis-sandbox.tsx's "Save as Nuanced Analysis" button. A
 * teacher had no way to see what had been saved, let alone remove
 * something. This page is the first read/manage surface for that table,
 * and pairs with DELETE /api/nuanced-analyses/[id].
 *
 * Deliberately its own tab (see assignments-client.tsx) rather than a
 * standalone route outside Assignments Studio, matching how every other
 * generator here (DP Designer, Nuanced Analysis, the grade sandboxes) is
 * reached via the same tab bar rather than separate top-level nav items.
 */

import { useEffect, useMemo, useState } from "react";

type PacketSummary = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  course: string;
  course_id: string | null;
  grade_level: string | null;
  section_code: string | null;
  sort_order: number;
  is_published: boolean;
  continuity_digest: unknown;
  created_at: string;
  updated_at: string;
};

type LoadState = "loading" | "ready" | "error";
type DeleteState = "idle" | "confirming" | "deleting" | "error";

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export function NuancedAnalysisManage() {
  const [packets, setPackets] = useState<PacketSummary[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [courseFilter, setCourseFilter] = useState<string>("all");
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteState, setDeleteState] = useState<DeleteState>("idle");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function loadPackets() {
    setLoadState("loading");
    setLoadError(null);
    try {
      const res = await fetch("/api/nuanced-analyses");
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Failed to load (${res.status})`);
      }
      const data = (await res.json()) as { packets: PacketSummary[] };
      setPackets(data.packets ?? []);
      setLoadState("ready");
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load saved packets");
      setLoadState("error");
    }
  }

  useEffect(() => {
    void loadPackets();
  }, []);

  const courses = useMemo(() => {
    const set = new Set(packets.map((p) => p.course).filter(Boolean));
    return Array.from(set).sort();
  }, [packets]);

  const visiblePackets = useMemo(() => {
    if (courseFilter === "all") return packets;
    return packets.filter((p) => p.course === courseFilter);
  }, [packets, courseFilter]);

  function requestDelete(id: string) {
    setDeleteTargetId(id);
    setDeleteState("confirming");
    setDeleteError(null);
  }

  function cancelDelete() {
    setDeleteTargetId(null);
    setDeleteState("idle");
    setDeleteError(null);
  }

  async function confirmDelete() {
    if (!deleteTargetId) return;
    setDeleteState("deleting");
    setDeleteError(null);
    try {
      const res = await fetch(`/api/nuanced-analyses/${deleteTargetId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Delete failed (${res.status})`);
      }
      // Remove locally rather than a full reload — keeps the filter/scroll
      // position and avoids a second round trip for something already known.
      setPackets((prev) => prev.filter((p) => p.id !== deleteTargetId));
      setDeleteTargetId(null);
      setDeleteState("idle");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Delete failed");
      setDeleteState("error");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-da-text">Manage Nuanced Analysis Packets</h2>
          <p className="text-sm text-da-muted">
            {loadState === "ready" ? `${packets.length} saved packet${packets.length === 1 ? "" : "s"}` : "\u00A0"}
          </p>
        </div>
        {courses.length > 1 && (
          <select
            value={courseFilter}
            onChange={(e) => setCourseFilter(e.target.value)}
            className="rounded-lg border border-da-border/50 bg-da-bg/30 px-3 py-1.5 text-sm text-da-text focus:border-da-accent/60 focus:outline-none"
          >
            <option value="all">All courses</option>
            {courses.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}
      </div>

      {loadState === "loading" && (
        <p className="rounded-lg border border-da-border bg-da-surface p-4 text-sm text-da-muted">
          Loading saved packets…
        </p>
      )}

      {loadState === "error" && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          <p>{loadError}</p>
          <button
            type="button"
            onClick={() => void loadPackets()}
            className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/20 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {loadState === "ready" && visiblePackets.length === 0 && (
        <p className="rounded-lg border border-da-border bg-da-surface p-4 text-sm text-da-muted">
          {packets.length === 0
            ? "No Nuanced Analysis packets have been saved yet. Generate one in the Nuanced Analysis tab, then use \u201cSave as Nuanced Analysis.\u201d"
            : "No packets match this course filter."}
        </p>
      )}

      {loadState === "ready" && visiblePackets.length > 0 && (
        <div className="space-y-3">
          {visiblePackets.map((packet) => (
            <div
              key={packet.id}
              className="rounded-xl border border-da-border bg-da-surface p-4 shadow-sm shadow-black/30"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-da-text">{packet.title}</p>
                    {packet.is_published && (
                      <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                        Published
                      </span>
                    )}
                  </div>
                  {packet.subtitle && (
                    <p className="mt-0.5 text-xs text-da-muted">{packet.subtitle}</p>
                  )}
                  <p className="mt-1 text-xs text-da-muted">
                    {packet.course}
                    {packet.section_code ? ` · Section ${packet.section_code}` : ""}
                    {packet.grade_level ? ` · ${packet.grade_level}` : ""}
                  </p>
                  <p className="mt-1 text-[11px] text-da-muted/70">
                    Created {formatDate(packet.created_at)}
                    {packet.updated_at !== packet.created_at ? ` · Updated ${formatDate(packet.updated_at)}` : ""}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <a
                    href={`/dashboard/assignments/editor/${packet.id}`}
                    className="rounded-lg border border-da-border/50 bg-da-bg/30 px-3 py-1.5 text-xs font-medium text-da-text hover:bg-da-hover transition-colors"
                  >
                    Open
                  </a>
                  <button
                    type="button"
                    onClick={() => requestDelete(packet.id)}
                    className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/20 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {deleteTargetId === packet.id && (
                <div className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3">
                  <p className="text-sm text-red-200">
                    Permanently delete <span className="font-semibold">&ldquo;{packet.title}&rdquo;</span>? This cannot be undone.
                  </p>
                  {deleteState === "error" && deleteError && (
                    <p className="mt-1 text-xs text-red-300">{deleteError}</p>
                  )}
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void confirmDelete()}
                      disabled={deleteState === "deleting"}
                      className="rounded-lg border border-red-500/60 bg-red-500/20 px-3 py-1.5 text-xs font-semibold text-red-100 hover:bg-red-500/30 disabled:opacity-50 transition-colors"
                    >
                      {deleteState === "deleting" ? "Deleting…" : "Yes, delete it"}
                    </button>
                    <button
                      type="button"
                      onClick={cancelDelete}
                      disabled={deleteState === "deleting"}
                      className="rounded-lg border border-da-border/50 bg-da-bg/30 px-3 py-1.5 text-xs font-medium text-da-text hover:bg-da-hover disabled:opacity-50 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
