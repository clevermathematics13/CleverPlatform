"use client";

/**
 * LoadDraftModal
 * --------------
 * Lists the teacher's saved drafts in public.assignment_templates and, on
 * selection, hands the row's draft_content back to the caller so it can be
 * loaded straight into NuancedAnalysisSandbox's live `draft` state — the
 * exact same path handleDraftGenerated() already uses for a freshly
 * generated packet.
 *
 * WHY THIS EXISTS (2026-08-19): activity-generator.tsx's "Save as Nuanced
 * Analysis" button — inside the AI Activity Generator panel — has always
 * saved to assignment_templates, not public.nuanced_analyses. That button
 * has since been relabeled to make the distinction visible going forward,
 * but a teacher's packet had already been saved there under the old,
 * misleading label, with a "saved" confirmation shown and no way to get it
 * back into the sandbox short of regenerating from scratch. This modal is
 * that way back: it reads the same GET /api/assignments/templates/[action]
 * routes the old flow already wrote through (?action=list, ?action=get),
 * so nothing server-side needed to change.
 *
 * This is explicitly a ONE-WAY IMPORT, not a live link to the template row:
 * once loaded, the draft is regular sandbox state like anything else the
 * generator produces. Saving as a Nuanced Analysis afterward goes through
 * the real flow (course + section + continuity digest) exactly as normal.
 */

import { useEffect, useState } from "react";
import type { AssignmentDraft } from "@/lib/assignments";

type TemplateSummary = {
  id: string;
  template_name: string;
  grade_level: string;
  document_kind: string;
  created_at: string;
  updated_at: string;
  /** Present on ?action=list too (the route selects `*`), used to grey out
   *  rows with nothing to load rather than let a teacher pick one and hit
   *  a confusing empty preview afterward. */
  draft_content?: AssignmentDraft | null;
};

type ListResponse = { templates?: TemplateSummary[]; error?: string };
type GetResponse = { template?: TemplateSummary; error?: string };

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function LoadDraftModal({
  open,
  onClose,
  onLoad,
}: {
  open: boolean;
  onClose: () => void;
  onLoad: (draft: AssignmentDraft) => void;
}) {
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setFetchError(null);
    void (async () => {
      try {
        // grade=all: this picker is a recovery/import path across every
        // grade a teacher might have parked a draft under, not just the
        // grade currently selected in the sandbox above it.
        const res = await fetch("/api/assignments/templates/list?grade=all");
        const data = (await res.json()) as ListResponse;
        if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
        if (!cancelled) setTemplates(data.templates ?? []);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Failed to load drafts.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function handleSelect(t: TemplateSummary) {
    setFetchError(null);
    // The list response already includes draft_content (the route selects
    // `*`), so the common case needs no second request. Only fall back to
    // ?action=get if a row's content was somehow missing at list time.
    if (t.draft_content) {
      onLoad(t.draft_content);
      onClose();
      return;
    }
    setLoadingId(t.id);
    try {
      const res = await fetch(`/api/assignments/templates/get?id=${encodeURIComponent(t.id)}`);
      const data = (await res.json()) as GetResponse;
      if (!res.ok || data.error || !data.template?.draft_content) {
        throw new Error(data.error ?? "This draft has no saved content to load.");
      }
      onLoad(data.template.draft_content);
      onClose();
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Failed to load this draft.");
    } finally {
      setLoadingId(null);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Load a saved draft"
    >
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-da-border bg-da-bg shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-da-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-da-text">Load a saved draft</h2>
            <p className="mt-0.5 text-xs text-da-muted">
              Drafts parked with the generator panel&apos;s &ldquo;Save draft&rdquo; button.
              Loading one replaces what&apos;s in the preview below — it does not save
              anything by itself.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-da-border px-2 py-1 text-xs text-da-muted transition-colors hover:bg-da-bg/60 hover:text-da-text"
          >
            ✕ Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && <p className="text-xs text-da-muted">Loading your saved drafts…</p>}

          {loadError && (
            <p className="rounded-lg border border-red-400/40 bg-red-400/10 px-3 py-2 text-xs text-red-400">
              {loadError}
            </p>
          )}

          {fetchError && (
            <p className="mb-3 rounded-lg border border-red-400/40 bg-red-400/10 px-3 py-2 text-xs text-red-400">
              {fetchError}
            </p>
          )}

          {!loading && !loadError && templates && templates.length === 0 && (
            <p className="text-xs text-da-muted">No saved drafts yet.</p>
          )}

          {!loading && !loadError && templates && templates.length > 0 && (
            <ul className="flex flex-col gap-2">
              {templates.map((t) => {
                const hasContent = Boolean(t.draft_content);
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => void handleSelect(t)}
                      disabled={!hasContent || loadingId === t.id}
                      className="w-full rounded-xl border border-da-border bg-da-bg/40 px-3 py-2.5 text-left transition-colors hover:bg-da-bg/70 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-da-text">
                          {t.template_name || "Untitled draft"}
                        </span>
                        <span className="shrink-0 text-[10px] text-da-muted">
                          {t.grade_level}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-da-muted">
                        <span>Saved {formatDate(t.updated_at || t.created_at)}</span>
                        {!hasContent && <span className="text-amber-400">No content saved</span>}
                        {loadingId === t.id && <span>Loading…</span>}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
