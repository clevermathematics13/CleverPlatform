"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Confidence = "high" | "medium" | "low";

interface RosterEntry {
  id: string;
  fullName: string;
  /** e.g. "9A" -- which real class this student belongs to. Empty string if unknown. */
  courseName: string;
}

interface PacketVersionOption {
  id: string;
  versionLabel: string;
  pageCount: number | null;
  anchorsLocked: boolean;
  title: string | null;
  courseId: string | null;
  roster: RosterEntry[];
  rosterIsTrack: boolean;
  rosterSourceCourseNames: string[];
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

/** One chunk's full lifecycle: pending segmentation -> segmented (rows to review) -> split. */
interface ChunkState {
  batchId: string;
  chunkIndex: number;
  chunkCount: number;
  startPage: number;
  endPage: number;
  storagePath: string;
  status: "pending" | "segmenting" | "segmented" | "split-pending" | "split" | "failed";
  rows: ReviewRow[];
  unassignedPages: number[];
  rawSegmentResponse: unknown;
  rawSplitResponse: unknown;
  error: string | null;
}

/** Stage 2's per-student split result, as returned by the split route. */
interface SplitResult {
  invitedId: string;
  label: string;
  status: "split" | "failed";
  packetScanId?: string;
  error?: string;
}

/** Stage 4's crop lifecycle for one already-split student. progress is only
 *  set while the paged-anchor fallback is running (see handleCrop) so the
 *  UI can show "N of M anchors" instead of a bare spinner during a slow,
 *  chunked run. */
interface CropState {
  status: "idle" | "cropping" | "done" | "failed";
  rawResponse: unknown;
  error: string | null;
  progress?: { done: number; total: number } | null;
}

/** One crop as listed by GET /api/na-review/packet-scans/[id]/assess. */
interface AssessCropListItem {
  cropId: string;
  qid: string;
  sortOrder: number;
  questionText: string | null;
  isBlank: boolean;
  possiblyTruncated: boolean;
  imageUrl: string | null;
  /** A crop of the printed question prompt itself, as it appears on the
   *  page -- distinct from questionText (plain text). Null for most
   *  sub-parts of a multi-part question, whose own prompt is just a few
   *  points of blank space above their box, not a separate printed block. */
  promptImageUrl: string | null;
  alreadyAssessed: boolean;
  verdict: string | null;
  marksAwarded: number | null;
  marksAvailable: number | null;
  transcription: string | null;
  marginComment: string | null;
  nextStep: string | null;
  teacherNote: string | null;
  confidence: number | null;
  misconceptionTags: string[];
}

/** Stage 5's per-crop assessment lifecycle, keyed by cropId. Carries the
 *  full explanation (transcription, margin comment, next step, teacher
 *  note) alongside the bare verdict/marks -- a real bug found in review:
 *  na_feedback already had a specific, careful explanation for a lost
 *  mark, but the UI only ever showed the number. See the listing route's
 *  comments for the full story. */
interface AssessCropState {
  status: "idle" | "assessing" | "assessed" | "skipped" | "failed";
  verdict: string | null;
  marksAwarded: number | null;
  marksAvailable: number | null;
  reason: string | null;
  rawResponse: unknown;
  transcription: string | null;
  marginComment: string | null;
  nextStep: string | null;
  teacherNote: string | null;
  confidence: number | null;
  misconceptionTags: string[];
}

/** Stage 5's lifecycle for one already-cropped student, as a whole panel. */
interface AssessPanelState {
  status: "idle" | "loading-list" | "ready" | "assessing-all";
  crops: AssessCropListItem[];
  error: string | null;
}

/** A batch listed by GET /api/na-review/batch?packetVersionId=... -- used
 *  to populate the "recent batches" picker so a teacher doesn't need to
 *  know or paste a batchId by hand. */
interface RecentBatch {
  id: string;
  status: string;
  source_filename: string | null;
  page_count: number | null;
  created_at: string;
  parent_batch_id?: string | null;
}

/** One student's row in the results-by-class summary, as returned by
 *  GET /api/na-review/packet-version/[packetVersionId]/results. Keyed by
 *  packetScanId, not invitedId -- a student could in principle have more
 *  than one scan for the same packet version (see HANDOFF.md's duplicate
 *  batch history), and each scan's own progress is what matters here. */
interface ResultsStudentRow {
  packetScanId: string;
  studentName: string;
  courseId: string | null;
  courseName: string;
  status: string;
  totalCrops: number;
  assessedCount: number;
  totalGradable: number;
  marksAwarded: number;
  marksAvailable: number;
}

interface ResultsCourse {
  courseId: string | null;
  courseName: string;
  students: ResultsStudentRow[];
}

interface ResultsData {
  totalGradable: number;
  totalMarksAvailable: number;
  courses: ResultsCourse[];
}

interface ResultsPanelState {
  status: "idle" | "loading" | "ready" | "failed";
  data: ResultsData | null;
  error: string | null;
}

/** Live progress for one running autoCropAndAssessAll call, keyed by
 *  panelKey (a top-level batchId or a chunk's batchId) so the "is this
 *  still running" banner can answer that question at a glance instead of
 *  leaving a teacher staring at a status line that hasn't visibly changed
 *  in a while -- each of a student's ~40 crops is its own Claude call, so
 *  tens of seconds of apparent silence between status-line updates is
 *  normal, not a hang. Deleted from the autoRuns map the moment the run
 *  ends (success or not), so the banner's mere presence answers "is it
 *  still going" without needing a separate boolean. */
interface AutoRunInfo {
  startedAt: number;
  totalStudents: number;
  studentIndex: number; // 0-based index of the student currently being processed
  studentLabel: string;
  currentScanId: string | null;
  stage: "cropping" | "assessing";
  /** Ordered packetScanIds for whichever stage is currently running --
   *  the cropping cohort while stage is "cropping", replaced with the
   *  (possibly smaller, since a crop failure drops a student) assessing
   *  cohort once assessment starts. Drives the chunked per-student
   *  progress bar so a teacher can see how far in the batch actually is,
   *  not just which single student is active right now. */
  scanIds: string[];
}

const CONFIDENCE_STYLE: Record<Confidence, string> = {
  high: "bg-green-100 text-green-800 border-green-300",
  medium: "bg-amber-100 text-amber-800 border-amber-300",
  low: "bg-red-100 text-red-800 border-red-300",
};

const VERDICT_STYLE: Record<string, string> = {
  correct: "bg-green-100 text-green-800 border-green-300",
  partial: "bg-amber-100 text-amber-800 border-amber-300",
  incorrect: "bg-red-100 text-red-800 border-red-300",
  unclear: "bg-gray-100 text-gray-700 border-gray-300",
};

const SELECT_CLASS =
  "block w-full rounded-lg border border-da-border bg-white px-3 py-2 text-sm font-medium text-gray-900 shadow-sm focus:border-da-accent focus:outline-none focus:ring-1 focus:ring-da-accent";
const INPUT_CLASS =
  "rounded-lg border border-da-border bg-white px-2 py-1 text-sm font-medium text-gray-900 shadow-sm focus:border-da-accent focus:outline-none focus:ring-1 focus:ring-da-accent disabled:bg-gray-50";

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** fetch + res.json() with bounded retries, used by every stage-4/5 call in
 *  the automated pipeline below. Retries on a network error, a non-2xx
 *  response, AND a non-JSON body -- that last case is exactly what a
 *  platform request timeout looks like (Vercel returns a plain-text/HTML
 *  page instead of the route's JSON), and is the root cause behind the
 *  cryptic "Unexpected token... is not valid JSON" errors this page used to
 *  surface verbatim. A timeout is very often transient, so retrying the
 *  same request first (before any chunking fallback) is usually enough.
 *  Never retries a request that already succeeded -- only failures loop. */
async function fetchJsonWithRetry(
  url: string,
  init: RequestInit,
  { retries = 2, backoffMs = 1200 }: { retries?: number; backoffMs?: number } = {}
): Promise<{ ok: boolean; status: number; data: any }> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, init);
      let data: unknown = null;
      let parseError: unknown = null;
      try {
        data = await res.json();
      } catch (e) {
        parseError = e;
      }
      if (parseError !== null) {
        if (attempt < retries) {
          await sleep(backoffMs * 2 ** attempt);
          continue;
        }
        throw new Error(
          `Server returned a non-JSON response (HTTP ${res.status}) -- most likely a request timeout, not a real error. Try again.`
        );
      }
      if (!res.ok && attempt < retries) {
        await sleep(backoffMs * 2 ** attempt);
        continue;
      }
      return { ok: res.ok, status: res.status, data };
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        await sleep(backoffMs * 2 ** attempt);
        continue;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Request failed after retries.");
}

/** Roster option label, e.g. "Freya Delisle — 9A", or just the name if the class is unknown. */
function rosterOptionLabel(s: RosterEntry): string {
  return s.courseName ? `${s.fullName} — ${s.courseName}` : s.fullName;
}

/** Builds ReviewRow[] from a batch's proposed_segments/confirmed_segments
 *  JSONB, and optionally overlays known packetScanIds so already-split
 *  rows carry the invitedId a confirmed segment recorded. Shared by the
 *  initial POST /batch response handling and by loadBatch() below so the
 *  two paths can't silently drift apart. */
function segmentsToRows(segments: ProposedSegment[] | { label: string; pages: number[]; invitedId: string }[]): ReviewRow[] {
  return segments.map((s, i) => {
    const invitedId =
      "invitedId" in s ? s.invitedId : (s as ProposedSegment).matchedInvitedId ?? "";
    const confidence = "confidence" in s ? (s as ProposedSegment).confidence : "high";
    const note = "note" in s ? (s as ProposedSegment).note : "";
    return {
      key: `${i}-${s.label}`,
      label: s.label,
      pages: s.pages,
      confidence,
      note,
      invitedId,
    };
  });
}

/** Gate for the automated pipeline's "skip the review click" fast path:
 *  every row must be matched, unique, non-conflicting, AND high confidence.
 *  Anything less -- an ambiguous handwriting read, a duplicate/missing
 *  match -- stops here and waits for one manual "Confirm & split" instead
 *  of silently grading a page under the wrong student's name. Only ever
 *  called with freshly-computed rows (never component state), since it
 *  runs the instant stage 1 returns, before any state update has
 *  committed. */
function rowsReadyForAutoSplit(rows: ReviewRow[]): boolean {
  if (rows.length === 0) return false;
  if (!rows.every((r) => r.invitedId && r.pages.length > 0)) return false;
  if (!rows.every((r) => r.confidence === "high")) return false;
  if (new Set(rows.map((r) => r.invitedId)).size !== rows.length) return false;
  const owners = new Map<number, number>();
  for (const r of rows) for (const p of r.pages) owners.set(p, (owners.get(p) ?? 0) + 1);
  if ([...owners.values()].some((n) => n > 1)) return false;
  return true;
}

/**
 * Type-to-filter student picker, replacing a plain <select>. A roster of
 * ~50 names (and growing as more classes are pooled onto a track) is slow
 * to scan by scrolling -- a native <select> only jumps to the next option
 * starting with whatever key was last pressed, which doesn't help for a
 * name like "Ines Palomino" if the list is already scrolled elsewhere.
 * This filters on every keystroke against name AND class, so typing "9c"
 * narrows to that class and typing part of a name narrows to matches
 * anywhere in the name (not just a prefix).
 */
