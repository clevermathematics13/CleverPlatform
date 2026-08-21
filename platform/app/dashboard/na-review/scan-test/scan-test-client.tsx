"use client";

import { useRef, useState } from "react";
import type { ChangeEvent } from "react";

type Confidence = "high" | "medium" | "low";

interface RosterEntry {
  id: string;
  fullName: string;
}

interface PacketVersionOption {
  id: string;
  versionLabel: string;
  pageCount: number | null;
  anchorsLocked: boolean;
  title: string | null;
  courseId: string | null;
  roster: RosterEntry[];
}

interface ProposedSegment {
  label: string;
  pages: number[];
  confidence: Confidence;
  note: string;
  matchedInvitedId: string | null;
  matchedStudentName: string | null;
  matchedProfileId: string | null;
}

interface ReviewRow {
  key: string;
  label: string;
  pages: number[];
  confidence: Confidence;
  note: string;
  invitedId: string; // "" until picked
}

const CONFIDENCE_STYLE: Record<Confidence, string> = {
  high: "bg-green-100 text-green-800 border-green-300",
  medium: "bg-amber-100 text-amber-800 border-amber-300",
  low: "bg-red-100 text-red-800 border-red-300",
};

function parsePageList(text: string): number[] {
  const pages = new Set<number>();
  for (const part of text.split(",").map((p) => p.trim()).filter(Boolean)) {
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const [a, b] = [parseInt(range[1], 10), parseInt(range[2], 10)];
      for (let p = Math.min(a, b); p <= Math.max(a, b); p++) pages.add(p);
    } else if (/^\d+$/.test(part)) {
      pages.add(parseInt(part, 10));
    }
  }
  return [...pages].sort((a, b) => a - b);
}

function formatPageList(pages: number[]): string {
  if (pages.length === 0) return "";
  const sorted = [...pages].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const cur = sorted[i];
    if (cur === prev + 1) {
      prev = cur;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    if (cur !== undefined) {
      start = cur;
      prev = cur;
    }
  }
  return parts.join(", ");
}

