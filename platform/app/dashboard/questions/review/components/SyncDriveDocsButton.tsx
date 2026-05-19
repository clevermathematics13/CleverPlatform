"use client";

import { useEffect, useState } from "react";

export function SyncDriveDocsButton() {
  const [status, setStatus] = useState<"idle" | "dryrun" | "syncing" | "done" | "error">("idle");
  const [result, setResult] = useState<{ found: number; updated: number; updates: { code: string; google_doc_id?: string; google_ms_id?: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fixBusy, setFixBusy] = useState<false | "dryrun" | "apply">(false);
  const [fixError, setFixError] = useState<string | null>(null);
  const [fixResult, setFixResult] = useState<{
    dryRun: boolean;
    scannedRowsWithAnyId: number;
    issuesFound: number;
    wouldClearGoogleDocId?: number;
    wouldClearGoogleMsId?: number;
    wouldClearDocOnly?: number;
    wouldClearMsOnly?: number;
    wouldClearBoth?: number;
    updatedRows?: number;
    clearedGoogleDocId?: number;
    clearedGoogleMsId?: number;
    clearedDocOnly?: number;
    clearedMsOnly?: number;
    clearedBoth?: number;
    sample: {
      id: string;
      code: string;
      google_doc_id: string | null;
      google_ms_id: string | null;
      clearGoogleDocId?: boolean;
      clearGoogleMsId?: boolean;
      reasons?: string[];
    }[];
  } | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [force, setForce] = useState(false);
  const [debugCode, setDebugCode] = useState(() => {
    try { return sessionStorage.getItem("review-last-copied-code") || "12M.1.AHL.TZ1.H_5"; } catch { return "12M.1.AHL.TZ1.H_5"; }
  });

  useEffect(() => {
    if (!showConfig) return;
    try {
      const saved = sessionStorage.getItem("review-last-copied-code");
      if (saved) setDebugCode(saved);
    } catch {}
  }, [showConfig]);
  const [debugBusy, setDebugBusy] = useState(false);
  const [debugError, setDebugError] = useState<string | null>(null);
  const [singleSyncBusy, setSingleSyncBusy] = useState(false);
  const [singleSyncStatus, setSingleSyncStatus] = useState<string | null>(null);
  const [debugResult, setDebugResult] = useState<{
    code: string;
    db?: { id: string; code: string; google_doc_id?: string | null; google_ms_id?: string | null } | null;
    questionFolderCount: number;
    markschemeFolderCount: number;
    questionMatches: { id: string; name: string; webViewLink?: string; parents?: string[] }[];
    markschemeMatches: { id: string; name: string; webViewLink?: string; parents?: string[] }[];
  } | null>(null);

  async function run(dryRun: boolean) {
    setStatus(dryRun ? "dryrun" : "syncing");
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/sync-drive-docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun, force }),
      });
      const raw = await res.text();
      let data: { error?: string; found?: number; updated?: number; updates?: { code: string; google_doc_id?: string; google_ms_id?: string }[] } = {};
      if (raw.trim()) {
        try {
          data = JSON.parse(raw);
        } catch {
          setError(`Sync failed: non-JSON response (HTTP ${res.status})`);
          setStatus("error");
          return;
        }
      }
      if (!res.ok) {
        setError(data.error ?? `Sync failed (HTTP ${res.status})`);
        setStatus("error");
        return;
      }
      setResult({
        found: data.found ?? 0,
        updated: data.updated ?? 0,
        updates: data.updates ?? [],
      });
      setStatus("done");
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  }

  async function runSingleCodeDebug() {
    if (!debugCode.trim()) return;
    setDebugBusy(true);
    setDebugError(null);
    setDebugResult(null);

    try {
      const res = await fetch("/api/admin/debug-drive-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: debugCode.trim() }),
      });
      const raw = await res.text();
      let data: {
        error?: string;
        code?: string;
        db?: { id: string; code: string; google_doc_id?: string | null; google_ms_id?: string | null } | null;
        questionFolderCount?: number;
        markschemeFolderCount?: number;
        questionMatches?: { id: string; name: string; webViewLink?: string; parents?: string[] }[];
        markschemeMatches?: { id: string; name: string; webViewLink?: string; parents?: string[] }[];
      } = {};

      if (raw.trim()) {
        try {
          data = JSON.parse(raw);
        } catch {
          setDebugError(`Debug failed: non-JSON response (HTTP ${res.status})`);
          return;
        }
      }

      if (!res.ok) {
        setDebugError(data.error ?? `Debug failed (HTTP ${res.status})`);
        return;
      }

      setDebugResult({
        code: data.code ?? debugCode.trim(),
        db: data.db ?? null,
        questionFolderCount: data.questionFolderCount ?? 0,
        markschemeFolderCount: data.markschemeFolderCount ?? 0,
        questionMatches: data.questionMatches ?? [],
        markschemeMatches: data.markschemeMatches ?? [],
      });
    } catch (e) {
      setDebugError(String(e));
    } finally {
      setDebugBusy(false);
    }
  }

  async function runSingleCodeSync() {
    if (!debugCode.trim()) return;
    setSingleSyncBusy(true);
    setSingleSyncStatus(null);
    setDebugError(null);

    try {
      const res = await fetch("/api/admin/sync-drive-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: debugCode.trim(), force }),
      });
      const raw = await res.text();
      let data: {
        error?: string;
        updated?: Record<string, string>;
        message?: string;
      } = {};

      if (raw.trim()) {
        try {
          data = JSON.parse(raw);
        } catch {
          setSingleSyncStatus(`Single-code sync failed: non-JSON response (HTTP ${res.status})`);
          return;
        }
      }

      if (!res.ok) {
        setSingleSyncStatus(data.error ?? `Single-code sync failed (HTTP ${res.status})`);
        return;
      }

      if (data.message === "No updates needed") {
        setSingleSyncStatus("No updates needed for this code.");
      } else {
        const pieces: string[] = [];
        if (data.updated?.google_doc_id) pieces.push("Q linked");
        if (data.updated?.google_ms_id) pieces.push("MS linked");
        setSingleSyncStatus(pieces.length > 0 ? `Updated: ${pieces.join(", ")}` : "Synced.");
      }

      await runSingleCodeDebug();
    } catch (e) {
      setSingleSyncStatus(String(e));
    } finally {
      setSingleSyncBusy(false);
    }
  }

  async function runFixConflictedLinks(dryRun: boolean) {
    setFixBusy(dryRun ? "dryrun" : "apply");
    setFixError(null);
    setFixResult(null);

    try {
      const res = await fetch("/api/admin/fix-conflicted-doc-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun, limit: 100 }),
      });
      const raw = await res.text();
      let data: {
        error?: string;
        dryRun?: boolean;
        scannedRowsWithAnyId?: number;
        scannedWithBothIds?: number;
        issuesFound?: number;
        conflictedCount?: number;
        wouldClearGoogleDocId?: number;
        wouldClearGoogleMsId?: number;
        wouldClearDocOnly?: number;
        wouldClearMsOnly?: number;
        wouldClearBoth?: number;
        updatedRows?: number;
        updated?: number;
        clearedGoogleDocId?: number;
        clearedGoogleMsId?: number;
        clearedDocOnly?: number;
        clearedMsOnly?: number;
        clearedBoth?: number;
        sample?: {
          id: string;
          code: string;
          google_doc_id?: string | null;
          google_ms_id?: string | null;
          conflicted_doc_id?: string | null;
          clearGoogleDocId?: boolean;
          clearGoogleMsId?: boolean;
          reasons?: string[];
        }[];
      } = {};

      if (raw.trim()) {
        try {
          data = JSON.parse(raw);
        } catch {
          setFixError(`Fix conflicted links failed: non-JSON response (HTTP ${res.status})`);
          return;
        }
      }

      if (!res.ok) {
        setFixError(data.error ?? `Fix conflicted links failed (HTTP ${res.status})`);
        return;
      }

      setFixResult({
        dryRun: data.dryRun ?? dryRun,
        scannedRowsWithAnyId: data.scannedRowsWithAnyId ?? data.scannedWithBothIds ?? 0,
        issuesFound: data.issuesFound ?? data.conflictedCount ?? 0,
        wouldClearGoogleDocId: data.wouldClearGoogleDocId,
        wouldClearGoogleMsId: data.wouldClearGoogleMsId,
        wouldClearDocOnly: data.wouldClearDocOnly,
        wouldClearMsOnly: data.wouldClearMsOnly,
        wouldClearBoth: data.wouldClearBoth,
        updatedRows: data.updatedRows ?? data.updated,
        clearedGoogleDocId: data.clearedGoogleDocId,
        clearedGoogleMsId: data.clearedGoogleMsId,
        clearedDocOnly: data.clearedDocOnly,
        clearedMsOnly: data.clearedMsOnly,
        clearedBoth: data.clearedBoth,
        sample: (data.sample ?? []).map((row) => ({
          id: row.id,
          code: row.code,
          google_doc_id: row.google_doc_id ?? row.conflicted_doc_id ?? null,
          google_ms_id: row.google_ms_id ?? null,
          clearGoogleDocId: row.clearGoogleDocId,
          clearGoogleMsId: row.clearGoogleMsId,
          reasons: row.reasons,
        })),
      });
    } catch (e) {
      setFixError(String(e));
    } finally {
      setFixBusy(false);
    }
  }

  const busy = status === "dryrun" || status === "syncing";

  return (
    <div className="border border-blue-200 rounded-lg bg-blue-50/40 p-3 space-y-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-blue-800 text-xs">Sync Google Doc IDs from Drive</span>
        <button
          onClick={() => setShowConfig((v) => !v)}
          className="text-xs text-blue-500 hover:underline"
        >
          {showConfig ? "hide options" : "options"}
        </button>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => run(true)}
            disabled={busy}
            className="px-3 py-1 rounded bg-white border border-blue-300 text-blue-700 text-xs font-medium hover:bg-blue-50 disabled:opacity-40"
          >
            {status === "dryrun" ? "Scanning…" : "Dry run"}
          </button>
          <button
            onClick={() => run(false)}
            disabled={busy}
            className="px-3 py-1 rounded bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-40"
          >
            {status === "syncing" ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </div>

      {showConfig && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
            <input
              name="force-relink"
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
              className="rounded"
            />
            <span>Force re-link (overwrite existing Doc IDs — use to fix stale/deleted links)</span>
          </label>

          <div className="pt-1 border-t border-blue-100 space-y-1.5">
            <p className="text-xs text-amber-800 font-medium">Fix existing conflicted links (Q doc = MS doc):</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => runFixConflictedLinks(true)}
                disabled={busy || debugBusy || singleSyncBusy || !!fixBusy}
                className="px-3 py-1 rounded bg-white border border-amber-300 text-amber-800 text-xs font-medium hover:bg-amber-50 disabled:opacity-40"
              >
                {fixBusy === "dryrun" ? "Scanning…" : "Dry run fix"}
              </button>
              <button
                onClick={() => runFixConflictedLinks(false)}
                disabled={busy || debugBusy || singleSyncBusy || !!fixBusy}
                className="px-3 py-1 rounded bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 disabled:opacity-40"
              >
                {fixBusy === "apply" ? "Applying…" : "Apply fix"}
              </button>
            </div>
            {fixError && <p className="text-xs text-red-600 font-medium">⚠ {fixError}</p>}
            {fixResult && (
              <div className="text-xs text-amber-800 bg-white border border-amber-100 rounded p-2 space-y-1">
                <p>
                  Scanned <strong>{fixResult.scannedRowsWithAnyId}</strong> rows with any Drive ID; found <strong>{fixResult.issuesFound}</strong> issue(s).
                </p>
                <p>
                  {fixResult.dryRun
                    ? "Dry run only. No DB rows changed."
                    : `Updated ${fixResult.updatedRows ?? 0} row(s): cleared Q=${fixResult.clearedGoogleDocId ?? 0}, MS=${fixResult.clearedGoogleMsId ?? 0}.`}
                </p>
                {fixResult.dryRun && (fixResult.wouldClearGoogleDocId !== undefined || fixResult.wouldClearGoogleMsId !== undefined) && (
                  <p>
                    Would clear Q={fixResult.wouldClearGoogleDocId ?? 0}, MS={fixResult.wouldClearGoogleMsId ?? 0}.
                  </p>
                )}
                {fixResult.dryRun && (fixResult.wouldClearDocOnly !== undefined || fixResult.wouldClearMsOnly !== undefined || fixResult.wouldClearBoth !== undefined) && (
                  <p>
                    Breakdown: Q-only={fixResult.wouldClearDocOnly ?? 0}, MS-only={fixResult.wouldClearMsOnly ?? 0}, both={fixResult.wouldClearBoth ?? 0}.
                  </p>
                )}
                {!fixResult.dryRun && (fixResult.clearedDocOnly !== undefined || fixResult.clearedMsOnly !== undefined || fixResult.clearedBoth !== undefined) && (
                  <p>
                    Breakdown: Q-only={fixResult.clearedDocOnly ?? 0}, MS-only={fixResult.clearedMsOnly ?? 0}, both={fixResult.clearedBoth ?? 0}.
                  </p>
                )}
                {fixResult.sample.length > 0 && (
                  <div className="max-h-32 overflow-auto border border-amber-100 rounded">
                    <table className="w-full text-[11px] font-mono">
                      <thead className="bg-amber-50 text-amber-900 sticky top-0">
                        <tr>
                          <th className="text-left px-2 py-1">Code</th>
                          <th className="text-left px-2 py-1">Action</th>
                          <th className="text-left px-2 py-1">Reasons</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fixResult.sample.map((row) => (
                          <tr key={row.id} className="border-t border-amber-100">
                            <td className="px-2 py-1 whitespace-nowrap">{row.code}</td>
                            <td className="px-2 py-1 whitespace-nowrap">
                              {row.clearGoogleDocId && row.clearGoogleMsId
                                ? "Clear Q+MS"
                                : row.clearGoogleDocId
                                  ? "Clear Q"
                                  : row.clearGoogleMsId
                                    ? "Clear MS"
                                    : "-"}
                            </td>
                            <td className="px-2 py-1 text-[10px] text-amber-900/90">
                              {(row.reasons ?? []).join(", ") || "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="pt-1 border-t border-blue-100 space-y-1.5">
            <p className="text-xs text-blue-800 font-medium">Debug one code (no full scan):</p>
            <div className="flex items-center gap-2">
              <input
                name="debug-code"
                type="text"
                value={debugCode}
                onChange={(e) => setDebugCode(e.target.value)}
                className="flex-1 px-2 py-1 rounded border border-blue-200 text-xs font-mono bg-white"
                placeholder="e.g. 12M.1.AHL.TZ1.H_5"
              />
              <button
                onClick={runSingleCodeDebug}
                disabled={debugBusy || singleSyncBusy || !debugCode.trim()}
                className="px-3 py-1 rounded bg-white border border-blue-300 text-blue-700 text-xs font-medium hover:bg-blue-50 disabled:opacity-40"
              >
                {debugBusy ? "Debugging…" : "Debug code"}
              </button>
              <button
                onClick={runSingleCodeSync}
                disabled={singleSyncBusy || debugBusy || !debugCode.trim()}
                className="px-3 py-1 rounded bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-40"
              >
                {singleSyncBusy ? "Syncing…" : "Sync this code"}
              </button>
            </div>
            {debugError && <p className="text-xs text-red-600 font-medium">⚠ {debugError}</p>}
            {singleSyncStatus && <p className="text-xs text-blue-700 font-medium">{singleSyncStatus}</p>}
            {debugResult && (
              <div className="text-xs text-blue-700 bg-white border border-blue-100 rounded p-2 space-y-1.5">
                <p>
                  <span className="font-semibold">Code:</span> <span className="font-mono">{debugResult.code}</span>
                </p>
                <p>
                  <span className="font-semibold">DB:</span>{" "}
                  {debugResult.db
                    ? `google_doc_id=${debugResult.db.google_doc_id ?? "null"}, google_ms_id=${debugResult.db.google_ms_id ?? "null"}`
                    : "No ib_questions row found"}
                </p>
                <p>
                  Q folder tree ({debugResult.questionFolderCount} folders): <strong>{debugResult.questionMatches.length}</strong> match(es)
                </p>
                <p>
                  MS folder tree ({debugResult.markschemeFolderCount} folders): <strong>{debugResult.markschemeMatches.length}</strong> match(es)
                </p>

                {debugResult.questionMatches.length > 0 && (
                  <div>
                    <p className="font-semibold text-blue-800">Question doc matches:</p>
                    <ul className="max-h-28 overflow-auto font-mono border border-blue-100 rounded p-1 space-y-0.5">
                      {debugResult.questionMatches.map((m) => (
                        <li key={`q-${m.id}`}>
                          {m.webViewLink ? (
                            <a href={m.webViewLink} target="_blank" rel="noreferrer" className="underline text-blue-600">
                              {m.name}
                            </a>
                          ) : (
                            <span>{m.name}</span>
                          )}
                          <span className="text-gray-500 ml-2">{m.id}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {debugResult.markschemeMatches.length > 0 && (
                  <div>
                    <p className="font-semibold text-purple-800">Mark scheme doc matches:</p>
                    <ul className="max-h-28 overflow-auto font-mono border border-blue-100 rounded p-1 space-y-0.5">
                      {debugResult.markschemeMatches.map((m) => (
                        <li key={`ms-${m.id}`}>
                          {m.webViewLink ? (
                            <a href={m.webViewLink} target="_blank" rel="noreferrer" className="underline text-blue-600">
                              {m.name}
                            </a>
                          ) : (
                            <span>{m.name}</span>
                          )}
                          <span className="text-gray-500 ml-2">{m.id}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-600 font-medium">⚠ {error}</p>
      )}

      {result && (
        <div className="text-xs text-blue-700 space-y-1">
          <p>
            Found <strong>{result.found}</strong> docs to link
            {result.updated > 0 ? `, updated ${result.updated} questions` : result.found > 0 ? " (dry run — no changes written)" : ""}
            .
          </p>
          {result.found > 0 && (
            <button onClick={() => setShowDetails((v) => !v)} className="underline text-blue-500">
              {showDetails ? "Hide" : "Show"} details ({result.updates.length})
            </button>
          )}
          {showDetails && (
            <ul className="max-h-40 overflow-auto bg-white border border-blue-100 rounded p-2 space-y-0.5 font-mono">
              {result.updates.map((u) => (
                <li key={u.code}>
                  <span className="text-gray-700">{u.code}</span>
                  {u.google_doc_id && <span className="text-blue-600 ml-2">Q✓</span>}
                  {u.google_ms_id && <span className="text-purple-600 ml-1">MS✓</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
