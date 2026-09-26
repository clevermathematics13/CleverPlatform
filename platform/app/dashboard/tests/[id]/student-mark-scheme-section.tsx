"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The test page's "Student mark scheme" section: the written explanations
 * each part of the student mark scheme can lead with (the answer, how the
 * marks work, watch-out notes and the "Explain more" slides --
 * lib/mark-scheme-explanation.ts), and whether students can see them.
 *
 * Each part is one AI call through /api/tests/[id]/mark-scheme/explanations,
 * so the whole paper is written a few parts at a time, with progress, and a
 * part that fails is shown with its reasons and can be tried again alone.
 * A part's explanation is shown to students only while it matches the
 * part's current answer and scheme; one written before an edit is listed
 * as out of date and students see the teacher's own text for it until it
 * is rewritten.
 */

type PartState = "current" | "outdated" | "missing";

interface PartStatus {
  key: string;
  label: string;
  maxMarks: number;
  explainable: boolean;
  state: PartState;
  updatedAt: string | null;
}

interface Status {
  tableReady: boolean;
  released: boolean;
  markSchemeReleased: boolean;
  hidden: boolean;
  pagePath: string;
  parts: PartStatus[];
}

/** Parts written at once. Each is a long model call; three keeps a
 *  36-part paper to a few minutes without leaning on the rate limit. */
const CONCURRENCY = 3;

const hint = "text-xs text-da-muted";

const STATE_CHIP: Record<PartState, { text: string; className: string }> = {
  current: { text: "Ready", className: "border-green-500/50 bg-green-500/10 text-green-300" },
  outdated: { text: "Out of date", className: "border-amber-400/50 bg-amber-500/10 text-amber-200" },
  missing: { text: "Not written", className: "border-da-border bg-da-bg text-da-muted" },
};

