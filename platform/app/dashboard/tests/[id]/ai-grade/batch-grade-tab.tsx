"use client";

import { useCallback, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { fetchJson } from "./fetch-json";

type Confidence = "high" | "medium" | "low";
type BatchStatus = "uploaded" | "segmenting" | "segmented" | "failed" | "split";

interface StudentOption {
  profile_id: string;
  display_name: string;
}

interface ProposedSegment {
  label: string;
  pages: number[];
  confidence: Confidence;
  note: string;
  matchedStudentId: string | null;
  matchedStudentName: string | null;
}

interface BatchRow {
  id: string;
  status: BatchStatus;
  file_name: string | null;
  page_count: number | null;
  proposed_segments: ProposedSegment[];
  confirmed_segments: { label: string; pages: number[]; matchedStudentId: string }[] | null;
  unassigned_pages: number[];
  /** Pages the model confidently identified as blank -- not shown as "needs review", unlike unassigned_pages. */
  blank_pages: number[];
  error: string | null;
  created_at: string;
}

interface SplitResultRow {
  studentId: string;
  label: string;
  runId: string | null;
  status: "complete" | "failed";
  error?: string;
  suggestedTotal?: number;
  maxTotal?: number;
  testTotalMarks?: number;
  partsGraded?: number;
}

const CONFIDENCE_STYLE: Record<Confidence, string> = {
  high: "bg-green-500/15 text-green-300 border-green-400/40",
  medium: "bg-amber-500/15 text-amber-300 border-amber-400/40",
  low: "bg-red-500/15 text-red-300 border-red-400/40",
};

/** Editable row shape for the review table — one per detected student. */
interface ReviewRow {
  key: string;
  label: string;
  pages: number[];
  confidence: Confidence;
  note: string;
  studentId: string; // "" until the teacher picks one
}

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

export function BatchGradeTab({
  testId,
  students,
}: {
  testId: string;
  students: StudentOption[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [statusLine, setStatusLine] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [batch, setBatch] = useState<BatchRow | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [splitting, setSplitting] = useState(false);
  const [splitResults, setSplitResults] = useState<SplitResultRow[] | null>(null);
  const [stopRequested, setStopRequested] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // A ref, not just the stopRequested state, so the running loop's closure
  // sees a stop the instant it's clicked rather than waiting for a re-render.
  const stopRequestedRef = useRef(false);

  const studentByName = new Map(students.map((s) => [s.display_name, s.profile_id]));

  const allPages = batch?.page_count
    ? Array.from({ length: batch.page_count }, (_, i) => i + 1)
    : [];
  const blankPages = new Set(batch?.blank_pages ?? []);
  const claimedPages = new Set(rows.flatMap((r) => r.pages));
  // Confirmed-blank pages (e.g. a fixed-length booklet's unused last page)
  // are excluded here rather than folded into "needs review" -- they were
  // never going to have work on them, so nothing for the teacher to check.
  const unclaimedPages = allPages.filter((p) => !claimedPages.has(p) && !blankPages.has(p));

  const rowsWithConflicts = (() => {
    const owners = new Map<number, string[]>();
    for (const r of rows) {
      for (const p of r.pages) {
        owners.set(p, [...(owners.get(p) ?? []), r.key]);
      }
    }
    const conflicted = new Set<string>();
    for (const [, keys] of owners) {
      if (keys.length > 1) for (const k of keys) conflicted.add(k);
    }
    return conflicted;
  })();

  // Same student matched to more than one row — typically a continuation
  // sheet the model treated as its own cover page. Splitting would 409:
  // every row needs a unique studentId, so surface a one-click fix instead
  // of making the teacher manually merge page ranges and delete a row.
  const duplicateStudentGroups: [string, string[]][] = (() => {
    const byStudent = new Map<string, string[]>();
    for (const r of rows) {
      if (!r.studentId) continue;
      byStudent.set(r.studentId, [...(byStudent.get(r.studentId) ?? []), r.key]);
    }
    return [...byStudent.entries()].filter(([, keys]) => keys.length > 1);
  })();
  const duplicateRowKeys = new Set(duplicateStudentGroups.flatMap(([, keys]) => keys));

  const mergeDuplicates = (studentId: string) =>
    setRows((prev) => {
      const group = prev.filter((r) => r.studentId === studentId);
      if (group.length < 2) return prev;
      const mergedPages = [...new Set(group.flatMap((r) => r.pages))].sort((a, b) => a - b);
      const merged: ReviewRow = {
        key: group[0].key,
        label: group[0].label,
        pages: mergedPages,
        confidence: group[0].confidence,
        note: [...new Set(group.map((r) => r.note).filter(Boolean))].join(" / "),
        studentId,
      };
      return [...prev.filter((r) => r.studentId !== studentId), merged];
    });

  const handleUpload = async (file: File) => {
    setUploading(true);
    setError(null);
    setBatch(null);
    setSplitResults(null);
    setStatusLine(null);

    try {
      // Batch scans can be very large — upload straight to Storage from the
      // browser rather than sending it as JSON through this Next.js route,
      // which stays well under Vercel's request-body limit either way.
      setUploadProgress("Uploading scan…");
      const supaModule = await import("@/lib/supabase/client");
      const supabase = supaModule.createClient();

      const safeName = file.name.replace(/[^\w.\-]/g, "_");
      const storagePath = `batches/${crypto.randomUUID()}/${safeName}`;

      const { error: uploadErr } = await supabase.storage
        .from("exam-scans")
        .upload(storagePath, file, { contentType: "application/pdf", upsert: false });
      if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);

      setUploadProgress("Reading cover pages and matching names — this can take a minute for a full class…");
      const { ok, data } = await fetchJson(`/api/tests/${testId}/ai-grade/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storagePath, fileName: file.name }),
      });
      if (!ok) throw new Error((data.error as string) ?? "Segmentation failed.");

      const segments: ProposedSegment[] = (data.segments as ProposedSegment[]) ?? [];
      const blankPages = (data.blankPages as number[]) ?? [];
      setBatch({
        id: data.batchId as string,
        status: "segmented",
        file_name: file.name,
        page_count: data.pageCount as number,
        proposed_segments: segments,
        confirmed_segments: null,
        unassigned_pages: (data.unassignedPages as number[]) ?? [],
        blank_pages: blankPages,
        error: null,
        created_at: new Date().toISOString(),
      });
      setRows(
        segments.map((s, i) => ({
          key: `${i}-${s.label}`,
          label: s.label,
          pages: s.pages,
          confidence: s.confidence,
          note: s.note,
          studentId: s.matchedStudentId ?? studentByName.get(s.label) ?? "",
        }))
      );
      setStatusLine(
        `Found ${segments.length} student(s) across ${data.pageCount} pages.` +
          (data.reusedFromBatchId
            ? " This PDF was uploaded before, so its page mapping was reused instead of being read again."
            : "") +
          " Review the mapping below before grading."
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
      { key: `manual-${Date.now()}`, label: "New student", pages: [], confidence: "low", note: "Added manually", studentId: "" },
    ]);

  const canSplit =
    !!batch &&
    rows.length > 0 &&
    rows.every((r) => r.studentId && r.pages.length > 0) &&
    rowsWithConflicts.size === 0 &&
    new Set(rows.map((r) => r.studentId)).size === rows.length;

  const handleStop = () => {
    stopRequestedRef.current = true;
    setStopRequested(true);
  };

  const handleSplit = async () => {
    if (!batch || !canSplit) return;
    setSplitting(true);
    setStopRequested(false);
    stopRequestedRef.current = false;
    setError(null);
    setStatusLine("Splitting the batch into per-student scans…");
    try {
      const { ok, data } = await fetchJson(`/api/tests/${testId}/ai-grade/batch/${batch.id}/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segments: rows.map((r) => ({ label: r.label, pages: r.pages, studentId: r.studentId })),
        }),
      });
      if (!ok) throw new Error((data.error as string) ?? "Splitting failed.");

      const splitRows =
        (data.results as
          | { studentId: string; label: string; status: string; storagePath?: string; error?: string }[]
          | undefined) ?? [];

      // Grading each student is its own request against the existing
      // single-student route, passed the exact scan this route just split
      // and uploaded — kept sequential and client-driven so no single
      // serverless invocation has to grade a whole class inside one
      // duration budget.
      const graded: SplitResultRow[] = [];
      let stoppedEarly = false;
      for (const sr of splitRows) {
        // Checked before starting each student rather than aborting an
        // in-flight request -- once a grading call has been sent, the model
        // has already been billed for it either way, so there is nothing to
        // save by cancelling mid-flight. This only stops the NEXT one.
        if (stopRequestedRef.current) {
          stoppedEarly = true;
          break;
        }
        if (sr.status !== "split" || !sr.storagePath) {
          graded.push({ studentId: sr.studentId, label: sr.label, runId: null, status: "failed", error: sr.error });
          setSplitResults([...graded]);
          continue;
        }
        setStatusLine(`Marking ${sr.label}'s script (${graded.length + 1} of ${splitRows.length})…`);
        try {
          const { ok: gradeOk, data: gradeData } = await fetchJson(`/api/tests/${testId}/ai-grade`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ studentId: sr.studentId, storagePath: sr.storagePath }),
          });
          if (!gradeOk) {
            graded.push({
              studentId: sr.studentId,
              label: sr.label,
              runId: (gradeData.runId as string) ?? null,
              status: "failed",
              error: gradeData.error as string,
            });
          } else {
            graded.push({
              studentId: sr.studentId,
              label: sr.label,
              runId: (gradeData.runId as string) ?? null,
              status: "complete",
              suggestedTotal: gradeData.suggestedTotal as number,
              maxTotal: gradeData.maxTotal as number,
              testTotalMarks: gradeData.testTotalMarks as number,
              partsGraded: gradeData.partsGraded as number,
            });
          }
        } catch (e) {
          graded.push({
            studentId: sr.studentId,
            label: sr.label,
            runId: null,
            status: "failed",
            error: e instanceof Error ? e.message : "Marking failed.",
          });
        }
        setSplitResults([...graded]);
      }

      const completedCount = graded.filter((r) => r.status === "complete").length;
      const failedCount = graded.filter((r) => r.status === "failed").length;
      const remaining = splitRows.length - graded.length;
      setStatusLine(
        stoppedEarly
          ? `Stopped after ${graded.length} of ${splitRows.length} student(s) — ${remaining} not started. ` +
              `${completedCount} graded${failedCount > 0 ? `, ${failedCount} failed` : ""}.`
          : `Graded ${completedCount} of ${graded.length} student(s). ${
              failedCount > 0 ? `${failedCount} failed — see below.` : "Review each student from the Individual tab."
            }`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Splitting failed.");
      setStatusLine(null);
    } finally {
      setSplitting(false);
      setStopRequested(false);
    }
  };

  const reset = () => {
    setBatch(null);
    setRows([]);
    setSplitResults(null);
    setStatusLine(null);
    setError(null);
  };

  return (
    <div className="space-y-6">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        onChange={handleFilePicked}
        className="hidden"
      />

      {error && (
        <div className="rounded-lg border border-red-400/40 bg-red-500/15 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}
      {statusLine && (
        <div className="rounded-lg border border-blue-400/40 bg-blue-500/15 px-4 py-3 text-sm text-blue-300">
          {statusLine}
        </div>
      )}

      {!batch && (
        <section className="rounded-xl border border-da-border bg-da-surface p-5 shadow-sm">
          <h2 className="text-lg font-bold text-da-text">Upload a batch scan</h2>
          <p className="mt-1 text-sm text-da-muted">
            One PDF covering multiple students, each starting with a cover page bearing their
            name. Overflow work on loose paper doesn&apos;t need to stay next to its owner —
            the model looks for self-labelled continuation pages anywhere in the document.
            You&apos;ll confirm the page-to-student mapping before anything is graded.
          </p>
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="mt-4 rounded-lg border border-purple-400/40 bg-purple-500/15 px-4 py-2 text-sm font-medium text-purple-300 hover:bg-purple-500/25 disabled:opacity-50"
          >
            {uploading ? uploadProgress ?? "Working…" : "Upload batch scan"}
          </button>
        </section>
      )}

      {batch && (
        <section className="rounded-xl border border-da-border bg-da-surface shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-da-border px-5 py-3">
            <div>
              <h2 className="text-lg font-bold text-da-text">
                {batch.file_name} — {batch.page_count} pages
              </h2>
              <p className="text-xs text-da-muted">
                Confirm which pages belong to which student. Matched names are pre-filled from
                the class roster — check every low-confidence row before splitting.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={reset}
                className="rounded border border-da-border px-3 py-1 text-xs text-da-muted hover:bg-da-hover"
              >
                Start over
              </button>
              {splitting && (
                <button
                  type="button"
                  onClick={handleStop}
                  disabled={stopRequested}
                  title="Finishes the student currently being marked (already billed either way), then stops before starting the next one."
                  className="rounded-lg border border-red-400/40 bg-red-500/15 px-4 py-2 text-sm font-medium text-red-300 hover:bg-red-500/25 disabled:opacity-50"
                >
                  {stopRequested ? "Stopping after this student…" : "Stop"}
                </button>
              )}
              <button
                type="button"
                onClick={handleSplit}
                disabled={!canSplit || splitting || !!splitResults}
                className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
                title={
                  !canSplit
                    ? "Every row needs a matched student, at least one page, and no page conflicts"
                    : undefined
                }
              >
                {splitting ? "Splitting & grading…" : `Split and grade ${rows.length} student(s)`}
              </button>
            </div>
          </div>

          {batch.blank_pages.length > 0 && !splitResults && (
            <div className="border-b border-da-border bg-da-hover px-5 py-2 text-xs text-da-muted">
              Page(s) {formatPageList(batch.blank_pages)} were identified as blank and skipped — nothing to
              review there.
            </div>
          )}
          {unclaimedPages.length > 0 && !splitResults && (
            <div className="border-b border-amber-400/40 bg-amber-500/15 px-5 py-2 text-xs text-amber-300">
              ⚠ Page(s) {formatPageList(unclaimedPages)} aren&apos;t assigned to any row yet.
            </div>
          )}
          {rowsWithConflicts.size > 0 && !splitResults && (
            <div className="border-b border-red-400/40 bg-red-500/15 px-5 py-2 text-xs text-red-300">
              ⚠ Some pages are claimed by more than one row — fix the page ranges before
              splitting.
            </div>
          )}
          {duplicateStudentGroups.length > 0 && !splitResults && (
            <div className="space-y-1 border-b border-red-400/40 bg-red-500/15 px-5 py-2 text-xs text-red-300">
              {duplicateStudentGroups.map(([studentId, keys]) => {
                const name = students.find((st) => st.profile_id === studentId)?.display_name ?? "This student";
                return (
                  <div key={studentId} className="flex flex-wrap items-center gap-2">
                    <span>
                      ⚠ {name} is matched to {keys.length} rows — likely a continuation sheet the
                      model read as its own cover page.
                    </span>
                    <button
                      type="button"
                      onClick={() => mergeDuplicates(studentId)}
                      className="rounded border border-red-400/40 bg-da-surface px-2 py-0.5 text-xs font-medium text-red-300 hover:bg-red-500/25"
                    >
                      Merge into one row
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-da-border text-left text-xs uppercase tracking-wide text-da-muted">
                  <th className="px-4 py-2 font-semibold">Name on cover page</th>
                  <th className="px-2 py-2 font-semibold">Pages</th>
                  <th className="px-2 py-2 font-semibold">Matched student</th>
                  <th className="px-2 py-2 font-semibold">Confidence</th>
                  <th className="px-2 py-2 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const conflicted = rowsWithConflicts.has(r.key);
                  const duplicateStudent = duplicateRowKeys.has(r.key);
                  const result = splitResults?.find((sr) => sr.studentId === r.studentId);
                  return (
                    <tr key={r.key} className="border-b border-da-border">
                      <td className="px-4 py-2">
                        <input
                          value={r.label}
                          onChange={(e) => updateRow(r.key, { label: e.target.value })}
                          disabled={!!splitResults}
                          className="w-40 rounded border border-da-border px-2 py-1 text-sm focus:ring-2 focus:ring-purple-400 disabled:bg-da-hover"
                        />
                        {r.note && <p className="mt-0.5 text-xs text-da-muted">{r.note}</p>}
                      </td>
                      <td className="px-2 py-2">
                        <input
                          value={formatPageList(r.pages)}
                          onChange={(e) => updateRow(r.key, { pages: parsePageList(e.target.value) })}
                          disabled={!!splitResults}
                          placeholder="e.g. 1-8"
                          className={`w-28 rounded border px-2 py-1 text-sm focus:ring-2 focus:ring-purple-400 disabled:bg-da-hover ${
                            conflicted ? "border-red-400" : "border-da-border"
                          }`}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <select
                          value={r.studentId}
                          onChange={(e) => updateRow(r.key, { studentId: e.target.value })}
                          disabled={!!splitResults}
                          className={`rounded border px-2 py-1 text-sm focus:ring-2 focus:ring-purple-400 disabled:bg-da-hover ${
                            duplicateStudent ? "border-red-400" : "border-da-border"
                          }`}
                        >
                          <option value="">— pick a student —</option>
                          {students.map((s) => (
                            <option key={s.profile_id} value={s.profile_id}>
                              {s.display_name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        <span
                          className={`rounded border px-2 py-0.5 text-xs font-medium ${CONFIDENCE_STYLE[r.confidence]}`}
                        >
                          {r.confidence}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        {result ? (
                          result.status === "complete" ? (
                            <span className="text-xs text-green-300">
                              graded {result.suggestedTotal}/{result.maxTotal}
                              {typeof result.testTotalMarks === "number" &&
                                result.testTotalMarks !== result.maxTotal &&
                                ` of ${result.testTotalMarks} total`}
                            </span>
                          ) : (
                            <span className="text-xs text-red-300" title={result.error}>
                              failed
                            </span>
                          )
                        ) : splitResults ? (
                          // Present once grading has started but this row
                          // never got to it -- either still queued behind
                          // others, or skipped by a Stop click.
                          <span className="text-xs text-da-muted">not started</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => removeRow(r.key)}
                            className="text-xs text-red-400 hover:text-red-200"
                          >
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

          {!splitResults && (
            <div className="border-t border-da-border px-5 py-3">
              <button type="button" onClick={addRow} className="text-sm text-purple-300 hover:underline">
                + Add a student row (for a page the model missed)
              </button>
            </div>
          )}

          {splitResults && (
            <div className="border-t border-da-border px-5 py-3 text-sm text-da-muted">
              Graded scripts are staged for review. Switch to the{" "}
              <span className="font-semibold">Individual</span> tab and open each student&apos;s
              &quot;Review →&quot; to check and accept their marks.
            </div>
          )}
        </section>
      )}
    </div>
  );
}
