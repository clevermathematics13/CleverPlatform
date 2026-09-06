"use client";

import { useCallback, useEffect, useState } from "react";
import EvidenceBoxEditor, { type DrawnBox } from "@/components/EvidenceBoxEditor";
import { fetchJson } from "../ai-grade/fetch-json";

interface Layout {
  id: string;
  label: string;
  reference_kind: string | null;
  reference_run_id: string | null;
  page_count: number;
  anchors_locked: boolean;
}

interface Anchor {
  id: string;
  question_number: number;
  part_label: string | null;
  page_index: number;
  x0_pt: number;
  y0_pt: number;
  x1_pt: number;
  y1_pt: number;
  expand_max_y1_pt: number | null;
}

interface Part {
  testItemId: string;
  questionNumber: number;
  partLabel: string;
  label: string;
  maxMarks: number;
}

interface ReferenceCandidate {
  id: string;
  student_id: string | null;
  invited_student_id: string | null;
  created_at: string;
}

/** The natural key a region is stored under -- see test_item_anchors. */
const partKey = (questionNumber: number, partLabel: string | null) =>
  `${questionNumber}|${partLabel ?? ""}`;

export function PaperLayoutClient({ testId }: { testId: string }) {
  const [layout, setLayout] = useState<Layout | null>(null);
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  const [candidates, setCandidates] = useState<ReferenceCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  // The part whose region is being drawn, if any.
  const [editing, setEditing] = useState<{ part: Part; page: number; imageSrc: string | null } | null>(null);
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  // No state is touched before the first await, so mounting this component
  // does not schedule a synchronous re-render from inside the effect below.
  const load = useCallback(async () => {
    const { ok, data } = await fetchJson(`/api/tests/${testId}/paper-layout`);
    if (!ok) {
      setError((data.error as string) ?? "Could not load the paper layout.");
      return;
    }
    setError(null);
    setLayout((data.layout as Layout | null) ?? null);
    setAnchors((data.anchors as Anchor[]) ?? []);
    setParts((data.parts as Part[]) ?? []);
    setCandidates((data.referenceCandidates as ReferenceCandidate[]) ?? []);
  }, [testId]);

  useEffect(() => {
    // Everything here runs after an await, so the effect body itself sets no
    // state -- and the cancel flag stops a slow first load writing into a
    // component the teacher has already navigated away from.
    let cancelled = false;
    void (async () => {
      await load();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const anchorByPart = new Map(anchors.map((a) => [partKey(a.question_number, a.part_label), a]));
  const placed = parts.filter((p) => anchorByPart.has(partKey(p.questionNumber, p.partLabel || null))).length;

  const createLayout = async (runId: string) => {
    setBusy(true);
    setError(null);
    try {
      const { ok, data } = await fetchJson(`/api/tests/${testId}/paper-layout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId }),
      });
      if (!ok) {
        setError((data.error as string) ?? "Could not create the layout.");
        return;
      }
      setStatus(`Reference paper set — ${data.pageCount} pages. Draw a region for each part below.`);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const setLocked = async (locked: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const { ok, data } = await fetchJson(`/api/tests/${testId}/paper-layout`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anchorsLocked: locked }),
      });
      if (!ok) {
        setError((data.error as string) ?? "Could not change the lock.");
        return;
      }
      setStatus(locked ? "Layout locked." : "Layout unlocked for editing.");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const loadEditorPage = async (part: Part, page: number) => {
    setEditorLoading(true);
    setEditorError(null);
    try {
      const query = new URLSearchParams({ page: String(page), questionNumber: String(part.questionNumber) });
      if (part.partLabel) query.set("partLabel", part.partLabel);
      const { ok, data } = await fetchJson(`/api/tests/${testId}/paper-layout/page-image?${query}`);
      if (!ok || typeof data.imageBase64 !== "string") {
        setEditorError((data.error as string) ?? "Could not load that page.");
        return;
      }
      const mediaType = typeof data.imageMediaType === "string" ? data.imageMediaType : "image/png";
      setEditing((prev) =>
        prev && prev.part.testItemId === part.testItemId
          ? { ...prev, page, imageSrc: `data:${mediaType};base64,${data.imageBase64}` }
          : prev
      );
    } finally {
      setEditorLoading(false);
    }
  };

  const openEditor = async (part: Part) => {
    const existing = anchorByPart.get(partKey(part.questionNumber, part.partLabel || null));
    // Start on the page this part's region is already on, or the page of the
    // part before it -- consecutive parts are nearly always on one page, so
    // that beats always opening page 1 on a ten-page booklet.
    const index = parts.findIndex((p) => p.testItemId === part.testItemId);
    const previous = index > 0 ? anchorByPart.get(partKey(parts[index - 1].questionNumber, parts[index - 1].partLabel || null)) : null;
    const startPage = (existing?.page_index ?? previous?.page_index ?? 0) + 1;
    setEditing({ part, page: startPage, imageSrc: null });
    setEditorError(null);
    await loadEditorPage(part, startPage);
  };

  const saveRegion = async (drawn: DrawnBox) => {
    if (!editing) return;
    const { part, page } = editing;
    setEditorSaving(true);
    setEditorError(null);
    try {
      const { ok, data } = await fetchJson(`/api/tests/${testId}/paper-layout/anchors`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionNumber: part.questionNumber,
          partLabel: part.partLabel || null,
          sortOrder: parts.findIndex((p) => p.testItemId === part.testItemId),
          page,
          ...drawn,
        }),
      });
      if (!ok) {
        setEditorError((data.error as string) ?? "Could not save that region.");
        return;
      }
      setEditing(null);
      setStatus(`Region saved for ${part.label}.`);
      await load();
    } finally {
      setEditorSaving(false);
    }
  };

  const clearRegion = async (part: Part) => {
    setBusy(true);
    setError(null);
    try {
      const query = new URLSearchParams({ questionNumber: String(part.questionNumber) });
      if (part.partLabel) query.set("partLabel", part.partLabel);
      const { ok, data } = await fetchJson(`/api/tests/${testId}/paper-layout/anchors?${query}`, {
        method: "DELETE",
      });
      if (!ok) {
        setError((data.error as string) ?? "Could not clear that region.");
        return;
      }
      setStatus(`Region cleared for ${part.label}.`);
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="text-sm text-da-muted">Loading…</p>;

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded border border-red-400/40 bg-red-500/15 px-3 py-2 text-sm text-red-300" role="alert">
          {error}
        </p>
      )}
      {status && <p className="text-sm text-green-300">{status}</p>}

      <p className="rounded border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
        Regions are not in use yet. Saving them here records the layout; the marker
        still locates each crop itself until the code that reads these regions
        ships. Nothing you do on this page changes a mark.
      </p>

      {!layout ? (
        <section className="rounded border border-da-border bg-da-surface p-4">
          <h2 className="text-sm font-semibold text-da-text">Choose a reference paper</h2>
          <p className="mt-1 text-xs text-da-muted">
            There is no blank copy of the paper on file, so pick one student&apos;s
            scan to measure against. Any of them will do — every student sat the
            same booklet — but one that is cleanly scanned and fully answered is
            easiest to draw on.
          </p>
          {candidates.length === 0 ? (
            <p className="mt-3 text-xs text-da-muted">
              No graded scans on this assessment yet. Mark at least one student first.
            </p>
          ) : (
            <ul className="mt-3 space-y-1">
              {candidates.slice(0, 12).map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => createLayout(c.id)}
                    disabled={busy}
                    className="rounded border border-da-border px-3 py-1 text-xs text-da-text hover:border-blue-400 hover:bg-blue-500/20 disabled:opacity-50"
                  >
                    Use the scan from {new Date(c.created_at).toLocaleString()}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <>
          <section className="flex flex-wrap items-center gap-3 rounded border border-da-border bg-da-surface p-3 text-xs">
            <span className="text-da-muted">
              {layout.page_count}-page reference · <strong className="text-da-text">{placed}</strong> of{" "}
              <strong className="text-da-text">{parts.length}</strong> parts placed
            </span>
            {layout.anchors_locked ? (
              <span className="rounded border border-green-400/40 bg-green-500/15 px-2 py-0.5 text-green-300">
                Locked
              </span>
            ) : (
              <span className="rounded border border-da-border px-2 py-0.5 text-da-muted">Draft</span>
            )}
            <button
              type="button"
              onClick={() => setLocked(!layout.anchors_locked)}
              disabled={busy}
              className="ml-auto rounded border border-da-border px-3 py-1 text-da-text hover:bg-da-hover disabled:opacity-50"
            >
              {layout.anchors_locked ? "Unlock to edit" : "Lock layout"}
            </button>
          </section>

          <section className="overflow-hidden rounded border border-da-border">
            <table className="w-full text-sm">
              <thead className="bg-da-surface text-xs uppercase tracking-wide text-da-muted">
                <tr>
                  <th className="px-3 py-2 text-left">Part</th>
                  <th className="px-3 py-2 text-left">Marks</th>
                  <th className="px-3 py-2 text-left">Region</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {parts.map((part) => {
                  const anchor = anchorByPart.get(partKey(part.questionNumber, part.partLabel || null));
                  return (
                    <tr key={part.testItemId} className="border-t border-da-border">
                      <td className="px-3 py-2 font-medium text-da-text">{part.label}</td>
                      <td className="px-3 py-2 text-da-muted">{part.maxMarks}</td>
                      <td className="px-3 py-2 text-xs text-da-muted">
                        {anchor ? (
                          <span className="text-green-300">Page {anchor.page_index + 1}</span>
                        ) : (
                          <span>Not placed</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => openEditor(part)}
                          disabled={busy || layout.anchors_locked}
                          className="rounded border border-da-border px-2 py-1 text-xs text-da-text hover:border-blue-400 hover:bg-blue-500/20 disabled:opacity-40"
                        >
                          {anchor ? "Redraw" : "Draw region"}
                        </button>
                        {anchor && (
                          <button
                            type="button"
                            onClick={() => clearRegion(part)}
                            disabled={busy || layout.anchors_locked}
                            className="ml-2 rounded border border-da-border px-2 py-1 text-xs text-da-muted hover:border-red-400 hover:text-red-300 disabled:opacity-40"
                          >
                            Clear
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </>
      )}

      {editing && layout && (
        <EvidenceBoxEditor
          title={editing.part.label}
          imageSrc={editing.imageSrc}
          page={editing.page}
          pageCount={layout.page_count}
          loading={editorLoading}
          saving={editorSaving}
          error={editorError}
          onPageChange={(page) => {
            setEditing((prev) => (prev ? { ...prev, page, imageSrc: null } : prev));
            void loadEditorPage(editing.part, page);
          }}
          onSave={saveRegion}
          onClose={() => {
            setEditing(null);
            setEditorError(null);
          }}
        />
      )}
    </div>
  );
}