export function StudentMarkSchemeSection({
  testId,
  releaseKey,
  onReleasePlatformScheme,
}: {
  testId: string;
  /** The saved mark_scheme_url and hidden flag: when a save changes either,
   *  the release line above is read again. */
  releaseKey: string;
  /** Puts the platform's page into the form's Mark scheme URL field; the
   *  page's own Save button then releases it. */
  onReleasePlatformScheme: () => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [working, setWorking] = useState<ReadonlySet<string>>(() => new Set());
  const [failures, setFailures] = useState<Record<string, { error: string; problems: string[] }>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const stopRequested = useRef(false);

  const endpoint = `/api/tests/${testId}/mark-scheme/explanations`;

  const load = useCallback(async () => {
    try {
      const res = await fetch(endpoint, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setStatus(body as Status);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [endpoint]);

  useEffect(() => {
    void load();
  }, [load, releaseKey]);

  const updatePart = (part: PartStatus) =>
    setStatus((s) => (s ? { ...s, parts: s.parts.map((p) => (p.key === part.key ? part : p)) } : s));

  const setBusy = (key: string, busy: boolean) =>
    setWorking((w) => {
      const next = new Set(w);
      if (busy) next.add(key);
      else next.delete(key);
      return next;
    });

  const writePart = async (key: string) => {
    setBusy(key, true);
    setFailures((f) => {
      const next = { ...f };
      delete next[key];
      return next;
    });
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      if (!res.ok) {
        setFailures((f) => ({ ...f, [key]: { error: body.error ?? `HTTP ${res.status}`, problems: body.problems ?? [] } }));
        return;
      }
      updatePart(body.part as PartStatus);
    } catch (e) {
      setFailures((f) => ({ ...f, [key]: { error: e instanceof Error ? e.message : String(e), problems: [] } }));
    } finally {
      setBusy(key, false);
    }
  };

  const writeMany = async (keys: string[]) => {
    if (keys.length === 0) return;
    stopRequested.current = false;
    setProgress({ done: 0, total: keys.length });
    const queue = [...keys];
    const worker = async () => {
      while (queue.length > 0 && !stopRequested.current) {
        const key = queue.shift()!;
        await writePart(key);
        setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, keys.length) }, worker));
    setProgress(null);
  };

  const removePart = async (key: string) => {
    if (!window.confirm("Remove this explanation? Students will see your own mark scheme text for this part.")) return;
    setBusy(key, true);
    try {
      const res = await fetch(endpoint, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setStatus((s) =>
        s ? { ...s, parts: s.parts.map((p) => (p.key === key ? { ...p, state: "missing", updatedAt: null } : p)) } : s,
      );
    } catch (e) {
      setFailures((f) => ({ ...f, [key]: { error: e instanceof Error ? e.message : String(e), problems: [] } }));
    } finally {
      setBusy(key, false);
    }
  };

  if (loadError) {
    return (
      <section className="space-y-2 rounded-xl border border-da-border bg-da-surface p-5 shadow-sm">
        <h2 className="font-bold text-da-text">Student mark scheme</h2>
        <p className="text-sm text-red-300">Could not load the explanations: {loadError}</p>
      </section>
    );
  }
  if (!status) {
    return (
      <section className="rounded-xl border border-da-border bg-da-surface p-5 shadow-sm">
        <h2 className="font-bold text-da-text">Student mark scheme</h2>
        <p className={`${hint} mt-2`}>Loading…</p>
      </section>
    );
  }

  const explainable = status.parts.filter((p) => p.explainable);
  // An IB-bank paper keeps its scheme in the question bank, not on the
  // test, and the student mark scheme is not built for it.
  if (explainable.length === 0) return null;

  const counts = {
    current: explainable.filter((p) => p.state === "current").length,
    outdated: explainable.filter((p) => p.state === "outdated").length,
    missing: explainable.filter((p) => p.state === "missing").length,
  };
  const toWrite = explainable.filter((p) => p.state !== "current").map((p) => p.key);
  const busy = progress !== null || working.size > 0;
  const failed = Object.keys(failures).length;

  return (
    <section className="space-y-4 rounded-xl border border-da-border bg-da-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-bold text-da-text">Student mark scheme</h2>
        <a
          href={status.pagePath}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-semibold text-da-accent hover:underline"
        >
          Open it as a student sees it ↗
        </a>
      </div>

      <p className={hint}>
        Students read each part of the mark scheme beside their self-grade box. An explanation makes that part
        lead with a plain answer, then how the marks work and a few watch-out notes, with an &ldquo;Explain
        more&rdquo; slideshow of worked steps and diagrams they can open. They are written by AI from your own
        answer and mark scheme (never the marking notes) and checked before they are saved: the marks must add
        up to the part, and every formula must typeset. A part&apos;s explanation is shown only while it matches
        your current mark scheme -- edit a part and students see your own text for it until it is rewritten.
      </p>

      {status.released ? (
        <p className="rounded-lg border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-200">
          Released: students see this mark scheme once their class has sat the test.
        </p>
      ) : (
        <div className="space-y-2 rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          <p>
            {status.markSchemeReleased
              ? "Not visible to students yet: this test is hidden from their reflection page."
              : "Not released: students see the platform's mark scheme only when the Mark scheme URL above is set to it."}
          </p>
          {!status.markSchemeReleased && (
            <button
              type="button"
              onClick={onReleasePlatformScheme}
              className="rounded-lg border border-amber-300/60 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-500/20"
            >
              Use the platform&apos;s mark scheme (then Save changes)
            </button>
          )}
        </div>
      )}

      {!status.tableReady && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          The database has no mark_scheme_explanations table yet, so nothing can be saved. Apply the migration
          that creates it first (platform/supabase/migrations).
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-da-text">
          {counts.current} of {explainable.length} parts ready
        </span>
        {counts.outdated > 0 && <span className="text-amber-200">· {counts.outdated} out of date</span>}
        {counts.missing > 0 && <span className="text-da-muted">· {counts.missing} not written</span>}
        {failed > 0 && <span className="text-red-300">· {failed} failed</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || toWrite.length === 0 || !status.tableReady}
          onClick={() => void writeMany(toWrite)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-da-bg disabled:text-da-muted"
        >
          {toWrite.length === 0
            ? "Every part is written"
            : `Write ${toWrite.length} explanation${toWrite.length === 1 ? "" : "s"}`}
        </button>
        <button
          type="button"
          disabled={busy || counts.current === 0 || !status.tableReady}
          onClick={() => {
            if (window.confirm(`Rewrite all ${explainable.length} explanations from scratch?`)) {
              void writeMany(explainable.map((p) => p.key));
            }
          }}
          className="rounded-lg border border-da-border px-3 py-2 text-sm font-semibold text-da-text transition-colors hover:bg-da-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          Rewrite all
        </button>
        {progress && (
          <>
            <span role="status" className="text-sm text-da-muted">
              Writing… {progress.done} of {progress.total} done
            </span>
            <button
              type="button"
              onClick={() => {
                stopRequested.current = true;
              }}
              className="rounded-lg border border-da-border px-3 py-1.5 text-xs font-semibold text-da-muted hover:bg-da-hover"
            >
              Stop after these
            </button>
          </>
        )}
      </div>
      {progress && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-da-bg" aria-hidden="true">
          <div className="h-full bg-blue-500 transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
        </div>
      )}

      <details className="rounded-lg border border-da-border/60 bg-da-bg/40 p-3" open={failed > 0}>
        <summary className="cursor-pointer text-sm font-semibold text-da-text">Each part</summary>
        <ul className="mt-2 divide-y divide-da-border/40">
          {status.parts.map((part) => {
            const chip = STATE_CHIP[part.state];
            const failure = failures[part.key];
            const partBusy = working.has(part.key);
            return (
              <li key={part.key} className="space-y-1 py-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="w-16 font-semibold text-da-text">{part.label}</span>
                  <span className="text-xs text-da-muted">
                    {part.maxMarks} mark{part.maxMarks === 1 ? "" : "s"}
                  </span>
                  {part.explainable ? (
                    <span className={`rounded border px-1.5 py-0.5 text-xs ${chip.className}`}>{chip.text}</span>
                  ) : (
                    <span className="text-xs text-da-muted">no answer or scheme to explain</span>
                  )}
                  {part.updatedAt && part.state !== "missing" && (
                    <span className={hint}>{new Date(part.updatedAt).toLocaleString()}</span>
                  )}
                  {part.explainable && (
                    <span className="ml-auto flex gap-2">
                      <button
                        type="button"
                        disabled={partBusy || progress !== null || !status.tableReady}
                        onClick={() => void writePart(part.key)}
                        className="rounded border border-da-border px-2 py-1 text-xs font-semibold text-da-text hover:bg-da-hover disabled:opacity-50"
                      >
                        {partBusy ? "Writing…" : part.state === "missing" ? "Write" : "Rewrite"}
                      </button>
                      {part.state !== "missing" && (
                        <button
                          type="button"
                          disabled={partBusy || progress !== null}
                          onClick={() => void removePart(part.key)}
                          className="rounded border border-da-border px-2 py-1 text-xs text-da-muted hover:bg-da-hover disabled:opacity-50"
                        >
                          Remove
                        </button>
                      )}
                    </span>
                  )}
                </div>
                {failure && (
                  <div className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-xs text-red-200">
                    <p>{failure.error}</p>
                    {failure.problems.length > 0 && (
                      <ul className="mt-1 list-disc pl-4">
                        {failure.problems.slice(0, 8).map((p, i) => (
                          <li key={i}>{p}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </details>
    </section>
  );
}
