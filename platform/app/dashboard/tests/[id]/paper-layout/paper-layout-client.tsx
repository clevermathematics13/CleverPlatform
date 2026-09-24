"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  /** 'manual_draw' (a teacher's drag), 'generated' (read out of a generated paper), 'marker_consensus' (proposed from the class's marker boxes). */
  source: string;
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

/** One student's newest complete run, as the class re-cut walks them. */
interface LatestRun {
  id: string;
  studentId: string | null;
  created_at: string;
}

/** The natural key a region is stored under -- see test_item_anchors. */
const partKey = (questionNumber: number, partLabel: string | null) =>
  `${questionNumber}|${partLabel ?? ""}`;

/** How a region's provenance is badged: what it means, and how far to trust it. */
const SOURCE_BADGE: Record<string, { label: string; className: string; title: string }> = {
  manual_draw: {
    label: "Drawn",
    className: "border-green-400/40 bg-green-500/15 text-green-300",
    title: "You drew this region by hand.",
  },
  generated: {
    label: "Generated",
    className: "border-blue-400/40 bg-blue-500/15 text-blue-300",
    title: "Read out of the generated paper's own answer boxes -- a measurement, not an estimate.",
  },
  marker_consensus: {
    label: "Proposed",
    className: "border-amber-400/40 bg-amber-500/15 text-amber-300",
    title:
      "Estimated from where the marker found this part on the class's scans. Check it against the page before locking; redraw it if it is off.",
  },
};