function StudentPicker({
  roster,
  value,
  onChange,
  disabled,
}: {
  roster: RosterEntry[];
  value: string; // invitedId, "" if none picked
  onChange: (invitedId: string) => void;
  disabled: boolean;
}) {
  const selected = roster.find((s) => s.id === value) ?? null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // What the input actually shows: the selected student's label while
  // closed/unfocused, or the in-progress search text while typing.
  const displayValue = open ? query : selected ? rosterOptionLabel(selected) : "";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter((s) => rosterOptionLabel(s).toLowerCase().includes(q));
  }, [roster, query]);

  useEffect(() => {
    setHighlighted(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const pick = (s: RosterEntry) => {
    onChange(s.id);
    setOpen(false);
    setQuery("");
  };

  const clear = () => {
    onChange("");
    setOpen(false);
    setQuery("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const s = filtered[highlighted];
      if (s) pick(s);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setQuery("");
      inputRef.current?.blur();
    } else if (e.key === "Backspace" && query === "" && selected) {
      // Backspacing on an already-picked student clears the pick, matching
      // the intuitive "delete to change my answer" behaviour of a normal
      // text field rather than requiring a separate clear action first.
      clear();
    }
  };

  return (
    <div ref={containerRef} className="relative w-full min-w-[16rem]">
      <input
        ref={inputRef}
        type="text"
        value={displayValue}
        disabled={disabled}
        placeholder="Type a name…"
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!open) setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        className={`w-full ${SELECT_CLASS} ${!selected && !open ? "text-gray-400" : ""}`}
      />
      {open && !disabled && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-da-border bg-white shadow-lg"
        >
          <li>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={clear}
              className="block w-full px-3 py-1.5 text-left text-sm text-gray-500 hover:bg-gray-100"
            >
              — pick a student —
            </button>
          </li>
          {filtered.length === 0 && (
            <li className="px-3 py-1.5 text-sm text-gray-400">No students match &ldquo;{query}&rdquo;</li>
          )}
          {filtered.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(s)}
                onMouseEnter={() => setHighlighted(i)}
                className={`block w-full px-3 py-1.5 text-left text-sm ${
                  i === highlighted ? "bg-da-accent/10 text-gray-900" : "text-gray-900 hover:bg-gray-100"
                } ${s.id === value ? "font-semibold" : ""}`}
              >
                {rosterOptionLabel(s)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ScanTestClient({ versions }: { versions: PacketVersionOption[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [versionId, setVersionId] = useState(versions[0]?.id ?? "");
  const version = versions.find((v) => v.id === versionId) ?? null;

  const [error, setError] = useState<string | null>(null);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [loadingBatch, setLoadingBatch] = useState(false);

  // Non-chunked path: a single batch, same shape as before.
  const [batchId, setBatchId] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [unassignedPages, setUnassignedPages] = useState<number[]>([]);
  const [rawStage1, setRawStage1] = useState<unknown>(null);
  const [splitting, setSplitting] = useState(false);
  const [rawStage2, setRawStage2] = useState<unknown>(null);
  const [splitResults, setSplitResults] = useState<SplitResult[]>([]);

  // Stage 4: crop lifecycle per packetScanId, only for students stage 2
  // actually split successfully (a packetScanId is what stage 4 needs to
  // look up the split PDF and the packet's locked anchors).
  const [cropState, setCropState] = useState<Record<string, CropState>>({});
  // "Crop all" running per SplitResult[] batch -- keyed by a stable id (the
  // batchId, or a chunk's batchId) so multiple crop panels on screen (one
  // per chunk) can each show their own "Cropping X of Y" progress without
  // interfering with each other.
  const [cropAllRunning, setCropAllRunning] = useState<Record<string, boolean>>({});

  // Live progress for the automated pipeline -- see AutoRunInfo's comment.
  // A live-ticking clock (updated every second while anything is running,
  // otherwise left alone) drives the elapsed-time display without needing
  // every autoRuns update to itself carry a fresh timestamp.
  const [autoRuns, setAutoRuns] = useState<Record<string, AutoRunInfo>>({});
  const [autoRunClockTick, setAutoRunClockTick] = useState(0);
  useEffect(() => {
    if (Object.keys(autoRuns).length === 0) return;
    const id = setInterval(() => setAutoRunClockTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [Object.keys(autoRuns).length > 0]);

  // Server-side ledger row for the currently-running (or resumed)
  // automatic pipeline, keyed by the same panelKey as autoRuns -- a
  // top-level batchId or a chunk's own batchId. This is what makes the run
  // survive a closed tab: the browser's own JS loop is still what drives
  // each crop/assess call (nothing runs server-side without it), but every
  // step's progress lands in na_batch_runs too, so a teacher who comes back
  // sees an accurate "still going" / "finished" state even before the
  // client-side resume (loadBatch + the splitResults effect below) has had
  // a chance to re-derive it from na_packet_scans.
  const [batchRunIds, setBatchRunIds] = useState<Record<string, string>>({});

  // Stage 5: one AssessPanelState per packetScanId (the whole student's
  // crop list + its loading state) and one AssessCropState per cropId
  // (each individual question's live assessment status). Kept separate
  // because the panel can be "loading its crop list" while individual
  // crops are still "idle", and because "assess all" needs to track
  // progress across every crop in a panel independently of any other
  // panel on screen (mirrors cropAllRunning's per-panelKey approach).
  const [assessPanels, setAssessPanels] = useState<Record<string, AssessPanelState>>({});
  const [assessCropState, setAssessCropState] = useState<Record<string, AssessCropState>>({});

  // Chunked path: an oversized upload split into several chunks, each
  // going through its own segment -> review -> split lifecycle.
  const [parentBatchId, setParentBatchId] = useState<string | null>(null);
  const [chunks, setChunks] = useState<ChunkState[]>([]);
  const [presplitWarnings, setPresplitWarnings] = useState<string[]>([]);

  // Recent batches for this packet version, so a teacher can pick their way
  // back into an in-progress batch instead of needing to know its UUID.
  const [recentBatches, setRecentBatches] = useState<RecentBatch[]>([]);
  const [recentBatchesLoading, setRecentBatchesLoading] = useState(false);

  // Results-by-class summary for the selected packet version -- independent
  // of any particular upload batch, since a student's assessed work can
  // (and in A.1's case, did) end up split across more than one batch. Starts
  // collapsed so it doesn't fire a request the moment this page loads.
  const [resultsOpen, setResultsOpen] = useState(false);
  const [resultsPanel, setResultsPanel] = useState<ResultsPanelState>({ status: "idle", data: null, error: null });
  // Which student row in the results-by-class table has its Stage 5 detail
  // expanded inline -- keyed by packetScanId, independent of which batch
  // (if any) is currently loaded on the rest of this page, since results-
  // by-class already spans every batch that's ever split a scan for this
  // packet version.
  const [expandedResultScanId, setExpandedResultScanId] = useState<string | null>(null);

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
    setSplitResults([]);
    setCropState({});
    setCropAllRunning({});
    setAssessPanels({});
    setAssessCropState({});
    setBatchRunIds({});
    setParentBatchId(null);
    setChunks([]);
    setPresplitWarnings([]);
    setStatusLine(null);
    setError(null);
  };

  /** Writes ?batchId=... into the URL (replace, not push, so Back doesn't
   *  step through every intermediate stage transition) whenever a batch
   *  exists to reload, and clears it when reset(). This is the actual
   *  persistence: a page refresh or a bookmarked/shared link re-triggers
   *  loadBatch() below via the effect that watches searchParams. */
  const syncUrl = useCallback(
    (id: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (id) params.set("batchId", id);
      else params.delete("batchId");
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const fetchRecentBatches = useCallback(async (packetVersionId: string) => {
    setRecentBatchesLoading(true);
    try {
      const res = await fetch(`/api/na-review/batch?packetVersionId=${encodeURIComponent(packetVersionId)}`);
      const data = await res.json();
      if (res.ok) setRecentBatches(data.batches ?? []);
    } catch {
      // Non-critical -- the picker just stays empty; the teacher can still
      // paste a batchId into the URL directly if they have one.
    } finally {
      setRecentBatchesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (version) void fetchRecentBatches(version.id);
  }, [version, fetchRecentBatches]);

  const fetchResults = useCallback(async (packetVersionId: string) => {
    setResultsPanel((prev) => ({ ...prev, status: "loading" }));
    try {
      const res = await fetch(`/api/na-review/packet-version/${packetVersionId}/results`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load results.");
      setResultsPanel({ status: "ready", data, error: null });
    } catch (e) {
      setResultsPanel({ status: "failed", data: null, error: e instanceof Error ? e.message : "Could not load results." });
    }
  }, []);

  // Reset to collapsed/idle on version change so a stale packet's results
  // can't be mistaken for the newly selected one before a refetch.
  useEffect(() => {
    setResultsOpen(false);
    setResultsPanel({ status: "idle", data: null, error: null });
  }, [versionId]);

  /** Seeds crop state from a packetScansByInvitedId map (as returned by
   *  GET .../batch/[batchId]) for every row that already has a
   *  packetScanId, and returns the SplitResult[] shape the crop panel
   *  renderer expects -- so a reloaded already-split batch shows the same
   *  "Crop this student" panel a fresh split would, without re-splitting. */
  const applyPacketScans = (
    currentRows: ReviewRow[],
    packetScansByInvitedId: Record<string, { packetScanId: string; status: string }>
  ): SplitResult[] => {
    const results: SplitResult[] = currentRows.map((r) => {
      const scan = packetScansByInvitedId[r.invitedId];
      return scan
        ? { invitedId: r.invitedId, label: r.label, status: "split" as const, packetScanId: scan.packetScanId }
        : { invitedId: r.invitedId, label: r.label, status: "failed" as const, error: "Not split yet" };
    });
    setCropState((prev) => ({
      ...prev,
      ...Object.fromEntries(
        results
          .filter((r) => r.status === "split" && r.packetScanId)
          .map((r) => [
            r.packetScanId as string,
            {
              status: packetScansByInvitedId[r.invitedId]?.status === "cropped" ? "done" : "idle",
              rawResponse: null,
              error: null,
            } as CropState,
          ])
      ),
    }));
    return results;
  };

  /** Reloads one batch from GET /api/na-review/batch/[batchId] and
   *  reconstructs every piece of state a fresh upload->segment->split run
   *  would have produced -- the actual fix for the harness losing its
   *  place on refresh. Handles both a plain batch and one that's part of
   *  a chunked parent upload. */
  const loadBatch = useCallback(
    async (id: string) => {
      setLoadingBatch(true);
      setError(null);
      try {
        const res = await fetch(`/api/na-review/batch/${id}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not load this batch.");

        const b = data.batch as {
          id: string;
          packet_version_id: string;
          status: string;
          page_count: number | null;
          proposed_segments: ProposedSegment[] | null;
          confirmed_segments: { label: string; pages: number[]; invitedId: string }[] | null;
          unassigned_pages: number[] | null;
          parent_batch_id: string | null;
          chunk_index: number | null;
          chunk_count: number | null;
        };
        const packetScansByInvitedId = data.packetScansByInvitedId ?? {};
        const siblingChunks: { id: string; chunk_index: number | null; chunk_count: number | null; status: string }[] =
          data.siblingChunks ?? [];

        if (b.packet_version_id !== versionId) setVersionId(b.packet_version_id);

        if (b.parent_batch_id || siblingChunks.length > 0) {
          // This batch is one chunk of a larger upload. Reload every
          // sibling chunk individually (each may be at a different stage)
          // rather than trying to reconstruct the whole chunked view from
          // this one response.
          setParentBatchId(b.parent_batch_id ?? b.id);
          const chunkIds = siblingChunks.length > 0 ? siblingChunks.map((c) => c.id) : [b.id];
          const loaded: ChunkState[] = [];
          for (const chunkId of chunkIds) {
            const cRes = await fetch(`/api/na-review/batch/${chunkId}`);
            const cData = await cRes.json();
            if (!cRes.ok) continue;
            const cb = cData.batch;
            const cRows = segmentsToRows(cb.confirmed_segments ?? cb.proposed_segments ?? []);
            const cResults =
              cb.status === "split" ? applyPacketScans(cRows, cData.packetScansByInvitedId ?? {}) : [];
            loaded.push({
              batchId: cb.id,
              chunkIndex: cb.chunk_index ?? 1,
              chunkCount: cb.chunk_count ?? chunkIds.length,
              startPage: 0,
              endPage: cb.page_count ?? 0,
              storagePath: "",
              status:
                cb.status === "split"
                  ? "split"
                  : cb.status === "segmented"
                    ? "segmented"
                    : cb.status === "failed"
                      ? "failed"
                      : "pending",
              rows: cRows,
              unassignedPages: cb.unassigned_pages ?? [],
              rawSegmentResponse: null,
              rawSplitResponse: cb.status === "split" ? { results: cResults } : null,
              error: cb.error_message ?? null,
            });
          }
          setChunks(loaded.sort((a, b2) => a.chunkIndex - b2.chunkIndex));
          setStatusLine(`Reloaded batch ${b.id.slice(0, 8)}… (part of a ${chunkIds.length}-chunk upload).`);
          syncUrl(b.id);
          return;
        }

        setBatchId(b.id);
        setPageCount(b.page_count);
        setUnassignedPages(b.unassigned_pages ?? []);

        const reconstructedRows = segmentsToRows(b.confirmed_segments ?? b.proposed_segments ?? []);
        setRows(reconstructedRows);

        if (b.status === "split" || b.status === "cropped" || b.status === "assessed") {
          const results = applyPacketScans(reconstructedRows, packetScansByInvitedId);
          setSplitResults(results);
          setRawStage2({ batchId: b.id, results, note: "Reloaded from a prior session." });
          setStatusLine(
            `Reloaded batch ${b.id.slice(0, 8)}… — already split (${results.filter((r) => r.status === "split").length} student(s)). Stage 4/5 panels are below.`
          );
        } else if (b.status === "segmented") {
          setStatusLine(`Reloaded batch ${b.id.slice(0, 8)}… — segmented, not yet split. Review and confirm below.`);
        } else {
          setStatusLine(`Reloaded batch ${b.id.slice(0, 8)}… — status: ${b.status}.`);
        }
        syncUrl(b.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load this batch.");
      } finally {
        setLoadingBatch(false);
      }
    },
    [versionId, syncUrl]
  );

  // On mount (and whenever the URL's batchId changes, e.g. Back/Forward or
  // a pasted link), load that batch if we don't already have it in state.
  useEffect(() => {
    const urlBatchId = searchParams.get("batchId");
    if (urlBatchId && urlBatchId !== batchId && chunks.every((c) => c.batchId !== urlBatchId) && !loadingBatch) {
      void loadBatch(urlBatchId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Checks the server-side ledger for a run already in progress on this
  // batch as soon as its id is in the URL -- lets the pipeline below reuse
  // that same na_batch_runs row (via ensureBatchRun) instead of starting a
  // fresh one, and surfaces a "resuming" status line right away, before
  // loadBatch's own splitResults reconstruction (which is what actually
  // re-derives per-student progress from na_packet_scans) has finished.
  useEffect(() => {
    const urlBatchId = searchParams.get("batchId");
    if (!urlBatchId) return;
    (async () => {
      try {
        const res = await fetch(`/api/na-review/batch-runs?batchId=${encodeURIComponent(urlBatchId)}`);
        const data = await res.json();
        if (!res.ok) return;
        const active = (data.runs ?? []).find(
          (r: { status: string }) => r.status === "active" || r.status === "paused"
        );
        if (active) {
          setBatchRunIds((prev) => (prev[urlBatchId] ? prev : { ...prev, [urlBatchId]: active.id }));
          setStatusLine(
            `Resuming a batch run already in progress on the server (${active.studentsDone}/${active.totalStudents} students done, stage: ${active.stage})…`
          );
        }
      } catch {
        // Non-critical -- if this fails, autoCropAndAssessAll's own POST
        // (idempotent against any existing run) still finds and reuses the
        // same row once it starts.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Automated pipeline (stage 4 crop + stage 5 assess), driven off split
  // results rather than called inline right after performSplit -- see
  // autoCropAndAssessAll's own comment for why: this component's async
  // handlers don't re-render between steps, so reading cropState back out
  // of the same closure right after a split would risk seeing a stale
  // snapshot. An effect instead runs fresh each time splitResults actually
  // changes, which happens exactly when a split completes -- whether that
  // was a fresh upload with all-high-confidence matches, a manual "Confirm
  // & split" click after reviewing flagged rows, or reloading a batch that
  // was already split in an earlier session (the "survives closing the
  // tab" resume case). The ref guards against firing twice for one batch.
  const autoStartedBatchRef = useRef<string | null>(null);
  useEffect(() => {
    if (!batchId || splitResults.length === 0) return;
    if (autoStartedBatchRef.current === batchId) return;
    autoStartedBatchRef.current = batchId;
    void autoCropAndAssessAll(batchId, splitResults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId, splitResults]);

  // Same idea for the chunked upload path, tracked per chunk batchId since
  // each chunk finishes its own split independently.
  const autoStartedChunksRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const c of chunks) {
      if (c.status !== "split") continue;
      if (autoStartedChunksRef.current.has(c.batchId)) continue;
      const results = (c.rawSplitResponse as { results?: SplitResult[] })?.results ?? [];
      if (results.length === 0) continue;
      autoStartedChunksRef.current.add(c.batchId);
      void autoCropAndAssessAll(c.batchId, results);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chunks]);

  const updateChunk = (batchId: string, patch: Partial<ChunkState>) =>
    setChunks((prev) => prev.map((c) => (c.batchId === batchId ? { ...c, ...patch } : c)));

  /** Runs stage 1 (segmentation) for one chunk by calling the same route
   *  with its own storagePath. Returns the resulting chunk (merged with
   *  whatever patch was applied) rather than relying on the caller to read
   *  it back out of chunks state -- handleUpload's loop needs the freshly
   *  segmented rows immediately, in the same tick, to decide whether this
   *  chunk qualifies for auto-split, and component state doesn't update
   *  synchronously. */
  const segmentChunk = async (chunk: ChunkState): Promise<ChunkState> => {
    if (!version) return chunk;
    updateChunk(chunk.batchId, { status: "segmenting" });
    try {
      const res = await fetch("/api/na-review/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packetVersionId: version.id,
          storagePath: chunk.storagePath,
          fileName: `chunk-${chunk.chunkIndex}.pdf`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Segmentation failed for this chunk.");
      if (data.chunked) {
        // A chunk should never itself be oversized (it was built to fit
        // under MAX_BATCH_PAGES), but guard against a planning bug rather
        // than silently mishandling an unexpected nested chunk response.
        throw new Error("This chunk came back oversized again — unexpected, please report this.");
      }

      const segments: ProposedSegment[] = data.segments ?? [];
      const patch: Partial<ChunkState> = {
        status: "segmented",
        rows: segmentsToRows(segments),
        unassignedPages: data.unassignedPages ?? [],
        rawSegmentResponse: data,
      };
      updateChunk(chunk.batchId, patch);
      return { ...chunk, ...patch };
    } catch (e) {
      const patch: Partial<ChunkState> = {
        status: "failed",
        error: e instanceof Error ? e.message : "Segmentation failed.",
      };
      updateChunk(chunk.batchId, patch);
      return { ...chunk, ...patch };
    }
  };

  const handleUpload = async (file: File) => {
    if (!version) {
      setError("Pick a packet version first.");
      return;
    }
    setUploading(true);
    setError(null);
    reset();
    syncUrl(null);

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

      setUploadProgress("Checking size and reading cover pages — can take a minute…");
      const res = await fetch("/api/na-review/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packetVersionId: version.id, storagePath, fileName: file.name }),
      });
      const data = await res.json();
      setRawStage1(data);
      if (!res.ok) throw new Error(data.error ?? "Segmentation failed.");

      if (data.chunked) {
        // Oversized upload: the route already split it into whole-packet
        // chunks. Set up chunk state, then segment each one in turn (one
        // request per chunk, so no single request risks the function
        // timeout that motivated NOT segmenting all chunks server-side).
        setParentBatchId(data.parentBatchId);
        setPresplitWarnings(data.warnings ?? []);
        const initialChunks: ChunkState[] = (data.chunks ?? []).map(
          (c: { batchId: string; chunkIndex: number; startPage: number; endPage: number; storagePath: string }, i: number) => ({
            batchId: c.batchId,
            chunkIndex: c.chunkIndex,
            chunkCount: data.chunks.length,
            startPage: c.startPage,
            endPage: c.endPage,
            storagePath: c.storagePath,
            status: "pending" as const,
            rows: [],
            unassignedPages: [],
            rawSegmentResponse: null,
            rawSplitResponse: null,
            error: null,
          })
        );
        setChunks(initialChunks);
        setStatusLine(
          `This scan was too large for one batch (${data.pageCount} pages). Split automatically into ${initialChunks.length} chunks of whole student packets. Segmenting each in turn…`
        );
        syncUrl(data.parentBatchId);

        // Segment chunks sequentially -- each is its own request with its
        // own time budget, so a slow model response on one chunk can't
        // starve the others. A chunk whose matches are ALL high confidence
        // continues straight into split + crop + assess with no further
        // clicks; anything less-confident stops at "segmented" for a
        // quick manual review (the button is right there on that chunk's
        // card) and only THAT chunk waits -- the rest keep going.
        let autoCount = 0;
        let reviewCount = 0;
        for (const c of initialChunks) {
          setStatusLine(`Segmenting chunk ${c.chunkIndex} of ${initialChunks.length} (pages ${c.startPage}-${c.endPage})…`);
          const segmented = await segmentChunk(c);
          if (segmented.status === "segmented" && rowsReadyForAutoSplit(segmented.rows)) {
            autoCount++;
            setStatusLine(
              `Chunk ${c.chunkIndex}: all matches high-confidence — splitting, cropping and assessing automatically…`
            );
            await handleSplitChunk(segmented);
          } else if (segmented.status === "segmented") {
            reviewCount++;
          }
        }
        setStatusLine(
          `All ${initialChunks.length} chunk(s) segmented. ${autoCount} running automatically end-to-end.` +
            (reviewCount > 0
              ? ` ${reviewCount} chunk(s) have a not-quite-high-confidence match and need a quick look below before continuing.`
              : "")
        );
      } else {
        const segments: ProposedSegment[] = data.segments ?? [];
        const newRows = segmentsToRows(segments);
        setBatchId(data.batchId);
        setPageCount(data.pageCount);
        setUnassignedPages(data.unassignedPages ?? []);
        setRows(newRows);
        const poolNote =
          data.rosterIsTrack && version.rosterSourceCourseNames.length
            ? ` (pooled from ${version.rosterSourceCourseNames.join(", ")})`
            : "";
        syncUrl(data.batchId);
        void fetchRecentBatches(version.id);

        if (rowsReadyForAutoSplit(newRows)) {
          setStatusLine(
            `Stage 1 done. Found ${segments.length} student(s), all high-confidence matches — splitting, cropping and assessing automatically…`
          );
          await splitBatch(data.batchId, newRows);
        } else {
          setStatusLine(
            `Stage 1 done. Found ${segments.length} student(s) across ${data.pageCount} pages, roster size ${data.rosterSize}${poolNote}. Some matches aren't high-confidence — review below, then Confirm & split to continue automatically.`
          );
        }
      }
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

  // -- Non-chunked row editing (unchanged) -------------------------------------
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

  /** Does the actual stage-2 network call and state updates for the
   *  non-chunked path. Takes targetBatchId/targetRows explicitly rather
   *  than reading batchId/rows off component state, so handleUpload's
   *  auto-split path can call this the instant stage 1 returns -- using
   *  freshly computed local values, before setBatchId/setRows have even
   *  committed -- without waiting on a state update that hasn't happened
   *  yet. handleSplit (the button's onClick) just forwards current state
   *  into this. Returns the split results so the caller can decide what to
   *  do next; the actual "kick off stage 4/5 automatically" step happens
   *  in the useEffect watching splitResults, not here, so it behaves
   *  identically whether the split was triggered automatically or by
   *  clicking "Confirm & split". */
  const splitBatch = async (targetBatchId: string, targetRows: ReviewRow[]): Promise<SplitResult[] | null> => {
    setSplitting(true);
    setError(null);
    setStatusLine("Splitting the batch PDF and creating na_packet_scans rows…");
    try {
      const res = await fetch(`/api/na-review/batch/${targetBatchId}/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segments: targetRows.map((r) => ({ label: r.label, pages: r.pages, invitedId: r.invitedId })),
        }),
      });
      const data = await res.json();
      setRawStage2(data);
      if (!res.ok) throw new Error(data.error ?? "Split failed.");
      const results: SplitResult[] = data.results ?? [];
      setSplitResults(results);
      // Seed crop state for every successfully split student so the stage
      // 4 panel can render "Crop" buttons immediately.
      setCropState(
        Object.fromEntries(
          results
            .filter((r) => r.status === "split" && r.packetScanId)
            .map((r) => [r.packetScanId as string, { status: "idle", rawResponse: null, error: null } as CropState])
        )
      );
      setStatusLine(
        `Stage 2 done. ${data.splitCount} split, ${data.failedCount} failed. Cropping and assessing automatically below.`
      );
      return results;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Split failed.");
      return null;
    } finally {
      setSplitting(false);
    }
  };

  const handleSplit = async () => {
    if (!batchId || !canSplit) return;
    await splitBatch(batchId, rows);
  };

  const CROP_PAGE_SIZE = 12;

  /** Stage 4 for one already-split student: calls the crop route by
   *  packetScanId. Two layers of resilience, tried in order of cost --
   *  "most efficient method first, fall back only on error" per the
   *  automation design:
   *
   *  1. One whole-student request (fewest round trips). fetchJsonWithRetry
   *     already retries this a couple of times on a transient failure or a
   *     timeout's non-JSON response, which resolves most of what used to
   *     surface as "Unexpected token... is not valid JSON".
   *  2. If that still fails, page through this student's anchors in small
   *     batches (CROP_PAGE_SIZE at a time) via the crop route's offset/limit
   *     support -- each request is small enough to comfortably finish
   *     inside the platform's function-duration cap even when the
   *     whole-student call doesn't. Resumes from wherever a PRIOR failed
   *     paged run left off (this crop state's own progress), so retrying
   *     doesn't redo anchors that already saved. Neither layer costs
   *     anything beyond normal hosting compute -- crop extraction is
   *     deterministic image processing, not a Claude call.
   *
   *  Returns the final outcome so callers (handleCropAll, the automated
   *  pipeline) can act on it without reading component state back out of a
   *  stale closure. */
  const handleCrop = async (packetScanId: string): Promise<"done" | "failed"> => {
    const resumeFrom = cropState[packetScanId]?.progress?.done ?? 0;
    setCropState((prev) => ({
      ...prev,
      [packetScanId]: { status: "cropping", rawResponse: null, error: null, progress: prev[packetScanId]?.progress ?? null },
    }));

    if (resumeFrom === 0) {
      try {
        const full = await fetchJsonWithRetry(`/api/na-review/packet-scans/${packetScanId}/crop`, { method: "POST" });
        if (full.ok) {
          setCropState((prev) => ({
            ...prev,
            [packetScanId]: { status: "done", rawResponse: full.data, error: null, progress: null },
          }));
          return "done";
        }
      } catch {
        /* whole-student attempt exhausted its own retries -- fall through to paging */
      }
    }

    // Paged fallback: crop this student's anchors a page at a time.
    let offset = resumeFrom;
    let lastData: any = null;
    const maxPages = 50; // safety net against an unexpected infinite loop, not a real limit at ~40 anchors/student
    for (let page = 0; page < maxPages; page++) {
      try {
        const res = await fetchJsonWithRetry(
          `/api/na-review/packet-scans/${packetScanId}/crop`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ offset, limit: CROP_PAGE_SIZE }),
          },
          { retries: 2, backoffMs: 1500 }
        );
        if (!res.ok) throw new Error(res.data?.error ?? `Crop failed (HTTP ${res.status}).`);
        lastData = res.data;
        const total = res.data?.totalAnchors ?? 0;
        const done = res.data?.totalSaved ?? 0;
        setCropState((prev) => ({
          ...prev,
          [packetScanId]: { status: "cropping", rawResponse: res.data, error: null, progress: { done, total } },
        }));
        if (res.data?.allAnchorsCropped) {
          setCropState((prev) => ({
            ...prev,
            [packetScanId]: { status: "done", rawResponse: res.data, error: null, progress: null },
          }));
          return "done";
        }
        offset += CROP_PAGE_SIZE;
      } catch (e) {
        setCropState((prev) => ({
          ...prev,
          [packetScanId]: {
            status: "failed",
            rawResponse: lastData,
            error: e instanceof Error ? e.message : "Crop extraction failed.",
            progress: prev[packetScanId]?.progress ?? null,
          },
        }));
        return "failed";
      }
    }
    setCropState((prev) => ({
      ...prev,
      [packetScanId]: {
        status: "failed",
        rawResponse: lastData,
        error: "Gave up after an unexpectedly large number of anchor pages -- please report this.",
        progress: prev[packetScanId]?.progress ?? null,
      },
    }));
    return "failed";
  };

  /** Runs stage 4 for every not-yet-cropped student in a split batch, one
   *  at a time -- same "sequential, own budget each, one slow/failed
   *  student can't block the rest" reasoning already used for chunk
   *  segmentation above. panelKey identifies which crop panel is running
   *  (a top-level batchId or a chunk's batchId) so several panels on
   *  screen at once (chunked uploads) track "running" independently and a
   *  second click on a different panel isn't blocked by the first. Skips
   *  students already "done" or currently "cropping" so re-running "Crop
   *  all" after fixing one failure only retries what's actually needed.
   *  Returns each targeted student's outcome (built from handleCrop's own
   *  return values, not by reading cropState back out afterward) so the
   *  automated pipeline can reliably tell who's ready for stage 5. */
  const handleCropAll = async (
    panelKey: string,
    results: SplitResult[]
  ): Promise<Record<string, "done" | "failed">> => {
    const targets = results.filter((r) => r.status === "split" && r.packetScanId);
    const outcomes: Record<string, "done" | "failed"> = {};
    if (targets.length === 0) return outcomes;
    setCropAllRunning((prev) => ({ ...prev, [panelKey]: true }));
    try {
      for (const r of targets) {
        const scanId = r.packetScanId as string;
        const current = cropState[scanId];
        if (current?.status === "done") {
          outcomes[scanId] = "done";
          continue;
        }
        if (current?.status === "cropping") continue; // another run already has this student in flight
        outcomes[scanId] = await handleCrop(scanId);
      }
    } finally {
      setCropAllRunning((prev) => ({ ...prev, [panelKey]: false }));
    }
    return outcomes;
  };

  /** Loads (or reloads) one student's crop list for stage 5, via the
   *  listing GET. Called once when a student's crop panel first opens,
   *  and again after "Assess all" finishes so the panel reflects fresh
   *  alreadyAssessed/verdict/marks values pulled from the database rather
   *  than only what this session's own requests happened to return.
   *
   *  Returns the crop list directly (not just via setAssessPanels) so the
   *  automated pipeline can act on it in the same tick -- reading
   *  assessPanels state back out right after calling this would see a
   *  stale pre-update snapshot, since this component's long-running async
   *  driver doesn't re-render between steps. Bounded retries here matter
   *  for the same resume-after-timeout reason as handleCrop, and are
   *  free -- a GET, not an Anthropic call. */
  const loadAssessPanel = async (packetScanId: string): Promise<AssessCropListItem[]> => {
    setAssessPanels((prev) => ({
      ...prev,
      [packetScanId]: { status: "loading-list", crops: prev[packetScanId]?.crops ?? [], error: null },
    }));
    try {
      const { ok, data } = await fetchJsonWithRetry(`/api/na-review/packet-scans/${packetScanId}/assess`, {});
      if (!ok) throw new Error(data?.error ?? "Could not load this student's crops.");
      const crops: AssessCropListItem[] = data.crops ?? [];
      setAssessPanels((prev) => ({ ...prev, [packetScanId]: { status: "ready", crops, error: null } }));
      // Seed per-crop state from what the list already knows, so a crop
      // assessed in an earlier session shows correctly without needing to
      // be re-run.
      setAssessCropState((prev) => ({
        ...prev,
        ...Object.fromEntries(
          crops.map((c) => [
            c.cropId,
            {
              status: c.alreadyAssessed ? "assessed" : c.isBlank ? "idle" : "idle",
              verdict: c.verdict,
              marksAwarded: c.marksAwarded,
              marksAvailable: c.marksAvailable,
              reason: null,
              rawResponse: null,
              transcription: c.transcription,
              marginComment: c.marginComment,
              nextStep: c.nextStep,
              teacherNote: c.teacherNote,
              confidence: c.confidence,
              misconceptionTags: c.misconceptionTags,
            } as AssessCropState,
          ])
        ),
      }));
      return crops;
    } catch (e) {
      setAssessPanels((prev) => ({
        ...prev,
        [packetScanId]: { status: "idle", crops: [], error: e instanceof Error ? e.message : "Failed to load." },
      }));
      return [];
    }
  };

  /** Stage 5 for one crop: calls the per-crop assess route. Bounded to a
   *  single Sonnet call server-side (see the route's comments) so this
   *  always resolves in a few seconds regardless of how many crops a
   *  student has -- the earlier whole-student design hit
   *  FUNCTION_INVOCATION_TIMEOUT on a real run and is why this is
   *  one-crop-at-a-time from the client instead. fetchJsonWithRetry adds a
   *  couple of bounded retries on top for a genuine transient failure
   *  (network blip, brief 5xx) -- since this route only ever calls
   *  Anthropic once it actually starts producing a response, a failed
   *  attempt never got billed, so retrying here doesn't double-spend. */
  const handleAssessCrop = async (cropId: string) => {
    setAssessCropState((prev) => ({
      ...prev,
      [cropId]: {
        status: "assessing",
        verdict: prev[cropId]?.verdict ?? null,
        marksAwarded: prev[cropId]?.marksAwarded ?? null,
        marksAvailable: prev[cropId]?.marksAvailable ?? null,
        reason: null,
        rawResponse: null,
        transcription: prev[cropId]?.transcription ?? null,
        marginComment: prev[cropId]?.marginComment ?? null,
        nextStep: prev[cropId]?.nextStep ?? null,
        teacherNote: prev[cropId]?.teacherNote ?? null,
        confidence: prev[cropId]?.confidence ?? null,
        misconceptionTags: prev[cropId]?.misconceptionTags ?? [],
      },
    }));
    try {
      const { ok, data } = await fetchJsonWithRetry(
        `/api/na-review/response-crops/${cropId}/assess`,
        { method: "POST" },
        { retries: 2, backoffMs: 1200 }
      );
      const status: AssessCropState["status"] =
        data.status === "assessed" ? "assessed" : data.status === "skipped" ? "skipped" : "failed";
      // The per-crop assess route's response doesn't currently echo back
      // transcription/marginComment/nextStep/teacherNote (only
      // verdict/marks/warnings) -- so a fresh single-crop assess shows the
      // verdict immediately but the detail panel catches up once
      // loadAssessPanel next re-reads na_feedback (e.g. via "Assess all",
      // which reloads the list when it finishes). This is a minor UX gap,
      // not a data gap -- the full explanation is already saved correctly.
      setAssessCropState((prev) => ({
        ...prev,
        [cropId]: {
          status,
          verdict: data.verdict ?? null,
          marksAwarded: data.marksAwarded ?? null,
          marksAvailable: data.marksAvailable ?? null,
          reason: data.reason ?? (ok ? null : data.error ?? "Assessment failed."),
          rawResponse: data,
          transcription: prev[cropId]?.transcription ?? null,
          marginComment: prev[cropId]?.marginComment ?? null,
          nextStep: prev[cropId]?.nextStep ?? null,
          teacherNote: prev[cropId]?.teacherNote ?? null,
          confidence: prev[cropId]?.confidence ?? null,
          misconceptionTags: prev[cropId]?.misconceptionTags ?? [],
        },
      }));
    } catch (e) {
      setAssessCropState((prev) => ({
        ...prev,
        [cropId]: {
          status: "failed",
          verdict: null,
          marksAwarded: null,
          marksAvailable: null,
          reason: e instanceof Error ? e.message : "Assessment failed.",
          rawResponse: null,
          transcription: null,
          marginComment: null,
          nextStep: null,
          teacherNote: null,
          confidence: null,
          misconceptionTags: [],
        },
      }));
    }
  };

  /** Runs stage 5 for every not-yet-assessed crop in one student's panel,
   *  one at a time -- same sequential, individually-bounded pattern as
   *  handleCropAll. Skips crops already "assessed" or "skipped" (blank /
   *  ungraded) so re-running after fixing one failure only retries what's
   *  actually still needed. Reloads the panel's list at the end so
   *  "already assessed" reflects the database, not just this run. */
  const handleAssessAll = async (packetScanId: string, crops: AssessCropListItem[]) => {
    setAssessPanels((prev) => ({
      ...prev,
      [packetScanId]: { ...(prev[packetScanId] ?? { crops, error: null }), status: "assessing-all" },
    }));
    try {
      for (const c of crops) {
        const current = assessCropState[c.cropId];
        if (current?.status === "assessed" || current?.status === "skipped" || current?.status === "assessing") continue;
        await handleAssessCrop(c.cropId);
      }
    } finally {
      await loadAssessPanel(packetScanId);
    }
  };

  /** Creates (or reuses) the server-side na_batch_runs row for this
   *  automatic pipeline call -- see batchRunIds' own comment for why this
   *  exists. Idempotent: the route itself finds and returns any existing
   *  active/paused run for this batchId, so calling this at the top of
   *  every autoCropAndAssessAll invocation (a fresh start, or a resume
   *  triggered by reloading an in-progress batch) always lands on the same
   *  row instead of forking the ledger. Failure here is non-critical --
   *  returns null and the actual crop/assess work below proceeds exactly
   *  as it always has, just without server-side progress tracking for this
   *  one run. */
  const ensureBatchRun = async (panelKey: string, studentIds: string[]): Promise<string | null> => {
    const existing = batchRunIds[panelKey];
    if (existing) return existing;
    try {
      const res = await fetch("/api/na-review/batch-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: panelKey, studentIds }),
      });
      const data = await res.json();
      if (!res.ok || !data.runId) return null;
      setBatchRunIds((prev) => ({ ...prev, [panelKey]: data.runId }));
      return data.runId as string;
    } catch {
      return null;
    }
  };

  /** Best-effort progress update to na_batch_runs -- swallows its own
   *  failures so a flaky network blip on the tracking call never
   *  interrupts the actual pipeline, which is the thing that matters.
   *  Returns the row's status after the update (null on failure) so the
   *  caller can notice a Pause/Cancel issued from the Active Batch Runs
   *  page -- see the loop in autoCropAndAssessAll that checks this. */
  const patchBatchRun = async (
    runId: string | null,
    patch: {
      stage?: "cropping" | "assessing";
      studentsDone?: number;
      studentIdsPending?: string[];
      status?: "active" | "paused" | "completed" | "failed";
    }
  ): Promise<string | null> => {
    if (!runId) return null;
    try {
      const res = await fetch(`/api/na-review/batch-runs/${runId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      return res.ok ? (data.updatedRun?.status ?? null) : null;
    } catch {
      // Non-critical -- see this function's own comment.
      return null;
    }
  };

  /** The "press upload and walk away" driver: runs stage 4 (crop, with its
   *  own retry+paged-chunk fallback) then stage 5 (assess) for every
   *  already-split student in one batch/chunk, entirely automatically.
   *  Triggered by the useEffect below -- once after a fresh split, once on
   *  reloading a batch that was already split -- rather than being called
   *  inline after performSplit/performChunkSplit, so it always runs against
   *  a freshly-rendered closure instead of risking a stale read of
   *  cropState/assessCropState mid-chain (see the effect's own comment).
   *
   *  Continues past any one student's failure so the rest of the batch
   *  still finishes -- one bad crop shouldn't block twenty good ones.
   *  Filters stage 5 work using each student's crop list straight from
   *  loadAssessPanel's return value (which reflects the database, i.e.
   *  alreadyAssessed) rather than assessCropState, specifically so
   *  resuming a batch that was already partly assessed in an earlier
   *  session never re-sends an already-graded crop to Claude -- that would
   *  be a real, avoidable Anthropic cost. */
  const autoCropAndAssessAll = async (panelKey: string, results: SplitResult[]) => {
    const targets = results.filter((r) => r.status === "split" && r.packetScanId);
    if (targets.length === 0) return;

    setAutoRuns((prev) => ({
      ...prev,
      [panelKey]: {
        startedAt: Date.now(),
        totalStudents: targets.length,
        studentIndex: 0,
        studentLabel: "",
        currentScanId: null,
        stage: "cropping",
        scanIds: targets.map((r) => r.packetScanId as string),
      },
    }));

    const runId = await ensureBatchRun(panelKey, targets.map((r) => r.invitedId));
    // A tab actually driving work always means the run is "active" -- this
    // is what turns a "paused" (or resumed-after-"stale") row back to live
    // the moment processing resumes, whether that's this same page
    // continuing or a teacher clicking Resume from Active Batch Runs.
    await patchBatchRun(runId, { status: "active" });
    let stoppedByRemoteAction = false;

    try {
      setStatusLine(`Automatic run: cropping ${targets.length} student(s)…`);
      const cropOutcomes = await handleCropAll(panelKey, targets);
      const readyForAssess = targets.filter((r) => cropOutcomes[r.packetScanId as string] === "done");
      const failedToCrop = targets.length - readyForAssess.length;

      setAutoRuns((prev) => ({
        ...prev,
        [panelKey]: {
          ...prev[panelKey],
          totalStudents: readyForAssess.length,
          scanIds: readyForAssess.map((r) => r.packetScanId as string),
        },
      }));
      await patchBatchRun(runId, {
        stage: "assessing",
        studentsDone: 0,
        studentIdsPending: readyForAssess.map((r) => r.invitedId),
      });

      for (let i = 0; i < readyForAssess.length; i++) {
        const r = readyForAssess[i];
        const scanId = r.packetScanId as string;
        setAutoRuns((prev) => ({
          ...prev,
          [panelKey]: { ...prev[panelKey], studentIndex: i, studentLabel: r.label, currentScanId: scanId, stage: "assessing" },
        }));
        setStatusLine(`Automatic run: assessing ${r.label} (${i + 1}/${readyForAssess.length})…`);
        const crops = await loadAssessPanel(scanId);
        const stillNeeded = crops.filter((c) => !c.alreadyAssessed);
        if (stillNeeded.length > 0) await handleAssessAll(scanId, stillNeeded);
        // Progress checkpoint after every student, not just at the end --
        // this is what lets a teacher who closed the tab mid-run see how
        // far it actually got, rather than only "started" vs. "finished".
        // Its returned status also doubles as the pause/cancel signal from
        // the Active Batch Runs page: this is the only place a currently-
        // running tab ever hears about a Pause/Cancel click made from
        // elsewhere, so check it on every checkpoint, not just at the end.
        const statusAfterCheckpoint = await patchBatchRun(runId, {
          studentsDone: i + 1,
          studentIdsPending: readyForAssess.slice(i + 1).map((sr) => sr.invitedId),
        });
        if (statusAfterCheckpoint === "paused" || statusAfterCheckpoint === "failed") {
          stoppedByRemoteAction = true;
          setStatusLine(
            `Automatic run ${statusAfterCheckpoint === "paused" ? "paused" : "cancelled"} from Active Batch Runs after ${i + 1}/${readyForAssess.length} student(s). Reload this batch or use Resume there to continue.`
          );
          break;
        }
      }

      if (!stoppedByRemoteAction) {
        setStatusLine(
          failedToCrop > 0
            ? `Automatic run finished: ${readyForAssess.length} student(s) fully assessed. ${failedToCrop} student(s) failed to crop even after retries -- see their panel below and click "Crop this student" to try again.`
            : `Automatic run finished: all ${readyForAssess.length} student(s) cropped and assessed. See Results by class above for marks.`
        );
        await patchBatchRun(runId, { status: "completed" });
      }
    } catch (e) {
      if (!stoppedByRemoteAction) await patchBatchRun(runId, { status: "failed" });
      throw e;
    } finally {
      // Cleared whether the run finished normally or an unexpected error
      // escaped the try block -- the banner's job is "is this still
      // running", and it must never keep claiming so after it's stopped.
      setAutoRuns((prev) => {
        const next = { ...prev };
        delete next[panelKey];
        return next;
      });
      setBatchRunIds((prev) => {
        const next = { ...prev };
        delete next[panelKey];
        return next;
      });
    }
  };

  // -- Chunk row editing --------------------------------------------------------
  const updateChunkRow = (chunkBatchId: string, rowKey: string, patch: Partial<ReviewRow>) =>
    setChunks((prev) =>
      prev.map((c) =>
        c.batchId === chunkBatchId
          ? { ...c, rows: c.rows.map((r) => (r.key === rowKey ? { ...r, ...patch } : r)) }
          : c
      )
    );
  const removeChunkRow = (chunkBatchId: string, rowKey: string) =>
    setChunks((prev) =>
      prev.map((c) => (c.batchId === chunkBatchId ? { ...c, rows: c.rows.filter((r) => r.key !== rowKey) } : c))
    );
  const addChunkRow = (chunkBatchId: string) =>
    setChunks((prev) =>
      prev.map((c) =>
        c.batchId === chunkBatchId
          ? {
              ...c,
              rows: [
                ...c.rows,
                { key: `manual-${Date.now()}`, label: "New student", pages: [], confidence: "low", note: "Added manually", invitedId: "" },
              ],
            }
          : c
      )
    );

  const chunkConflicts = (chunk: ChunkState) => {
    const owners = new Map<number, string[]>();
    for (const r of chunk.rows) for (const p of r.pages) owners.set(p, [...(owners.get(p) ?? []), r.key]);
    const conflicted = new Set<string>();
    for (const [, keys] of owners) if (keys.length > 1) for (const k of keys) conflicted.add(k);
    return conflicted;
  };

  const chunkCanSplit = (chunk: ChunkState) =>
    chunk.status === "segmented" &&
    chunk.rows.length > 0 &&
    chunk.rows.every((r) => r.invitedId && r.pages.length > 0) &&
    chunkConflicts(chunk).size === 0 &&
    new Set(chunk.rows.map((r) => r.invitedId)).size === chunk.rows.length;

  const handleSplitChunk = async (chunk: ChunkState) => {
    if (!chunkCanSplit(chunk)) return;
    updateChunk(chunk.batchId, { status: "split-pending" });
    try {
      const res = await fetch(`/api/na-review/batch/${chunk.batchId}/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segments: chunk.rows.map((r) => ({ label: r.label, pages: r.pages, invitedId: r.invitedId })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Split failed for this chunk.");
      updateChunk(chunk.batchId, { status: "split", rawSplitResponse: data });
      const results: SplitResult[] = data.results ?? [];
      setCropState((prev) => ({
        ...prev,
        ...Object.fromEntries(
          results
            .filter((r) => r.status === "split" && r.packetScanId)
            .map((r) => [r.packetScanId as string, { status: "idle", rawResponse: null, error: null } as CropState])
        ),
      }));
    } catch (e) {
      updateChunk(chunk.batchId, {
        status: "failed",
        error: e instanceof Error ? e.message : "Split failed.",
      });
    }
  };

  const renderReviewTable = (
    chunkRows: ReviewRow[],
    conflicts: Set<string>,
    disabled: boolean,
    onUpdate: (key: string, patch: Partial<ReviewRow>) => void,
    onRemove: (key: string) => void
  ) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-da-border text-left text-xs uppercase tracking-wide text-da-muted">
            <th className="px-4 py-2 font-semibold">Name on cover page</th>
            <th className="px-2 py-2 font-semibold">Pages</th>
            <th className="w-72 px-2 py-2 font-semibold">Matched student (invited)</th>
            <th className="px-2 py-2 font-semibold">Confidence</th>
            <th className="px-2 py-2 font-semibold" />
          </tr>
        </thead>
        <tbody>
          {chunkRows.map((r) => {
            const conflicted = conflicts.has(r.key);
            return (
              <tr key={r.key} className="border-b border-da-border/60">
                <td className="px-4 py-2">
                  <input
                    value={r.label}
                    onChange={(e) => onUpdate(r.key, { label: e.target.value })}
                    disabled={disabled}
                    className={`w-40 ${INPUT_CLASS}`}
                  />
                  {r.note && <p className="mt-0.5 text-xs text-da-muted">{r.note}</p>}
                </td>
                <td className="px-2 py-2">
                  <input
                    value={formatPageList(r.pages)}
                    onChange={(e) => onUpdate(r.key, { pages: parsePageList(e.target.value) })}
                    disabled={disabled}
                    placeholder="e.g. 1-8"
                    className={`w-28 ${INPUT_CLASS} ${conflicted ? "border-red-400" : ""}`}
                  />
                </td>
                <td className="w-72 px-2 py-2">
                  <StudentPicker
                    roster={version?.roster ?? []}
                    value={r.invitedId}
                    onChange={(invitedId) => onUpdate(r.key, { invitedId })}
                    disabled={disabled}
                  />
                </td>
                <td className="px-2 py-2">
                  <span className={`rounded border px-2 py-0.5 text-xs font-medium ${CONFIDENCE_STYLE[r.confidence]}`}>
                    {r.confidence}
                  </span>
                </td>
                <td className="px-2 py-2">
                  {!disabled && (
                    <button type="button" onClick={() => onRemove(r.key)} className="text-xs text-red-400 hover:text-red-600">
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
  );

  /** Stage 4 panel: one row per successfully-split student, with a Crop
   *  button, live status, and a raw-response viewer -- same pattern as the
   *  stage 1/2 raw response viewers elsewhere on this page. panelKey
   *  identifies this panel for the "Crop all" running-state tracking above
   *  (a top-level batchId, or a chunk's own batchId). */
  const renderCropPanel = (panelKey: string, results: SplitResult[]) => {
    const splitOnly = results.filter((r) => r.status === "split" && r.packetScanId);
    if (splitOnly.length === 0) return null;
    const runningAll = cropAllRunning[panelKey] ?? false;
    const remaining = splitOnly.filter((r) => {
      const s = cropState[r.packetScanId as string];
      return s?.status !== "done";
    }).length;
    return (
      <section className="rounded-xl border border-da-border bg-da-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-da-border px-5 py-3">
          <div>
            <h2 className="text-lg font-bold text-da-text">Stage 4 — crop extraction</h2>
            <p className="text-xs text-da-muted">
              Uses this packet version&apos;s locked anchors and deterministic page mapping — see the
              crop route&apos;s comments for why no page-identity matching runs here by default.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleCropAll(panelKey, splitOnly)}
            disabled={runningAll || remaining === 0}
            className="rounded-lg bg-da-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {runningAll
              ? "Cropping…"
              : remaining === 0
                ? "All students cropped"
                : `Crop all ${remaining} student(s)`}
          </button>
        </div>
        <div className="divide-y divide-da-border/60">
          {splitOnly.map((r) => {
            const scanId = r.packetScanId as string;
            const state = cropState[scanId] ?? { status: "idle" as const, rawResponse: null, error: null };
            return (
              <div key={scanId} className="px-5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-da-text">{r.label}</p>
                    <p className="text-xs text-da-muted">packet_scan_id {scanId.slice(0, 8)}…</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {state.status === "done" && (
                      <span className="rounded border border-green-300 bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                        cropped
                      </span>
                    )}
                    {state.status === "failed" && (
                      <span className="rounded border border-red-300 bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                        failed
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleCrop(scanId)}
                      disabled={state.status === "cropping" || runningAll}
                      className="rounded-lg border border-da-accent/40 bg-da-accent/10 px-3 py-1.5 text-xs font-medium text-da-accent hover:bg-da-accent/20 disabled:opacity-50"
                    >
                      {state.status === "cropping"
                        ? state.progress
                          ? `Cropping… (${state.progress.done}/${state.progress.total})`
                          : "Cropping…"
                        : state.status === "done"
                          ? "Re-crop"
                          : "Crop this student"}
                    </button>
                  </div>
                </div>
                {state.status === "cropping" && state.progress && (
                  <p className="mt-2 text-xs text-da-muted">
                    Whole-batch crop timed out — automatically retrying in smaller pages to stay under the platform's
                    request limit. No extra cost; this is the same crop work, just split into more requests.
                  </p>
                )}
                {state.error && <p className="mt-2 text-xs text-red-600">{state.error}</p>}
                {state.status === "done" && state.rawResponse != null && (() => {
                  const d = state.rawResponse as {
                    pageCountMismatch: number | null;
                    savedCount: number;
                    failedCount: number;
                    blankCount: number;
                    expandedCount: number;
                  };
                  return (
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-da-muted">
                      <span>{d.savedCount} saved</span>
                      {d.failedCount > 0 && <span className="text-red-600">{d.failedCount} failed</span>}
                      <span>{d.expandedCount} boundary-expanded</span>
                      <span>{d.blankCount} flagged blank</span>
                      {d.pageCountMismatch !== null && (
                        <span className="font-medium text-amber-700">
                          ⚠ page count mismatch: {d.pageCountMismatch} pages in this student&apos;s PDF — page
                          mapping may not be reliable, review manually
                        </span>
                      )}
                    </div>
                  );
                })()}
                {state.status === "done" && state.rawResponse == null && (
                  <p className="mt-2 text-xs text-da-muted">
                    Marked cropped in an earlier session — re-run to see fresh counts and the raw response.
                  </p>
                )}
                {state.rawResponse != null && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-medium text-da-text">Raw crop response</summary>
                    <pre className="mt-2 overflow-x-auto rounded bg-black/80 p-3 text-xs text-green-300">
                      {JSON.stringify(state.rawResponse, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      </section>
    );
  };

  /** Renders one student's Stage 5 card: header (name, mark totals, Open /
   *  Assess-all controls) plus the crop-by-crop detail list. Pulled out of
   *  renderAssessPanel so the same card can be reused by the results-by-
   *  class table below -- clicking a student's name there opens this same
   *  view inline, for any student regardless of which batch (if any) is
   *  currently loaded, since it only needs a packetScanId. */
  const renderAssessCard = (scanId: string, label: string) => {
    const panel = assessPanels[scanId];
            const totalAwarded = (panel?.crops ?? []).reduce((sum, c) => {
              const s = assessCropState[c.cropId];
              return sum + (s?.status === "assessed" ? s.marksAwarded ?? 0 : 0);
            }, 0);
            const totalAvailable = (panel?.crops ?? []).reduce((sum, c) => {
              const s = assessCropState[c.cropId];
              return sum + (s?.status === "assessed" ? s.marksAvailable ?? 0 : 0);
            }, 0);
            const remaining = (panel?.crops ?? []).filter((c) => {
              const s = assessCropState[c.cropId];
              return s?.status !== "assessed" && s?.status !== "skipped";
            }).length;

            return (
              <div key={scanId} className="px-5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-da-text">{label}</p>
                    <p className="text-xs text-da-muted">packet_scan_id {scanId.slice(0, 8)}…</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {panel && panel.crops.length > 0 && (
                      <span className="text-xs text-da-muted">
                        {totalAwarded}/{totalAvailable} marks
                      </span>
                    )}
                    {!panel && (
                      <button
                        type="button"
                        onClick={() => void loadAssessPanel(scanId)}
                        className="rounded-lg border border-da-accent/40 bg-da-accent/10 px-3 py-1.5 text-xs font-medium text-da-accent hover:bg-da-accent/20"
                      >
                        Open
                      </button>
                    )}
                    {panel && panel.status === "loading-list" && (
                      <span className="text-xs text-da-muted">Loading…</span>
                    )}
                    {panel && panel.crops.length > 0 && (
                      <button
                        type="button"
                        onClick={() => void handleAssessAll(scanId, panel.crops)}
                        disabled={panel.status === "assessing-all" || remaining === 0}
                        className="rounded-lg bg-da-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                      >
                        {panel.status === "assessing-all"
                          ? "Assessing…"
                          : remaining === 0
                            ? "All assessed"
                            : `Assess all ${remaining} question(s)`}
                      </button>
                    )}
                  </div>
                </div>

                {panel?.error && <p className="mt-2 text-xs text-red-600">{panel.error}</p>}

                {panel && panel.crops.length > 0 && (
                  <div className="mt-3 divide-y divide-da-border/40 rounded-lg border border-da-border/60">
                    {panel.crops.map((c) => {
                      const s = assessCropState[c.cropId] ?? {
                        status: "idle" as const,
                        verdict: null,
                        marksAwarded: null,
                        marksAvailable: null,
                        reason: null,
                        rawResponse: null,
                        transcription: null,
                        marginComment: null,
                        nextStep: null,
                        teacherNote: null,
                        confidence: null,
                        misconceptionTags: [],
                      };
                      // Only a partial mark (marksAwarded < marksAvailable)
                      // genuinely NEEDS an explanation open by default --
                      // that's exactly the "why did they lose a mark"
                      // question this whole panel exists to answer. A
                      // full-marks or zero-marks verdict is usually
                      // self-explanatory and stays collapsed to avoid
                      // cluttering the list.
                      const lostSomeMarks =
                        s.status === "assessed" &&
                        s.marksAvailable != null &&
                        s.marksAwarded != null &&
                        s.marksAwarded < s.marksAvailable &&
                        s.marksAwarded > 0;
                      const hasDetail =
                        !!s.transcription ||
                        !!s.marginComment ||
                        !!s.nextStep ||
                        !!s.teacherNote ||
                        !!c.imageUrl ||
                        !!c.questionText ||
                        !!c.promptImageUrl ||
                        c.possiblyTruncated;
                      return (
                        <div key={c.cropId} className="px-3 py-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="text-sm font-medium text-da-text">{c.qid}</span>
                              {c.possiblyTruncated && (
                                <span
                                  className="rounded border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700"
                                  title="Stage 4's automatic crop expansion hit this question's layout limit while the student's writing was still touching the edge -- the image may be missing content. Check the crop against the original scan before trusting this mark."
                                >
                                  may be cut off
                                </span>
                              )}
                              {s.status === "assessed" && s.verdict && (
                                <span
                                  className={`rounded border px-2 py-0.5 text-xs font-medium ${VERDICT_STYLE[s.verdict] ?? ""}`}
                                >
                                  {s.verdict}
                                  {s.marksAvailable != null ? ` — ${s.marksAwarded ?? 0}/${s.marksAvailable}` : ""}
                                </span>
                              )}
                              {s.status === "assessed" && s.confidence != null && s.confidence < 0.6 && (
                                <span
                                  className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"
                                  title="Low model confidence -- worth a second look even if the verdict looks reasonable."
                                >
                                  low confidence
                                </span>
                              )}
                              {s.status === "skipped" && (
                                <span className="rounded border border-gray-300 bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                                  skipped ({s.reason ?? (c.isBlank ? "blank" : "ungraded")})
                                </span>
                              )}
                              {s.status === "failed" && (
                                <span
                                  className="max-w-xs truncate rounded border border-red-300 bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800"
                                  title={s.reason ?? undefined}
                                >
                                  failed{s.reason ? `: ${s.reason}` : ""}
                                </span>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => handleAssessCrop(c.cropId)}
                              disabled={s.status === "assessing" || panel.status === "assessing-all"}
                              className="rounded border border-da-accent/40 bg-da-accent/10 px-2 py-1 text-xs font-medium text-da-accent hover:bg-da-accent/20 disabled:opacity-50"
                            >
                              {s.status === "assessing"
                                ? "…"
                                : s.status === "assessed" || s.status === "failed"
                                  ? "Re-run"
                                  : "Assess"}
                            </button>
                          </div>
                          {hasDetail && (
                            <details className="mt-1" open={lostSomeMarks || c.possiblyTruncated}>
                              <summary className="cursor-pointer text-xs text-da-accent hover:underline">
                                Why this mark — transcription, comment &amp; notes
                              </summary>
                              <div className="mt-2 space-y-2 rounded-lg bg-da-hover/50 p-3 text-xs">
                                {c.questionText && (
                                  <div>
                                    <p className="font-semibold text-da-text">Question</p>
                                    <p className="mt-0.5 whitespace-pre-wrap text-da-muted">{c.questionText}</p>
                                  </div>
                                )}
                                {c.promptImageUrl && (
                                  <div>
                                    <p className="font-semibold text-da-text">Question, as printed</p>
                                    {/* eslint-disable-next-line @next/next/no-img-element -- signed Storage URL, not a static asset Next's image optimizer can handle */}
                                    <img
                                      src={c.promptImageUrl}
                                      alt={`${c.qid} question prompt`}
                                      className="mt-1 max-h-96 w-auto rounded border border-da-border bg-white"
                                    />
                                  </div>
                                )}
                                {c.imageUrl && (
                                  <div>
                                    <p className="font-semibold text-da-text">Crop</p>
                                    {/* eslint-disable-next-line @next/next/no-img-element -- signed Storage URL, not a static asset Next's image optimizer can handle */}
                                    <img
                                      src={c.imageUrl}
                                      alt={`${c.qid} crop`}
                                      className="mt-1 max-h-96 w-auto rounded border border-da-border bg-white"
                                    />
                                  </div>
                                )}
                                {s.transcription && (
                                  <div>
                                    <p className="font-semibold text-da-text">What the student wrote</p>
                                    <p className="mt-0.5 whitespace-pre-wrap text-da-muted">{s.transcription}</p>
                                  </div>
                                )}
                                {s.marginComment && (
                                  <div>
                                    <p className="font-semibold text-da-text">Margin comment (shown to student)</p>
                                    <p className="mt-0.5 text-da-muted">{s.marginComment}</p>
                                  </div>
                                )}
                                {s.nextStep && (
                                  <div>
                                    <p className="font-semibold text-da-text">Next step (shown to student)</p>
                                    <p className="mt-0.5 text-da-muted">{s.nextStep}</p>
                                  </div>
                                )}
                                {s.misconceptionTags.length > 0 && (
                                  <div>
                                    <p className="font-semibold text-da-text">Misconception tags</p>
                                    <p className="mt-0.5 text-da-muted">{s.misconceptionTags.join(", ")}</p>
                                  </div>
                                )}
                                {s.teacherNote && (
                                  <div className="rounded border border-amber-300 bg-amber-50 p-2">
                                    <p className="font-semibold text-amber-800">
                                      Teacher note (not shown to student) — this is usually WHY marks were lost
                                    </p>
                                    <p className="mt-0.5 text-amber-800">{s.teacherNote}</p>
                                  </div>
                                )}
                                {s.confidence != null && (
                                  <p className="text-da-muted">Model confidence: {Math.round(s.confidence * 100)}%</p>
                                )}
                              </div>
                            </details>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
    );
  };

  /** Stage 5 panel: one card per successfully-cropped student. Unlike
   *  stage 4 (which only needs a packetScanId to act), stage 5 needs the
   *  student's actual crop list before it can show anything useful, so
   *  each student starts collapsed with an "Open" button that calls
   *  loadAssessPanel on first click -- avoids firing N list-fetches the
   *  moment this section renders for a whole class. */
  const renderAssessPanel = (results: SplitResult[]) => {
    const splitOnly = results.filter((r) => r.status === "split" && r.packetScanId);
    if (splitOnly.length === 0) return null;
    return (
      <section className="rounded-xl border border-da-border bg-da-surface">
        <div className="border-b border-da-border px-5 py-3">
          <h2 className="text-lg font-bold text-da-text">Stage 5 — AI assessment</h2>
          <p className="text-xs text-da-muted">
            One Sonnet call per question, marked against this packet&apos;s real rubric from{" "}
            <code>na_anchors</code>. Produces a proposal only — nothing here is a released grade.
          </p>
        </div>
        <div className="divide-y divide-da-border/60">
          {splitOnly.map((r) => renderAssessCard(r.packetScanId as string, r.label))}
        </div>
      </section>
    );
  };

  const anyChunked = chunks.length > 0;
  const anyBatchLoaded = !!batchId || anyChunked;
  const runningAutoRuns = Object.entries(autoRuns);
  void autoRunClockTick; // referenced so the ticking interval's re-render actually recomputes elapsed time below

  return (
    <div className="space-y-6">
      <input ref={fileInputRef} type="file" accept="application/pdf" onChange={handleFilePicked} className="hidden" />

      {/* "Is this still running?" banner -- sticky so it stays visible while
          scrolling through results, since a full batch (dozens of crops per
          student, each its own Claude call) can run for minutes with no
          visible change to the page below. Its mere presence answers the
          question: autoRuns entries are deleted the instant a run ends
          (success or failure), so if this isn't showing, nothing is running. */}
      {runningAutoRuns.length > 0 && (
        <div className="sticky top-0 z-20 space-y-2">
          {runningAutoRuns.map(([panelKey, info]) => {
            const elapsedSec = Math.max(0, Math.floor((Date.now() - info.startedAt) / 1000));
            const mm = Math.floor(elapsedSec / 60);
            const ss = elapsedSec % 60;
            const elapsed = `${mm}:${ss.toString().padStart(2, "0")}`;
            const cropProgress =
              info.stage === "assessing" && info.currentScanId
                ? (() => {
                    const panelCrops = assessPanels[info.currentScanId as string]?.crops ?? [];
                    if (panelCrops.length === 0) return null;
                    const done = panelCrops.filter((c) => {
                      const s = assessCropState[c.cropId];
                      return s?.status === "assessed" || s?.status === "skipped";
                    }).length;
                    return { done, total: panelCrops.length };
                  })()
                : null;

            // One segment per student in whichever cohort is currently
            // running (see AutoRunInfo.scanIds), so the bar reads as a
            // chunked "how far in are we" view rather than one blob that
            // barely moves across a 40-student batch. Each segment fills
            // 0..1 -- fully for a finished student, partially for the one
            // in flight (using its own sub-progress: paged crop count
            // during cropping, assessed-question count during assessing),
            // empty for one not yet started.
            const segments = info.scanIds.map((scanId, i) => {
              if (info.stage === "cropping") {
                const cs = cropState[scanId];
                if (cs?.status === "done") return { fill: 1, failed: false };
                if (cs?.status === "failed") return { fill: 1, failed: true };
                if (cs?.status === "cropping") {
                  const p = cs.progress;
                  return { fill: p && p.total > 0 ? p.done / p.total : 0.15, failed: false };
                }
                return { fill: 0, failed: false };
              }
              if (i < info.studentIndex) return { fill: 1, failed: false };
              if (i === info.studentIndex) {
                return { fill: cropProgress && cropProgress.total > 0 ? cropProgress.done / cropProgress.total : 0.08, failed: false };
              }
              return { fill: 0, failed: false };
            });
            const segmentsDone = segments.filter((s) => s.fill >= 1 && !s.failed).length;
            const segmentsFailed = segments.filter((s) => s.failed).length;

            // Whole-process percentage, not just the current stage's -- the
            // per-student segment bar below already shows fine-grained
            // progress within cropping or assessing, but a teacher glancing
            // at the very top of the page wants one number for "how far
            // into this batch am I", spanning both stages. Approximated as
            // two equal halves (crop, then assess) since there's no
            // meaningful way to know in advance how much of the total time
            // each stage will take -- explicitly "approximate", per its label.
            const stageFrac =
              segments.length > 0 ? segments.reduce((sum, s) => sum + Math.min(1, s.fill), 0) / segments.length : 0;
            const overallPct = Math.round((info.stage === "cropping" ? stageFrac * 50 : 50 + stageFrac * 50));

            return (
              <div
                key={panelKey}
                className="flex flex-col gap-2 rounded-xl border border-da-accent/60 bg-da-accent/15 px-5 py-3 shadow-lg shadow-black/30 backdrop-blur"
              >
                <div className="flex items-center gap-3">
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-da-border/40">
                    <div
                      className="h-full rounded-full bg-da-accent transition-all"
                      style={{ width: `${overallPct}%` }}
                    />
                  </div>
                  <span className="font-mono text-sm font-bold text-da-text">{overallPct}%</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="relative flex h-3 w-3 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-da-accent opacity-75" />
                    <span className="relative inline-flex h-3 w-3 rounded-full bg-da-accent" />
                  </span>
                  <span className="text-sm font-bold text-da-text">Automatic run in progress</span>
                  <span className="font-mono text-sm text-da-text">{elapsed} elapsed</span>
                  <span className="text-sm text-da-muted">
                    {info.stage === "cropping"
                      ? `Cropping ${info.totalStudents} student(s)…`
                      : `Student ${info.studentIndex + 1} of ${info.totalStudents} — ${info.studentLabel}${
                          cropProgress ? ` — question ${cropProgress.done}/${cropProgress.total}` : ""
                        }`}
                  </span>
                  <span className="ml-auto font-mono text-xs text-da-muted">
                    {info.stage === "cropping" ? "cropping" : "assessing"}: {segmentsDone}/{info.scanIds.length} done
                    {segmentsFailed > 0 ? ` — ${segmentsFailed} failed` : ""}
                  </span>
                </div>
                {segments.length > 0 && (
                  <div className="flex w-full gap-0.5" aria-hidden>
                    {segments.map((seg, i) => (
                      <div key={i} className="h-2 min-w-[2px] flex-1 overflow-hidden rounded-sm bg-da-border/40">
                        <div
                          className={`h-full transition-all ${seg.failed ? "bg-da-danger" : "bg-da-accent"}`}
                          style={{ width: `${Math.max(0, Math.min(100, Math.round(seg.fill * 100)))}%` }}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <section className="rounded-xl border border-da-border bg-da-surface p-5">
        <label className="block text-sm font-medium text-da-text">Packet version</label>
        <select
          value={versionId}
          onChange={(e) => {
            setVersionId(e.target.value);
            reset();
            syncUrl(null);
          }}
          className={`mt-1 ${SELECT_CLASS}`}
        >
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              {v.title ?? v.versionLabel} — {v.pageCount ?? "?"} pages
              {v.anchorsLocked ? "" : " (anchors NOT locked)"} — roster: {v.roster.length}
              {v.rosterIsTrack && v.rosterSourceCourseNames.length
                ? ` (pooled: ${v.rosterSourceCourseNames.join(", ")})`
                : ""}
            </option>
          ))}
        </select>
        {version && !version.courseId && (
          <p className="mt-2 text-xs text-da-danger">
            This packet version has no linked course — roster matching will find nothing.
          </p>
        )}
        {version && version.courseId && version.roster.length === 0 && !version.rosterIsTrack && (
          <p className="mt-2 text-xs text-da-warning">
            This course has no invited students yet — every segment will come back unmatched.
          </p>
        )}
        {version && version.rosterIsTrack && version.roster.length === 0 && (
          <p className="mt-2 text-xs text-da-danger">
            This is a track course (Grade 9) but no member classes have any invited students yet
            {version.rosterSourceCourseNames.length
              ? ` — checked ${version.rosterSourceCourseNames.join(", ")}`
              : ", and no member classes are mapped in track_courses at all"}
            . Every segment will come back unmatched.
          </p>
        )}
        {version && version.rosterIsTrack && version.roster.length > 0 && (
          <p className="mt-2 text-xs text-da-muted">
            Roster pooled from real classes: {version.rosterSourceCourseNames.join(", ")}.
          </p>
        )}
        {version && version.pageCount == null && (
          <p className="mt-2 text-xs text-da-warning">
            This packet version has no known page count — a large scan can&apos;t be auto pre-split without it.
          </p>
        )}
      </section>

      {!anyBatchLoaded && (
        <section className="rounded-xl border border-da-border bg-da-surface p-5">
          <h2 className="text-lg font-bold text-da-text">Upload a batch scan</h2>
          <p className="mt-1 text-sm text-da-muted">
            One PDF covering multiple students of this packet, each starting with a page showing
            their name. A scan larger than Anthropic&apos;s 100-page limit is split automatically
            into whole-packet chunks — no need to cut it up yourself.
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

      {/* Results by class -- every identified scan for this packet version,
          grouped by the student's real course, independent of which upload
          batch produced the scan (a student's assessed work can end up
          split across more than one batch -- see HANDOFF.md). Collapsed by
          default so opening this page never fires an extra request. */}
      {version && (
        <section className="rounded-xl border border-da-border bg-da-surface">
          <button
            type="button"
            onClick={() => {
              const next = !resultsOpen;
              setResultsOpen(next);
              if (next && resultsPanel.status === "idle") void fetchResults(version.id);
            }}
            className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left"
          >
            <div>
              <h2 className="text-lg font-bold text-da-text">Results by class</h2>
              <p className="text-xs text-da-muted">
                Every identified student for this packet, grouped by 9A / 9C / 9G, with assessed-question counts and
                marks so far.
              </p>
            </div>
            <span className="text-da-muted">{resultsOpen ? "▲" : "▼"}</span>
          </button>
          {resultsOpen && (
            <div className="border-t border-da-border px-5 py-4">
              {resultsPanel.status === "loading" && <p className="text-sm text-da-muted">Loading…</p>}
              {resultsPanel.status === "failed" && <p className="text-sm text-red-600">{resultsPanel.error}</p>}
              {resultsPanel.status === "ready" && resultsPanel.data && (
                <div className="space-y-5">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-da-muted">
                      {resultsPanel.data.totalGradable} gradable questions per student — {resultsPanel.data.totalMarksAvailable}{" "}
                      Clev&apos;s Marks total.
                    </p>
                    <button
                      type="button"
                      onClick={() => void fetchResults(version.id)}
                      className="rounded border border-da-border px-2 py-1 text-xs text-da-muted hover:bg-da-hover"
                    >
                      Refresh
                    </button>
                  </div>
                  {resultsPanel.data.courses.length === 0 && (
                    <p className="text-sm text-da-muted">No identified scans yet for this packet version.</p>
                  )}
                  {resultsPanel.data.courses.map((course) => (
                    <div key={course.courseName}>
                      <h3 className="text-sm font-semibold text-da-text">{course.courseName}</h3>
                      <div className="mt-2 overflow-x-auto rounded-lg border border-da-border/60">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-da-border text-left text-xs uppercase tracking-wide text-da-muted">
                              <th className="px-3 py-2 font-semibold">Student</th>
                              <th className="px-3 py-2 font-semibold">Assessed</th>
                              <th className="px-3 py-2 font-semibold">Clev&apos;s Marks</th>
                            </tr>
                          </thead>
                          <tbody>
                            {course.students.map((s) => {
                              const done = s.assessedCount === s.totalGradable && s.totalGradable > 0;
                              const expanded = expandedResultScanId === s.packetScanId;
                              return (
                                <Fragment key={s.packetScanId}>
                                  <tr className="border-b border-da-border/40 last:border-0">
                                    <td className="px-3 py-2 text-da-text">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setExpandedResultScanId(expanded ? null : s.packetScanId);
                                          if (!assessPanels[s.packetScanId]) void loadAssessPanel(s.packetScanId);
                                        }}
                                        className="text-left hover:text-da-accent hover:underline"
                                      >
                                        {s.studentName}
                                      </button>
                                    </td>
                                    <td className="px-3 py-2 text-da-muted">
                                      {s.assessedCount} / {s.totalGradable}
                                      {done && <span className="ml-1.5 text-green-500">✓</span>}
                                    </td>
                                    <td className="px-3 py-2 text-da-muted">
                                      {s.marksAwarded} / {s.marksAvailable}
                                    </td>
                                  </tr>
                                  {expanded && (
                                    <tr className="border-b border-da-border/40 last:border-0">
                                      <td colSpan={3} className="bg-da-hover/20 p-0">
                                        {renderAssessCard(s.packetScanId, s.studentName)}
                                      </td>
                                    </tr>
                                  )}
                                </Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* Recent batches picker -- lets a teacher pick their way back into
          an in-progress batch instead of needing its UUID. Only shown when
          nothing is currently loaded, so it doesn't compete for attention
          once a batch is already on screen. */}
      {!anyBatchLoaded && version && (recentBatches.length > 0 || recentBatchesLoading) && (
        <section className="rounded-xl border border-da-border bg-da-surface p-5">
          <h2 className="text-sm font-medium text-da-text">Recent batches for this packet</h2>
          {recentBatchesLoading && <p className="mt-2 text-xs text-da-muted">Loading…</p>}
          {!recentBatchesLoading && (
            <ul className="mt-2 divide-y divide-da-border/60">
              {recentBatches
                .filter((b) => !b.parent_batch_id) // top-level batches only; chunks load via their parent
                .slice(0, 10)
                .map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-3 py-2">
                    <div>
                      <p className="text-sm text-da-text">
                        {b.source_filename ?? "batch-scan.pdf"} — {b.page_count ?? "?"} pages
                      </p>
                      <p className="text-xs text-da-muted">
                        {new Date(b.created_at).toLocaleString()} — status: {b.status}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void loadBatch(b.id)}
                      disabled={loadingBatch}
                      className="rounded-lg border border-da-accent/40 bg-da-accent/10 px-3 py-1.5 text-xs font-medium text-da-accent hover:bg-da-accent/20 disabled:opacity-50"
                    >
                      {loadingBatch ? "Loading…" : "Resume"}
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </section>
      )}

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {statusLine && (
        <div className="rounded-lg border border-blue-300 bg-blue-50 px-4 py-3 text-sm text-blue-800">{statusLine}</div>
      )}
      {presplitWarnings.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-medium">Pre-split notes:</p>
          <ul className="mt-1 list-disc pl-5">
            {presplitWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Non-chunked review table (unchanged from before) */}
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
              <button
                type="button"
                onClick={() => {
                  reset();
                  syncUrl(null);
                }}
                className="rounded border border-da-border px-3 py-1 text-xs text-da-muted hover:bg-da-hover"
              >
                Start over
              </button>
              <button
                type="button"
                onClick={handleSplit}
                disabled={!canSplit || splitting}
                className="rounded-lg border border-da-accent bg-da-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
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

          {renderReviewTable(rows, rowsWithConflicts, !!rawStage2, updateRow, removeRow)}

          {!rawStage2 && (
            <div className="border-t border-da-border px-5 py-3">
              <button type="button" onClick={addRow} className="text-sm text-da-accent hover:underline">
                + Add a student row (for a page the model missed)
              </button>
            </div>
          )}
        </section>
      )}

      {/* Stage 4: crop extraction, one panel per successfully split student */}
      {batchId && splitResults.length > 0 && renderCropPanel(batchId, splitResults)}

      {/* Stage 5: AI assessment, one panel per successfully split student */}
      {batchId && splitResults.length > 0 && renderAssessPanel(splitResults)}

      {/* Chunked review: one card per chunk */}
      {anyChunked && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-da-muted">
              Parent upload {parentBatchId?.slice(0, 8)}… split into {chunks.length} chunk(s).
            </p>
            <button
              type="button"
              onClick={() => {
                reset();
                syncUrl(null);
              }}
              className="rounded border border-da-border px-3 py-1 text-xs text-da-muted hover:bg-da-hover"
            >
              Start over
            </button>
          </div>

          {chunks.map((chunk) => {
            const conflicts = chunkConflicts(chunk);
            const canSplitThis = chunkCanSplit(chunk);
            const chunkSplitResults: SplitResult[] =
              chunk.status === "split" ? ((chunk.rawSplitResponse as { results?: SplitResult[] })?.results ?? []) : [];
            return (
              <section key={chunk.batchId} className="rounded-xl border border-da-border bg-da-surface">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-da-border px-5 py-3">
                  <div>
                    <h3 className="text-base font-bold text-da-text">
                      Chunk {chunk.chunkIndex} of {chunk.chunkCount} — pages {chunk.startPage}-{chunk.endPage} (
                      {chunk.endPage - chunk.startPage + 1} pages)
                    </h3>
                    <p className="text-xs text-da-muted">
                      Batch {chunk.batchId.slice(0, 8)}… — status: {chunk.status}
                    </p>
                  </div>
                  {chunk.status === "segmented" && (
                    <button
                      type="button"
                      onClick={() => handleSplitChunk(chunk)}
                      disabled={!canSplitThis}
                      className="rounded-lg border border-da-accent bg-da-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                    >
                      Confirm & split {chunk.rows.length} student(s)
                    </button>
                  )}
                  {chunk.status === "pending" && (
                    <button
                      type="button"
                      onClick={() => segmentChunk(chunk)}
                      className="rounded-lg border border-da-accent/40 bg-da-accent/10 px-4 py-2 text-sm font-medium text-da-accent hover:bg-da-accent/20"
                    >
                      Segment this chunk
                    </button>
                  )}
                </div>

                {chunk.status === "segmenting" && (
                  <p className="px-5 py-4 text-sm text-da-muted">Reading cover pages…</p>
                )}
                {chunk.status === "split-pending" && (
                  <p className="px-5 py-4 text-sm text-da-muted">Splitting…</p>
                )}
                {chunk.status === "failed" && (
                  <p className="px-5 py-4 text-sm text-red-500">{chunk.error}</p>
                )}

                {(chunk.status === "segmented" || chunk.status === "split" || chunk.status === "split-pending") && (
                  <>
                    {conflicts.size > 0 && chunk.status === "segmented" && (
                      <div className="border-b border-red-200 bg-red-50 px-5 py-2 text-xs text-red-700">
                        ⚠ Some pages are claimed by more than one row.
                      </div>
                    )}
                    {chunk.unassignedPages.length > 0 && (
                      <div className="border-b border-da-border px-5 py-2 text-xs text-da-muted">
                        Model reported unassigned pages: {formatPageList(chunk.unassignedPages)}
                      </div>
                    )}
                    {renderReviewTable(
                      chunk.rows,
                      conflicts,
                      chunk.status !== "segmented",
                      (key, patch) => updateChunkRow(chunk.batchId, key, patch),
                      (key) => removeChunkRow(chunk.batchId, key)
                    )}
                    {chunk.status === "segmented" && (
                      <div className="border-t border-da-border px-5 py-3">
                        <button
                          type="button"
                          onClick={() => addChunkRow(chunk.batchId)}
                          className="text-sm text-da-accent hover:underline"
                        >
                          + Add a student row (for a page the model missed)
                        </button>
                      </div>
                    )}
                  </>
                )}

                {chunk.status === "split" && (
                  <details className="border-t border-da-border p-4">
                    <summary className="cursor-pointer text-sm font-medium text-da-text">Raw split response</summary>
                    <pre className="mt-3 overflow-x-auto rounded bg-black/80 p-3 text-xs text-green-300">
                      {JSON.stringify(chunk.rawSplitResponse, null, 2)}
                    </pre>
                  </details>
                )}

                {chunk.status === "split" && chunkSplitResults.length > 0 && (
                  <div className="border-t border-da-border p-4 space-y-4">
                    {renderCropPanel(chunk.batchId, chunkSplitResults)}
                    {renderAssessPanel(chunkSplitResults)}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {rawStage1 !== null && !anyChunked && (
        <details className="rounded-xl border border-da-border bg-da-surface p-4">
          <summary className="cursor-pointer text-sm font-medium text-da-text">Raw stage 1 response (segmentation)</summary>
          <pre className="mt-3 overflow-x-auto rounded bg-black/80 p-3 text-xs text-green-300">
            {JSON.stringify(rawStage1, null, 2)}
          </pre>
        </details>
      )}

      {rawStage2 !== null && (
        <details className="rounded-xl border border-da-border bg-da-surface p-4">
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
