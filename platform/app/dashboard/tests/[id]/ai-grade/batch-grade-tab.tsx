"use client";

import { useEffect, useImperativeHandle, useRef, useState } from "react";
import type { ChangeEvent, Ref } from "react";
import { fetchJson } from "./fetch-json";
import { StudentPicker } from "./student-picker";
import { runWithConcurrency } from "@/lib/concurrency";
import { groupUnfinishedBatches, type RestorableBatch } from "@/lib/batch-restore";

/**
 * How many parts "grade all parts" works on at once, after the first
 * student has warmed the mark-scheme cache. Every part in flight is a
 * split call (12-18MB in and out of Storage) followed by a grading call
 * holding the same scan in memory while the model marks it. With no cap,
 * a three-file upload fired 26 parts at the same instant (5 Sep 2026) and
 * the splits, starved by one another, ran past the serverless time limit.
 * Four keeps a class moving (grading is mostly waiting on the model, so
 * four parts overlap well) without a burst of that size.
 */
const MAX_CONCURRENT_PARTS = 4;

type Confidence = "high" | "medium" | "low";
type BatchStatus = "uploaded" | "segmenting" | "segmented" | "failed" | "split";

interface StudentOption {
  profile_id: string;
  display_name: string;
  /** Real class ("9A"); the picker groups the pooled roster by this. */
  class_name: string | null;
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

/**
 * One part of an upload the server cut into chunks (see
 * lib/batch-chunking.ts), as returned by POST .../ai-grade/batch with
 * chunked: true. Page numbers are those of the ORIGINAL upload.
 */
interface UploadChunk {
  index: number;
  count: number;
  storagePath: string;
  fileName: string;
  firstPage: number;
  lastPage: number;
  pageCount: number;
  cleanCutAfter: boolean;
}

/**
 * Per-part lifecycle. A small upload is a single part with chunk: null; an
 * oversized one has one part per chunk, each segmented by its own request
 * and reviewed/graded in its own panel.
 */
interface PartState {
  key: string;
  chunk: UploadChunk | null;
  status: "pending" | "segmenting" | "segmented" | "failed";
  batch: BatchRow | null;
  reused: boolean;
  error: string | null;
  /**
   * Set when this part came back from the server on page load rather than
   * from an upload in this session (lib/batch-restore.ts): "segmented" for
   * one still awaiting review, "split" for one that was split earlier but
   * never graded -- what a gateway timeout mid-flow leaves behind.
   */
  restored: "segmented" | "split" | null;
}

interface UploadState {
  key: string;
  fileName: string;
  status: "uploading" | "reading" | "ready" | "failed";
  pageCount: number | null;
  parts: PartState[];
  /** Warnings from the chunk planner (e.g. a cut that may split a student). */
  warnings: string[];
  error: string | null;
}

/**
 * Where one part's panel is in its own lifecycle, reported up to the tab so
 * the "all parts" controls know what a click would actually do.
 *   reviewing  rows still need a matched student / non-empty pages / no conflicts
 *   ready      the panel's own "Split and grade" button is enabled
 *   grading    its split+grade loop is running
 *   done       grading has started and finished (or was stopped)
 */
type PanelStatus = "reviewing" | "ready" | "grading" | "done";

/** What the tab can ask a panel to do on the teacher's behalf. */
interface BatchPanelHandle {
  splitAndGrade: (opts?: { onFirstStudentGraded?: () => void }) => Promise<void>;
  stop: () => void;
}

/**
 * How many files are uploaded and read at once. Each file's segmentation is
 * one serverless request carrying one Opus call, so this is also the number
 * of concurrent whole-document model reads; three keeps a stack of class
 * scans moving without leaning on rate limits.
 */
const FILE_CONCURRENCY = 3;

/** Run async tasks with at most `limit` in flight. Results keep task order. */
async function runPool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
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
  /**
   * What the server's roster match proposed for this row ("" if nothing).
   * When the teacher picks someone else, the cover-page label is a spelling
   * the matcher did not know -- offered as an alias to remember.
   */
  proposedStudentId: string;
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

/** Turn a segmentation response into the batch row + review rows a panel starts from. */
function batchFromSegmentation(data: Record<string, unknown>, fileName: string): BatchRow {
  return {
    id: data.batchId as string,
    status: "segmented",
    file_name: fileName,
    page_count: data.pageCount as number,
    proposed_segments: (data.segments as ProposedSegment[]) ?? [],
    confirmed_segments: null,
    unassigned_pages: (data.unassignedPages as number[]) ?? [],
    blank_pages: (data.blankPages as number[]) ?? [],
    error: null,
    created_at: new Date().toISOString(),
  };
}

export function BatchGradeTab({
  testId,
  students,
}: {
  testId: string;
  students: StudentOption[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [panelStatus, setPanelStatus] = useState<Record<string, PanelStatus>>({});
  const [gradingAll, setGradingAll] = useState(false);
  const [allStatusLine, setAllStatusLine] = useState<string | null>(null);
  /** True until the first look at the server's batch list has come back. */
  const [restoring, setRestoring] = useState(true);
  const [restoredCount, setRestoredCount] = useState(0);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const panelRefs = useRef(new Map<string, BatchPanelHandle>());

  // -- Restore unfinished batches on load --------------------------------------
  // This list used to start empty on every page load, so a reload (or just
  // coming back the next day) hid every upload the model had already read
  // but nobody had graded yet -- and the only way back was re-uploading the
  // scans. The server keeps every batch row; rebuild the list from the
  // ones that still have grading to do. A batch uploaded in THIS session
  // is never duplicated: the restore only runs while the list is empty.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { ok, data } = await fetchJson(`/api/tests/${testId}/ai-grade/batch`);
        if (!ok || cancelled) return;
        type ApiBatch = BatchRow & RestorableBatch & { source_storage_path?: string | null };
        const restored = groupUnfinishedBatches(((data.batches as ApiBatch[]) ?? []));
        if (restored.length === 0) return;
        const entries: UploadState[] = restored.map((u) => ({
          key: `restored-${u.fileName}`,
          fileName: u.fileName,
          status: "ready",
          pageCount: u.pageCount,
          warnings: [],
          error: null,
          parts: u.parts.map((p) => ({
            key: p.count > 1 ? `part-${p.index}` : "whole",
            chunk:
              p.count > 1
                ? {
                    index: p.index,
                    count: p.count,
                    storagePath: p.batch.source_storage_path ?? "",
                    fileName: p.batch.file_name ?? u.fileName,
                    firstPage: p.firstPage,
                    lastPage: p.lastPage,
                    pageCount: p.batch.page_count ?? p.lastPage - p.firstPage + 1,
                    cleanCutAfter: true,
                  }
                : null,
            status: "segmented",
            batch: p.batch,
            reused: false,
            error: null,
            restored: p.splitButUngraded ? "split" : "segmented",
          })),
        }));
        const partCount = entries.reduce((n, u) => n + u.parts.length, 0);
        setUploads((prev) => (prev.length > 0 ? prev : entries));
        setRestoredCount(partCount);
      } catch {
        // A failed restore only means an empty list, exactly as before.
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [testId]);

  const updateUpload = (key: string, patch: Partial<UploadState>) =>
    setUploads((prev) => prev.map((u) => (u.key === key ? { ...u, ...patch } : u)));

  const updatePart = (uploadKey: string, partKey: string, patch: Partial<PartState>) =>
    setUploads((prev) =>
      prev.map((u) =>
        u.key === uploadKey
          ? { ...u, parts: u.parts.map((p) => (p.key === partKey ? { ...p, ...patch } : p)) }
          : u
      )
    );

  /**
   * Segment one stored PDF (a whole upload, or one part of a chunked one)
   * through the batch route and record the outcome on its part.
   */
  const segmentPart = async (uploadKey: string, partKey: string, storagePath: string, fileName: string) => {
    updatePart(uploadKey, partKey, { status: "segmenting", error: null });
    try {
      const { ok, data } = await fetchJson(`/api/tests/${testId}/ai-grade/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storagePath, fileName }),
      });
      if (!ok) throw new Error((data.error as string) ?? "Segmentation failed.");
      if (data.chunked) {
        // A part is already under both limits by construction, so this
        // can't happen unless the planner is wrong -- surface it rather
        // than recursing into parts of parts.
        throw new Error("The server tried to split this part again; upload the scan again.");
      }
      updatePart(uploadKey, partKey, {
        status: "segmented",
        batch: batchFromSegmentation(data, fileName),
        reused: !!data.reusedFromBatchId,
      });
    } catch (e) {
      updatePart(uploadKey, partKey, {
        status: "failed",
        error: e instanceof Error ? e.message : "Segmentation failed.",
      });
    }
  };

  /**
   * One file, end to end: upload to Storage, ask the server to read it (or
   * cut it into parts), then read each part. Never throws -- a bad file
   * marks its own upload failed and the others carry on.
   */
  const processFile = async (uploadKey: string, file: File) => {
    try {
      // Batch scans can be very large — upload straight to Storage from the
      // browser rather than sending it as JSON through this Next.js route,
      // which stays well under Vercel's request-body limit either way.
      const supaModule = await import("@/lib/supabase/client");
      const supabase = supaModule.createClient();

      const safeName = file.name.replace(/[^\w.\-]/g, "_");
      const storagePath = `batches/${crypto.randomUUID()}/${safeName}`;

      const { error: uploadErr } = await supabase.storage
        .from("exam-scans")
        .upload(storagePath, file, { contentType: "application/pdf", upsert: false });
      if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);

      updateUpload(uploadKey, { status: "reading" });
      const { ok, data } = await fetchJson(`/api/tests/${testId}/ai-grade/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storagePath, fileName: file.name }),
      });
      if (!ok) throw new Error((data.error as string) ?? "Segmentation failed.");

      if (data.chunked) {
        // Too many pages (or bytes) for one segmentation call: the server
        // cut the scan into parts on cover pages and stored each one. Read
        // them one request at a time -- each is its own 300s budget -- and
        // let the teacher start reviewing part 1 while later parts load.
        const chunks = (data.chunks as UploadChunk[]) ?? [];
        const parts: PartState[] = chunks.map((c) => ({
          key: `part-${c.index}`,
          chunk: c,
          status: "pending",
          batch: null,
          reused: false,
          error: null,
          restored: null,
        }));
        updateUpload(uploadKey, {
          status: "ready",
          pageCount: data.pageCount as number,
          parts,
          warnings: (data.warnings as string[]) ?? [],
        });
        for (const part of parts) {
          await segmentPart(uploadKey, part.key, part.chunk!.storagePath, part.chunk!.fileName);
        }
        return;
      }

      updateUpload(uploadKey, {
        status: "ready",
        pageCount: data.pageCount as number,
        warnings: [],
        parts: [
          {
            key: "whole",
            chunk: null,
            status: "segmented",
            batch: batchFromSegmentation(data, file.name),
            reused: !!data.reusedFromBatchId,
            error: null,
            restored: null,
          },
        ],
      });
    } catch (e) {
      updateUpload(uploadKey, {
        status: "failed",
        error: e instanceof Error ? e.message : "Upload or segmentation failed.",
      });
    }
  };

  const handleUpload = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    setError(null);
    setAllStatusLine(null);

    // Every file shows up at once (so the teacher can see the whole stack)
    // and is then uploaded and read with bounded concurrency: files are
    // independent, and a class set that arrives as several scanner runs
    // shouldn't have to wait for each one to finish before the next starts.
    const entries = files.map((file) => ({
      file,
      upload: {
        key: crypto.randomUUID(),
        fileName: file.name,
        status: "uploading" as const,
        pageCount: null,
        parts: [],
        warnings: [],
        error: null,
      } satisfies UploadState,
    }));
    setUploads((prev) => [...prev, ...entries.map((e) => e.upload)]);

    try {
      await runPool(
        entries.map((e) => () => processFile(e.upload.key, e.file)),
        FILE_CONCURRENCY
      );
    } finally {
      setUploading(false);
    }
  };

  const handleFilePicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    await handleUpload(files);
  };

  const reset = () => {
    setUploads([]);
    setError(null);
    setPanelStatus({});
    setAllStatusLine(null);
    setRestoredCount(0);
    panelRefs.current.clear();
  };

  const allParts = uploads.flatMap((u) => u.parts.map((p) => ({ upload: u, part: p, key: `${u.key}/${p.key}` })));
  const readingAny =
    uploading ||
    uploads.some((u) => u.status === "uploading" || u.status === "reading") ||
    allParts.some(({ part }) => part.status === "pending" || part.status === "segmenting");
  const partCount = allParts.length;

  // -- "All parts" controls ---------------------------------------------------
  // Each part is an independent batch with its own per-student grading loop
  // (sequential, one request per student, so no single serverless call ever
  // grades more than one script). Running the parts' loops CONCURRENTLY is
  // the efficient way to grade a whole upload -- or several uploads: a
  // 4-part scan grades four students at a time instead of one, with no
  // request any bigger than before. The concurrency is capped at
  // MAX_CONCURRENT_PARTS, though: unbounded, a class-sized upload starves
  // its own split calls. Parts whose rows still need review are skipped and
  // named, so a half-reviewed stack can still start on the parts that are
  // ready.
  //
  // One deliberate wrinkle: the first student is graded ALONE before the
  // other parts start. Every grading call for the same test shares a cached
  // prefix (the mark scheme); the first call writes that cache and the rest
  // read it at a tenth of the price -- but only if they start after the
  // write has landed. Firing all parts at once makes each part's first
  // student pay the full write. The stagger costs one student's latency.
  const statusOf = (key: string): PanelStatus | undefined => panelStatus[key];
  const readyParts = allParts.filter(({ key }) => statusOf(key) === "ready");
  const reviewingParts = allParts.filter(({ key }) => statusOf(key) === "reviewing");
  const gradingParts = allParts.filter(({ key }) => statusOf(key) === "grading");
  const partLabelOf = ({ upload, part }: { upload: UploadState; part: PartState }) =>
    uploads.length > 1
      ? `${upload.fileName}${part.chunk ? ` part ${part.chunk.index + 1}` : ""}`
      : `part ${part.chunk ? part.chunk.index + 1 : 1}`;

  const handleGradeAll = async () => {
    if (readyParts.length === 0) return;
    setGradingAll(true);
    const skipped = reviewingParts.map(partLabelOf);
    setAllStatusLine(
      `Grading ${readyParts.length} part(s) — the first student goes alone to warm the mark-scheme cache, then the rest run ${MAX_CONCURRENT_PARTS} at a time.` +
        (skipped.length > 0 ? ` Skipped until their rows are reviewed: ${skipped.join(", ")}.` : "")
    );
    try {
      const [first, ...rest] = readyParts;
      let releaseRest!: () => void;
      const restMayStart = new Promise<void>((resolve) => {
        releaseRest = resolve;
      });
      const firstRun = (panelRefs.current.get(first.key)?.splitAndGrade({ onFirstStudentGraded: releaseRest }) ??
        Promise.resolve()).finally(releaseRest);
      await restMayStart;
      // The first part is still grading its remaining students while the
      // pool starts, so it counts as one of the slots in flight.
      await Promise.allSettled([
        firstRun,
        runWithConcurrency(
          rest.map(({ key }) => () => panelRefs.current.get(key)?.splitAndGrade() ?? Promise.resolve()),
          MAX_CONCURRENT_PARTS - 1
        ),
      ]);
      setAllStatusLine(
        `Finished ${readyParts.length} part(s). See each part below for its results.` +
          (skipped.length > 0 ? ` Still need review: ${skipped.join(", ")}.` : "")
      );
    } finally {
      setGradingAll(false);
    }
  };

  const handleStopAll = () => {
    for (const { key } of gradingParts) panelRefs.current.get(key)?.stop();
  };

  return (
    <div className="space-y-6">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        multiple
        onChange={handleFilePicked}
        className="hidden"
      />

      {error && (
        <div className="rounded-lg border border-red-400/40 bg-red-500/15 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {uploads.length === 0 && restoring && (
        <section className="rounded-xl border border-da-border bg-da-surface p-5 shadow-sm">
          <p className="text-sm text-da-muted">Checking for earlier uploads that still need grading…</p>
        </section>
      )}

      {uploads.length === 0 && !restoring && (
        <section className="rounded-xl border border-da-border bg-da-surface p-5 shadow-sm">
          <h2 className="text-lg font-bold text-da-text">Upload batch scans</h2>
          <p className="mt-1 text-sm text-da-muted">
            One or more PDFs, each covering multiple students, each student starting with a
            cover page bearing their name. Overflow work on loose paper doesn&apos;t need to
            stay next to its owner — the model looks for self-labelled continuation pages
            anywhere in the document. You&apos;ll confirm the page-to-student mapping before
            anything is graded.
          </p>
          <p className="mt-1 text-sm text-da-muted">
            There is no page limit: a scan too long to read in one go is cut into parts on
            students&apos; cover pages. Several files are uploaded and read side by side, and
            every part is reviewed and graded separately below — or all at once.
          </p>
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="mt-4 rounded-lg border border-purple-400/40 bg-purple-500/15 px-4 py-2 text-sm font-medium text-purple-300 hover:bg-purple-500/25 disabled:opacity-50"
          >
            {uploading ? "Working…" : "Upload batch scan(s)"}
          </button>
        </section>
      )}

      {uploads.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-da-border bg-da-surface px-5 py-3 shadow-sm">
            <div>
              <h2 className="text-lg font-bold text-da-text">
                {uploads.length === 1
                  ? `${uploads[0].fileName}${uploads[0].pageCount ? ` — ${uploads[0].pageCount} pages` : ""}${partCount > 1 ? ` in ${partCount} parts` : ""}`
                  : `${uploads.length} files${partCount > 0 ? ` — ${partCount} part(s)` : ""}`}
              </h2>
              <p className="text-xs text-da-muted">
                {partCount > 1
                  ? "Each part is read, reviewed and graded independently. Grade them one at a time below, or all at once here."
                  : "Confirm which pages belong to which student before grading."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={readingAny || gradingParts.length > 0}
                className="rounded border border-da-border px-3 py-1 text-xs text-da-muted hover:bg-da-hover disabled:opacity-50"
              >
                Add more files
              </button>
              <button
                type="button"
                onClick={reset}
                disabled={readingAny || gradingParts.length > 0}
                className="rounded border border-da-border px-3 py-1 text-xs text-da-muted hover:bg-da-hover disabled:opacity-50"
              >
                Start over
              </button>
              {partCount > 1 && gradingParts.length > 0 && (
                <button
                  type="button"
                  onClick={handleStopAll}
                  title="Each part finishes the student it is currently marking (already billed either way), then stops before starting the next one."
                  className="rounded-lg border border-red-400/40 bg-red-500/15 px-4 py-2 text-sm font-medium text-red-300 hover:bg-red-500/25"
                >
                  Stop all parts
                </button>
              )}
              {partCount > 1 && (
                <button
                  type="button"
                  onClick={handleGradeAll}
                  disabled={readingAny || gradingAll || gradingParts.length > 0 || readyParts.length === 0}
                  title={
                    readingAny
                      ? "Wait for every file to be read first"
                      : readyParts.length === 0
                        ? "No part is ready yet — every row in a part needs a matched student, at least one page, and no page conflicts"
                        : reviewingParts.length > 0
                          ? `Grades the ${readyParts.length} ready part(s) at once; still need review and will be skipped: ${reviewingParts.map(partLabelOf).join(", ")}`
                          : "Splits and grades every part at once — each part marks its students one at a time, in parallel with the other parts"
                  }
                  className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
                >
                  {gradingAll
                    ? "Grading all parts…"
                    : `Split and grade all ${readyParts.length === partCount ? partCount : `${readyParts.length} ready`} part(s)`}
                </button>
              )}
            </div>
          </div>

          {restoredCount > 0 && (
            <div className="rounded-lg border border-blue-400/40 bg-blue-500/15 px-4 py-3 text-sm text-blue-300">
              Restored {restoredCount} part(s) from earlier uploads that were read but not yet graded. Their
              page-to-student rows are as the model proposed them — check each before grading. &ldquo;Start
              over&rdquo; only clears this list; the uploads stay on the server.
            </div>
          )}

          {allStatusLine && (
            <div className="rounded-lg border border-blue-400/40 bg-blue-500/15 px-4 py-3 text-sm text-blue-300">
              {allStatusLine}
            </div>
          )}

          {uploads.map((upload) => (
            <div key={upload.key} className="space-y-4">
              {(uploads.length > 1 || upload.status !== "ready") && (
                <div
                  className={`rounded-xl border px-5 py-3 shadow-sm ${
                    upload.status === "failed" ? "border-red-400/40 bg-da-surface" : "border-da-border bg-da-surface"
                  }`}
                >
                  <h3 className="font-bold text-da-text">
                    {upload.fileName}
                    {upload.pageCount ? ` — ${upload.pageCount} pages` : ""}
                    {upload.parts.length > 1 ? ` in ${upload.parts.length} parts` : ""}
                  </h3>
                  {upload.status === "uploading" && <p className="text-sm text-da-muted">Uploading…</p>}
                  {upload.status === "reading" && (
                    <p className="text-sm text-da-muted">
                      Reading cover pages and matching names — this can take a minute for a full class…
                    </p>
                  )}
                  {upload.status === "failed" && <p className="text-sm text-red-300">{upload.error}</p>}
                </div>
              )}

              {upload.warnings.map((w, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-amber-400/40 bg-amber-500/15 px-4 py-3 text-sm text-amber-300"
                >
                  ⚠ {w}
                </div>
              ))}

              {upload.parts.map((part) => {
                const key = `${upload.key}/${part.key}`;
                const partLabel = part.chunk
                  ? `Part ${part.chunk.index + 1} of ${part.chunk.count} (pages ${part.chunk.firstPage}-${part.chunk.lastPage} of ${upload.fileName})`
                  : null;

                if (part.status === "segmented" && part.batch) {
                  return (
                    <div key={key} className="space-y-2">
                      {part.restored === "split" && (
                        <div className="rounded-lg border border-amber-400/40 bg-amber-500/15 px-4 py-3 text-sm text-amber-300">
                          ⚠ This part was split before but none of its students was graded — most likely the
                          earlier attempt timed out. Splitting and grading it again is safe.
                        </div>
                      )}
                      <BatchPanel
                        ref={(handle) => {
                          if (handle) panelRefs.current.set(key, handle);
                          else panelRefs.current.delete(key);
                        }}
                        testId={testId}
                        students={students}
                        batch={part.batch}
                        partLabel={partLabel}
                        reused={part.reused}
                        onStatus={(status) =>
                          setPanelStatus((prev) => (prev[key] === status ? prev : { ...prev, [key]: status }))
                        }
                      />
                    </div>
                  );
                }

                if (part.status === "failed") {
                  return (
                    <section key={key} className="rounded-xl border border-red-400/40 bg-da-surface p-5 shadow-sm">
                      <h3 className="font-bold text-da-text">{partLabel ?? upload.fileName}</h3>
                      <p className="mt-1 text-sm text-red-300">{part.error}</p>
                      {part.chunk && (
                        <button
                          type="button"
                          disabled={readingAny}
                          onClick={() => segmentPart(upload.key, part.key, part.chunk!.storagePath, part.chunk!.fileName)}
                          className="mt-3 rounded-lg border border-purple-400/40 bg-purple-500/15 px-4 py-2 text-sm font-medium text-purple-300 hover:bg-purple-500/25 disabled:opacity-50"
                        >
                          Read this part again
                        </button>
                      )}
                    </section>
                  );
                }

                return (
                  <section key={key} className="rounded-xl border border-da-border bg-da-surface p-5 shadow-sm">
                    <h3 className="font-bold text-da-text">{partLabel ?? upload.fileName}</h3>
                    <p className="mt-1 text-sm text-da-muted">
                      {part.status === "segmenting"
                        ? "Reading cover pages and matching names — this can take a minute…"
                        : "Waiting for the earlier parts to be read…"}
                    </p>
                  </section>
                );
              })}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/**
 * The review-and-grade panel for one segmented batch: the editable
 * page-to-student table, the split call, and the per-student grading loop.
 * A chunked upload renders one of these per part; a small upload renders
 * exactly one. Each owns its own rows and grading state so parts can be
 * reviewed in any order and graded independently.
 */
function BatchPanel({
  ref,
  testId,
  students,
  batch,
  partLabel,
  reused,
  onStatus,
}: {
  ref?: Ref<BatchPanelHandle>;
  testId: string;
  students: StudentOption[];
  batch: BatchRow;
  partLabel: string | null;
  reused: boolean;
  /** Reports the panel's lifecycle up to the tab -- see PanelStatus. */
  onStatus?: (status: PanelStatus) => void;
}) {
  const studentByName = new Map(students.map((s) => [s.display_name, s.profile_id]));

  const [error, setError] = useState<string | null>(null);
  const [statusLine, setStatusLine] = useState<string | null>(
    `Found ${batch.proposed_segments.length} student(s) across ${batch.page_count} pages.` +
      (reused
        ? " This PDF was uploaded before, so its page mapping was reused instead of being read again."
        : "") +
      " Review the mapping below before grading."
  );
  const [rows, setRows] = useState<ReviewRow[]>(() =>
    batch.proposed_segments.map((s, i) => ({
      key: `${i}-${s.label}`,
      label: s.label,
      pages: s.pages,
      confidence: s.confidence,
      note: s.note,
      studentId: s.matchedStudentId ?? studentByName.get(s.label) ?? "",
      proposedStudentId: s.matchedStudentId ?? studentByName.get(s.label) ?? "",
    }))
  );
  /** Cover-page labels already recorded as an alias this session, by row key. */
  const [rememberedRows, setRememberedRows] = useState<Record<string, "saving" | "saved" | "failed">>({});

  // Records the row's cover-page label as an accepted spelling of the
  // student the teacher picked, so the next scan with the same handwriting
  // is matched automatically (POST /api/students/aliases).
  const rememberSpelling = async (row: ReviewRow) => {
    if (!row.studentId || !row.label.trim()) return;
    setRememberedRows((prev) => ({ ...prev, [row.key]: "saving" }));
    const { ok } = await fetchJson("/api/students/aliases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId: row.studentId, alias: row.label.trim() }),
    });
    setRememberedRows((prev) => ({ ...prev, [row.key]: ok ? "saved" : "failed" }));
  };
  const [splitting, setSplitting] = useState(false);
  const [splitResults, setSplitResults] = useState<SplitResultRow[] | null>(null);
  const [stopRequested, setStopRequested] = useState(false);
  // A ref, not just the stopRequested state, so the running loop's closure
  // sees a stop the instant it's clicked rather than waiting for a re-render.
  const stopRequestedRef = useRef(false);

  const allPages = batch.page_count ? Array.from({ length: batch.page_count }, (_, i) => i + 1) : [];
  // Blank pages can grow after mount: pages the segmentation read left
  // unassigned are re-checked one by one (see the effect below) and the
  // confirmed-blank ones join this list without a reload.
  const [knownBlankPages, setKnownBlankPages] = useState<number[]>(batch.blank_pages);
  const [blankCheck, setBlankCheck] = useState<
    | { status: "checking"; pages: number[] }
    | { status: "done"; blank: number[]; kept: number[] }
    | { status: "failed" }
    | null
  >(null);
  const blankPages = new Set(knownBlankPages);
  const claimedPages = new Set(rows.flatMap((r) => r.pages));
  // Confirmed-blank pages (e.g. a fixed-length booklet's unused last page)
  // are excluded here rather than folded into "needs review" -- they were
  // never going to have work on them, so nothing for the teacher to check.
  const unclaimedPages = allPages.filter((p) => !claimedPages.has(p) && !blankPages.has(p));

  // Pages nobody claimed and the model did not call blank are usually the
  // unused back page of a booklet. Ask the server to look at each one
  // (POST .../blank-check) once, as soon as the panel appears, so the
  // teacher is not told to find a row for a page that has nothing on it.
  // Runs once per batch: later edits to page ranges do not re-trigger it.
  const blankCheckStarted = useRef(false);
  useEffect(() => {
    if (blankCheckStarted.current || splitResults) return;
    const candidates = allPages.filter((p) => !claimedPages.has(p) && !blankPages.has(p));
    if (candidates.length === 0) return;
    blankCheckStarted.current = true;
    let cancelled = false;
    (async () => {
      setBlankCheck({ status: "checking", pages: candidates });
      const { ok, data } = await fetchJson(`/api/tests/${testId}/ai-grade/batch/${batch.id}/blank-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pages: candidates }),
      });
      if (cancelled) return;
      if (!ok) {
        setBlankCheck({ status: "failed" });
        return;
      }
      const serverBlank = (data.blankPages as number[] | undefined) ?? batch.blank_pages;
      const blank = serverBlank.filter((p) => candidates.includes(p));
      setKnownBlankPages(serverBlank);
      setBlankCheck({ status: "done", blank, kept: candidates.filter((p) => !blank.includes(p)) });
    })();
    return () => {
      cancelled = true;
    };
    // Deliberately not keyed on the derived page sets: this is a one-shot
    // check for the pages unassigned when the panel first rendered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch.id]);

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
        proposedStudentId: group[0].proposedStudentId,
      };
      return [...prev.filter((r) => r.studentId !== studentId), merged];
    });

  const updateRow = (key: string, patch: Partial<ReviewRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const removeRow = (key: string) => setRows((prev) => prev.filter((r) => r.key !== key));

  const addRow = () =>
    setRows((prev) => [
      ...prev,
      {
        key: `manual-${Date.now()}`,
        label: "New student",
        pages: [],
        confidence: "low",
        note: "Added manually",
        studentId: "",
        proposedStudentId: "",
      },
    ]);

  const canSplit =
    rows.length > 0 &&
    rows.every((r) => r.studentId && r.pages.length > 0) &&
    rowsWithConflicts.size === 0 &&
    new Set(rows.map((r) => r.studentId)).size === rows.length;

  const handleStop = () => {
    stopRequestedRef.current = true;
    setStopRequested(true);
  };

  const handleSplit = async (opts: { onFirstStudentGraded?: () => void } = {}) => {
    if (!canSplit) return;
    let firstSignalled = false;
    const signalFirst = () => {
      if (firstSignalled) return;
      firstSignalled = true;
      opts.onFirstStudentGraded?.();
    };
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
        // Whether it succeeded or failed, one grading request for this test
        // has now completed, so the shared mark-scheme cache is warm.
        signalFirst();
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
      // Nothing graded (split failed, or every row was skipped): release
      // anyone waiting on the first student so the other parts still run.
      signalFirst();
    }
  };

  useImperativeHandle(ref, () => ({ splitAndGrade: handleSplit, stop: handleStop }));

  const status: PanelStatus = splitting ? "grading" : splitResults ? "done" : canSplit ? "ready" : "reviewing";
  useEffect(() => {
    onStatus?.(status);
    // onStatus is a fresh arrow each render of the parent; keying on the
    // status value alone is what keeps this from firing every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return (
    <section className="rounded-xl border border-da-border bg-da-surface shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-da-border px-5 py-3">
        <div>
          <h2 className="text-lg font-bold text-da-text">
            {partLabel ?? `${batch.file_name} — ${batch.page_count} pages`}
          </h2>
          <p className="text-xs text-da-muted">
            {partLabel && `${batch.page_count} pages in this part. `}
            Confirm which pages belong to which student. Matched names are pre-filled from
            the roster of every class in this group, signed in or not — type the start of a
            first or last name to find someone. Check every low-confidence row before splitting.
            {partLabel && " Page numbers here count from 1 within this part."}
          </p>
        </div>
        <div className="flex items-center gap-2">
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
            onClick={() => handleSplit()}
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

      {error && (
        <div className="border-b border-red-400/40 bg-red-500/15 px-5 py-2 text-sm text-red-300">{error}</div>
      )}
      {statusLine && (
        <div className="border-b border-blue-400/40 bg-blue-500/15 px-5 py-2 text-sm text-blue-300">
          {statusLine}
        </div>
      )}

      {knownBlankPages.length > 0 && !splitResults && (
        <div className="border-b border-da-border bg-da-hover px-5 py-2 text-xs text-da-muted">
          Page(s) {formatPageList(knownBlankPages)} were identified as blank and skipped — nothing to
          review there.
        </div>
      )}
      {blankCheck?.status === "checking" && !splitResults && (
        <div className="border-b border-blue-400/40 bg-blue-500/15 px-5 py-2 text-xs text-blue-300">
          Checking whether page(s) {formatPageList(blankCheck.pages)} are blank…
        </div>
      )}
      {blankCheck?.status === "failed" && !splitResults && (
        <div className="border-b border-amber-400/40 bg-amber-500/15 px-5 py-2 text-xs text-amber-300">
          Could not check the unassigned pages for being blank — review them by hand.
        </div>
      )}
      {unclaimedPages.length > 0 && blankCheck?.status !== "checking" && !splitResults && (
        <div className="border-b border-amber-400/40 bg-amber-500/15 px-5 py-2 text-xs text-amber-300">
          ⚠ Page(s) {formatPageList(unclaimedPages)} aren&apos;t assigned to any row yet
          {blankCheck?.status === "done" && blankCheck.kept.length > 0
            ? " — they do not look blank, so they need a row."
            : "."}
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
                    <StudentPicker
                      students={students}
                      value={r.studentId}
                      onChange={(studentId) => updateRow(r.key, { studentId })}
                      disabled={!!splitResults}
                      invalid={duplicateStudent}
                      placeholder="— pick a student —"
                    />
                    {(() => {
                      // Offer to remember the cover-page spelling once the
                      // teacher has picked a student the matcher did not
                      // propose, unless the label already is that name.
                      const chosen = students.find((st) => st.profile_id === r.studentId);
                      const label = r.label.trim();
                      const offer =
                        !!chosen &&
                        !!label &&
                        r.studentId !== r.proposedStudentId &&
                        label.localeCompare(chosen.display_name, undefined, { sensitivity: "base" }) !== 0 &&
                        !r.key.startsWith("manual-");
                      if (!offer) return null;
                      const state = rememberedRows[r.key];
                      return (
                        <button
                          type="button"
                          onClick={() => rememberSpelling(r)}
                          disabled={state === "saving" || state === "saved"}
                          title={`Record "${label}" as an accepted spelling of ${chosen.display_name}, so the next scan with this name is matched automatically`}
                          className="mt-1 block text-xs text-purple-300 hover:underline disabled:no-underline disabled:opacity-70"
                        >
                          {state === "saved"
                            ? `✓ "${label}" remembered for ${chosen.display_name}`
                            : state === "saving"
                              ? "Remembering…"
                              : state === "failed"
                                ? "Could not remember this spelling — try again"
                                : `Remember "${label}" as ${chosen.display_name}`}
                        </button>
                      );
                    })()}
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
  );
}