export function PaperLayoutClient({ testId }: { testId: string }) {
  const [layout, setLayout] = useState<Layout | null>(null);
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  const [candidates, setCandidates] = useState<ReferenceCandidate[]>([]);
  const [latestRuns, setLatestRuns] = useState<LatestRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  /** What the last proposal or class re-cut wants a teacher to look at. */
  const [notes, setNotes] = useState<string[]>([]);

  // The part whose region is being drawn, if any.
  const [editing, setEditing] = useState<{ part: Part; page: number; imageSrc: string | null } | null>(null);
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  // The class re-cut, one student at a time; the ref is read between students
  // so a stop takes effect before the next request, never mid-request.
  const [recutting, setRecutting] = useState(false);
  const stopRequestedRef = useRef(false);

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
    setLatestRuns((data.latestRuns as LatestRun[]) ?? []);
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
  const proposedCount = anchors.filter((a) => a.source === "marker_consensus").length;

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
      setStatus(
        `Reference paper set — ${data.pageCount} pages. Draw a region for each part below, or propose them from the class's marker boxes.`
      );
      setNotes([]);
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
      setStatus(
        locked
          ? "Layout locked. New marking runs cut their crops from it; re-cut the students already marked below."
          : "Layout unlocked for editing."
      );
      await load();
    } finally {
      setBusy(false);
    }
  };

  /**
   * Fill the layout from the class's marker boxes. The route keeps any region
   * drawn by hand and replaces only its own earlier proposals, and the layout
   * stays unlocked: nothing cuts a crop from a proposal until it is locked.
   */
  const proposeRegions = async () => {
    setBusy(true);
    setError(null);
    setNotes([]);
    setStatus("Proposing regions from the class's marker boxes…");
    try {
      const { ok, data } = await fetchJson(`/api/tests/${testId}/paper-layout/propose`, { method: "POST" });
      if (!ok) {
        setError((data.error as string) ?? "Could not propose regions.");
        setStatus(null);
        return;
      }
      const proposed = Number(data.proposed ?? 0);
      const kept = Number(data.kept ?? 0);
      const students = Number(data.students ?? 0);
      setStatus(
        `${proposed} region(s) proposed from ${students} student(s)' scans${kept > 0 ? `, ${kept} drawn region(s) kept` : ""}. ` +
          "Open a part to see its region on the page; redraw any that are off, then lock the layout."
      );
      setNotes(Array.isArray(data.warnings) ? (data.warnings as string[]) : []);
      await load();
    } finally {
      setBusy(false);
    }
  };

  /**
   * Re-cut every student's newest run from the locked layout, one request per
   * student. Sequential and client-driven, like batch marking: a class is
   * minutes of crop-service time, more than one serverless call may spend.
   */
  const recutClass = async () => {
    if (latestRuns.length === 0) return;
    setRecutting(true);
    stopRequestedRef.current = false;
    setError(null);
    setNotes([]);
    let recut = 0;
    let unchanged = 0;
    let failed = 0;
    let done = 0;
    const collected: string[] = [];
    try {
      for (const run of latestRuns) {
        if (stopRequestedRef.current) break;
        setStatus(`Re-cutting student ${done + 1} of ${latestRuns.length}…`);
        try {
          const { ok, data } = await fetchJson(`/api/tests/${testId}/ai-grade/recut-crops`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ runId: run.id }),
          });
          if (!ok) {
            failed++;
            collected.push(`Run of ${new Date(run.created_at).toLocaleString()}: ${(data.error as string) ?? "failed"}`);
          } else {
            recut += Number(data.recut ?? 0);
            unchanged += Number(data.unchanged ?? 0);
            if (data.error) failed++;
            for (const w of Array.isArray(data.warnings) ? (data.warnings as string[]) : []) {
              collected.push(`Run of ${new Date(run.created_at).toLocaleString()}: ${w}`);
            }
          }
        } catch (e) {
          failed++;
          collected.push(`Run of ${new Date(run.created_at).toLocaleString()}: ${e instanceof Error ? e.message : "failed"}`);
        }
        done++;
      }
      const stopped = done < latestRuns.length;
      setStatus(
        `${stopped ? `Stopped after ${done} of ${latestRuns.length} student(s). ` : `Re-cut ${done} student(s). `}` +
          `${recut} crop(s) re-cut, ${unchanged} already right${failed > 0 ? `, ${failed} problem(s) below` : ""}. The marks are unchanged.`
      );
      setNotes(collected);
    } finally {
      setRecutting(false);
      stopRequestedRef.current = false;
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

  const disabled = busy || recutting;

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded border border-red-400/40 bg-red-500/15 px-3 py-2 text-sm text-red-300" role="alert">
          {error}
        </p>
      )}
      {status && <p className="text-sm text-green-300">{status}</p>}
      {notes.length > 0 && (
        <ul className="space-y-1 rounded border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}

      <p className="rounded border border-da-border bg-da-surface px-3 py-2 text-xs text-da-muted">
        Regions are used for marking runs once the layout is <strong className="text-da-text">locked</strong>
        {" "}— a draft is ignored, so you can draw at your own pace. Any part without a
        region falls back to the marker locating it itself, as it does today.
        Regions can also be <strong className="text-da-text">proposed</strong> from where the
        marker found each part on the class&apos;s scans; a proposal is an estimate to check
        against the page, not a measurement, so look before you lock.
        Nothing on this page changes a mark: crops are cut after marking is
        finished and are never fed back into it.
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
                    disabled={disabled}
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
              {proposedCount > 0 && (
                <>
                  {" "}· <span className="text-amber-300">{proposedCount} proposed</span>
                </>
              )}
            </span>
            {layout.anchors_locked ? (
              <span className="rounded border border-green-400/40 bg-green-500/15 px-2 py-0.5 text-green-300">
                Locked
              </span>
            ) : (
              <span className="rounded border border-da-border px-2 py-0.5 text-da-muted">Draft</span>
            )}
            <span className="ml-auto flex flex-wrap items-center gap-2">
              {!layout.anchors_locked && (
                <button
                  type="button"
                  onClick={proposeRegions}
                  disabled={disabled || latestRuns.length === 0}
                  title={
                    latestRuns.length === 0
                      ? "Mark at least one student first: the proposal comes from where the marker found each part."
                      : `Estimate a region for every part from where the marker found it on ${latestRuns.length} student(s)' scans. Regions you drew by hand are kept.`
                  }
                  className="rounded border border-amber-400/40 px-3 py-1 text-amber-300 hover:bg-amber-500/15 disabled:opacity-50"
                >
                  {busy ? "Working…" : "Propose regions from the class's marker boxes"}
                </button>
              )}
              {layout.anchors_locked && placed > 0 && !recutting && (
                <button
                  type="button"
                  onClick={recutClass}
                  disabled={disabled || latestRuns.length === 0}
                  title={`Re-cut each of the ${latestRuns.length} marked student(s)' crops from this layout, one student at a time. Crops already right are left alone. No mark changes.`}
                  className="rounded border border-blue-400/40 px-3 py-1 text-blue-300 hover:bg-blue-500/15 disabled:opacity-50"
                >
                  Re-cut every student&apos;s crops from this layout
                </button>
              )}
              {recutting && (
                <button
                  type="button"
                  onClick={() => {
                    stopRequestedRef.current = true;
                  }}
                  className="rounded border border-da-border px-3 py-1 text-da-text hover:bg-da-hover"
                >
                  Stop after this student
                </button>
              )}
              <button
                type="button"
                onClick={() => setLocked(!layout.anchors_locked)}
                disabled={disabled}
                className="rounded border border-da-border px-3 py-1 text-da-text hover:bg-da-hover disabled:opacity-50"
              >
                {layout.anchors_locked ? "Unlock to edit" : "Lock layout"}
              </button>
            </span>
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
                  const badge = anchor ? SOURCE_BADGE[anchor.source] : undefined;
                  return (
                    <tr key={part.testItemId} className="border-t border-da-border">
                      <td className="px-3 py-2 font-medium text-da-text">{part.label}</td>
                      <td className="px-3 py-2 text-da-muted">{part.maxMarks}</td>
                      <td className="px-3 py-2 text-xs text-da-muted">
                        {anchor ? (
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-green-300">Page {anchor.page_index + 1}</span>
                            {badge && (
                              <span
                                title={badge.title}
                                className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${badge.className}`}
                              >
                                {badge.label}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span>Not placed</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => openEditor(part)}
                          disabled={disabled || layout.anchors_locked}
                          className="rounded border border-da-border px-2 py-1 text-xs text-da-text hover:border-blue-400 hover:bg-blue-500/20 disabled:opacity-40"
                        >
                          {anchor ? "Redraw" : "Draw region"}
                        </button>
                        {anchor && (
                          <button
                            type="button"
                            onClick={() => clearRegion(part)}
                            disabled={disabled || layout.anchors_locked}
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