export function ScanTestClient({ versions }: { versions: PacketVersionOption[] }) {
  const [versionId, setVersionId] = useState(versions[0]?.id ?? "");
  const version = versions.find((v) => v.id === versionId) ?? null;

  const [error, setError] = useState<string | null>(null);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  const [batchId, setBatchId] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [unassignedPages, setUnassignedPages] = useState<number[]>([]);
  const [rawStage1, setRawStage1] = useState<unknown>(null);

  const [splitting, setSplitting] = useState(false);
  const [rawStage2, setRawStage2] = useState<unknown>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const claimedPages = new Set(rows.flatMap((r) => r.pages));
  const allPages = pageCount ? Array.from({ length: pageCount }, (_, i) => i + 1) : [];
  const unclaimedPages = allPages.filter((p) => !claimedPages.has(p));

  const rowsWithConflicts = (() => {
    const owners = new Map<number, string[]>();
    for (const r of rows) for (const p of r.pages) owners.set(p, [...(owners.get(p) ?? []), r.key]);
    const conflicted = new Set<string>();
    for (const [, keys] of owners) if (keys.length > 1) for (const k of keys) conflicted.add(k);
    return conflicted;
  })();

  const reset = () => {
    setBatchId(null);
    setPageCount(null);
    setRows([]);
    setUnassignedPages([]);
    setRawStage1(null);
    setRawStage2(null);
    setStatusLine(null);
    setError(null);
  };

  const handleUpload = async (file: File) => {
    if (!version) {
      setError("Pick a packet version first.");
      return;
    }
    setUploading(true);
    setError(null);
    reset();

    try {
      setUploadProgress("Uploading scan to storage…");
      const supaModule = await import("@/lib/supabase/client");
      const supabase = supaModule.createClient();

      const safeName = file.name.replace(/[^\w.\-]/g, "_");
      const storagePath = `na-batches/${crypto.randomUUID()}/${safeName}`;

      const { error: uploadErr } = await supabase.storage
        .from("exam-scans")
        .upload(storagePath, file, { contentType: "application/pdf", upsert: false });
      if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);

      setUploadProgress("Reading cover pages and matching against the roster — can take a minute…");
      const res = await fetch("/api/na-review/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packetVersionId: version.id, storagePath, fileName: file.name }),
      });
      const data = await res.json();
      setRawStage1(data);
      if (!res.ok) throw new Error(data.error ?? "Segmentation failed.");

      const segments: ProposedSegment[] = data.segments ?? [];
      setBatchId(data.batchId);
      setPageCount(data.pageCount);
      setUnassignedPages(data.unassignedPages ?? []);
      setRows(
        segments.map((s, i) => ({
          key: `${i}-${s.label}`,
          label: s.label,
          pages: s.pages,
          confidence: s.confidence,
          note: s.note,
          invitedId: s.matchedInvitedId ?? "",
        }))
      );
      setStatusLine(
        `Stage 1 done. Found ${segments.length} student(s) across ${data.pageCount} pages, roster size ${data.rosterSize}. Review before splitting.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload or segmentation failed.");
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const handleFilePicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (file) await handleUpload(file);
  };

  const updateRow = (key: string, patch: Partial<ReviewRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeRow = (key: string) => setRows((prev) => prev.filter((r) => r.key !== key));
  const addRow = () =>
    setRows((prev) => [
      ...prev,
      { key: `manual-${Date.now()}`, label: "New student", pages: [], confidence: "low", note: "Added manually", invitedId: "" },
    ]);

  const canSplit =
    !!batchId &&
    rows.length > 0 &&
    rows.every((r) => r.invitedId && r.pages.length > 0) &&
    rowsWithConflicts.size === 0 &&
    new Set(rows.map((r) => r.invitedId)).size === rows.length &&
    !rawStage2;

  const handleSplit = async () => {
    if (!batchId || !canSplit) return;
    setSplitting(true);
    setError(null);
    setStatusLine("Splitting the batch PDF and creating na_packet_scans rows…");
    try {
      const res = await fetch(`/api/na-review/batch/${batchId}/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segments: rows.map((r) => ({ label: r.label, pages: r.pages, invitedId: r.invitedId })),
        }),
      });
      const data = await res.json();
      setRawStage2(data);
      if (!res.ok) throw new Error(data.error ?? "Split failed.");
      setStatusLine(
        `Stage 2 done. ${data.splitCount} split, ${data.failedCount} failed. Verify na_packet_scans and Storage directly — see the raw response below.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Split failed.");
    } finally {
      setSplitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <input ref={fileInputRef} type="file" accept="application/pdf" onChange={handleFilePicked} className="hidden" />

      <section className="rounded-xl border border-da-border bg-da-surface p-5">
        <label className="block text-sm font-medium text-da-text">Packet version</label>
        <select
          value={versionId}
          onChange={(e) => {
            setVersionId(e.target.value);
            reset();
          }}
          className="mt-1 w-full rounded border border-da-border bg-white px-3 py-2 text-sm text-gray-900"
        >
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              {v.title ?? v.versionLabel} — {v.pageCount ?? "?"} pages
              {v.anchorsLocked ? "" : " (anchors NOT locked)"} — roster: {v.roster.length}
            </option>
          ))}
        </select>
        {version && !version.courseId && (
          <p className="mt-2 text-xs text-red-600">
            This packet version has no linked course — roster matching will find nothing.
          </p>
        )}
        {version && version.courseId && version.roster.length === 0 && (
          <p className="mt-2 text-xs text-amber-600">
            This course has no invited students yet — every segment will come back unmatched.
          </p>
        )}
      </section>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {statusLine && (
        <div className="rounded-lg border border-blue-300 bg-blue-50 px-4 py-3 text-sm text-blue-800">{statusLine}</div>
      )}

      {!batchId && (
        <section className="rounded-xl border border-da-border bg-da-surface p-5">
          <h2 className="text-lg font-bold text-da-text">Upload a batch scan</h2>
          <p className="mt-1 text-sm text-da-muted">
            One PDF covering multiple students of this packet, each starting with a page showing
            their name.
          </p>
          <button
            type="button"
            disabled={uploading || !version}
            onClick={() => fileInputRef.current?.click()}
            className="mt-4 rounded-lg border border-da-accent/40 bg-da-accent/10 px-4 py-2 text-sm font-medium text-da-accent hover:bg-da-accent/20 disabled:opacity-50"
          >
            {uploading ? uploadProgress ?? "Working…" : "Upload batch scan"}
          </button>
        </section>
      )}

      {batchId && (
        <section className="rounded-xl border border-da-border bg-da-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-da-border px-5 py-3">
            <div>
              <h2 className="text-lg font-bold text-da-text">
                Batch {batchId.slice(0, 8)}… — {pageCount} pages
              </h2>
              <p className="text-xs text-da-muted">
                Every row needs a matched student before splitting. Fix anything wrong, then split.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={reset} className="rounded border border-da-border px-3 py-1 text-xs text-da-muted hover:bg-da-hover">
                Start over
              </button>
              <button
                type="button"
                onClick={handleSplit}
                disabled={!canSplit || splitting}
                className="rounded-lg bg-da-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {splitting ? "Splitting…" : `Confirm & split ${rows.length} student(s)`}
              </button>
            </div>
          </div>

          {unclaimedPages.length > 0 && !rawStage2 && (
            <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-xs text-amber-800">
              ⚠ Page(s) {formatPageList(unclaimedPages)} aren&apos;t assigned to any row.
            </div>
          )}
          {rowsWithConflicts.size > 0 && !rawStage2 && (
            <div className="border-b border-red-200 bg-red-50 px-5 py-2 text-xs text-red-700">
              ⚠ Some pages are claimed by more than one row.
            </div>
          )}
          {unassignedPages.length > 0 && (
            <div className="border-b border-da-border px-5 py-2 text-xs text-da-muted">
              Model reported unassigned pages: {formatPageList(unassignedPages)}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-da-border text-left text-xs uppercase tracking-wide text-da-muted">
                  <th className="px-4 py-2 font-semibold">Name on cover page</th>
                  <th className="px-2 py-2 font-semibold">Pages</th>
                  <th className="px-2 py-2 font-semibold">Matched student (invited)</th>
                  <th className="px-2 py-2 font-semibold">Confidence</th>
                  <th className="px-2 py-2 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const conflicted = rowsWithConflicts.has(r.key);
                  return (
                    <tr key={r.key} className="border-b border-da-border/60">
                      <td className="px-4 py-2">
                        <input
                          value={r.label}
                          onChange={(e) => updateRow(r.key, { label: e.target.value })}
                          disabled={!!rawStage2}
                          className="w-40 rounded border border-da-border bg-white px-2 py-1 text-sm text-gray-900 disabled:bg-gray-50"
                        />
                        {r.note && <p className="mt-0.5 text-xs text-da-muted">{r.note}</p>}
                      </td>
                      <td className="px-2 py-2">
                        <input
                          value={formatPageList(r.pages)}
                          onChange={(e) => updateRow(r.key, { pages: parsePageList(e.target.value) })}
                          disabled={!!rawStage2}
                          placeholder="e.g. 1-8"
                          className={`w-28 rounded border bg-white px-2 py-1 text-sm text-gray-900 disabled:bg-gray-50 ${
                            conflicted ? "border-red-400" : "border-da-border"
                          }`}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <select
                          value={r.invitedId}
                          onChange={(e) => updateRow(r.key, { invitedId: e.target.value })}
                          disabled={!!rawStage2}
                          className="rounded border border-da-border bg-white px-2 py-1 text-sm text-gray-900 disabled:bg-gray-50"
                        >
                          <option value="">— pick a student —</option>
                          {version?.roster.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.fullName}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        <span className={`rounded border px-2 py-0.5 text-xs font-medium ${CONFIDENCE_STYLE[r.confidence]}`}>
                          {r.confidence}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        {!rawStage2 && (
                          <button type="button" onClick={() => removeRow(r.key)} className="text-xs text-red-400 hover:text-red-600">
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!rawStage2 && (
            <div className="border-t border-da-border px-5 py-3">
              <button type="button" onClick={addRow} className="text-sm text-da-accent hover:underline">
                + Add a student row (for a page the model missed)
              </button>
            </div>
          )}
        </section>
      )}

      {rawStage1 !== null && (
        <details className="rounded-xl border border-da-border bg-da-surface p-4">
          <summary className="cursor-pointer text-sm font-medium text-da-text">Raw stage 1 response (segmentation)</summary>
          <pre className="mt-3 overflow-x-auto rounded bg-black/80 p-3 text-xs text-green-300">
            {JSON.stringify(rawStage1, null, 2)}
          </pre>
        </details>
      )}

      {rawStage2 !== null && (
        <details open className="rounded-xl border border-da-border bg-da-surface p-4">
          <summary className="cursor-pointer text-sm font-medium text-da-text">Raw stage 2 response (split)</summary>
          <pre className="mt-3 overflow-x-auto rounded bg-black/80 p-3 text-xs text-green-300">
            {JSON.stringify(rawStage2, null, 2)}
          </pre>
          <p className="mt-3 text-xs text-da-muted">
            Now verify directly: check <code>na_packet_scans</code> rows for this batch_id in
            Supabase, and confirm each student&apos;s split PDF exists in Storage under
            <code> exam-scans/na-scans/…</code> and actually contains their pages.
          </p>
        </details>
      )}
    </div>
  );
}
