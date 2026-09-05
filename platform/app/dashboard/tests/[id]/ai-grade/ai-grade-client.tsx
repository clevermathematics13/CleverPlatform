"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import LatexRenderer from "@/components/LatexRenderer";
import { BatchGradeTab } from "./batch-grade-tab";
import { fetchJson } from "./fetch-json";
import {
  runsForStudent,
  rowsForRun,
  sortReviewRows,
} from "@/lib/ai-grade-review";

type MarkschemeSource = "part_latex" | "part_text" | "whole_question" | "draft" | "none";
type Confidence = "high" | "medium" | "low";
type RunStatus = "running" | "complete" | "failed";

interface TestItem {
  id: string;
  question_number: number;
  part_label: string | null;
  max_marks: number;
}

interface TestDetail {
  id: string;
  name: string;
  course_id: string;
  test_items: TestItem[];
}

interface StudentOption {
  /**
   * The opaque subject id every AI-grade endpoint expects as studentId --
   * usually a real profiles.id, but "invited-<invited_students.id>" for a
   * roster entry imported (e.g. via Google Classroom) that has never logged
   * in and so has no profiles row yet. See parseGradingSubject in
   * lib/ai-grading.ts; this component never needs to tell the two apart.
   */
  profile_id: string;
  display_name: string;
  /**
   * The real class the student is in ("9A"). A Grade 9 test sits on one
   * class but its roster pools every class in the track, so the UI groups
   * by this. Null when the API could not name the class.
   */
  class_name: string | null;
}

interface RunRow {
  id: string;
  test_id: string;
  student_id: string;
  status: RunStatus;
  model: string | null;
  source_storage_path: string | null;
  coverage: {
    partsInAssessment?: number;
    partsGraded?: number;
    partsWithoutMarkscheme?: number;
    suggestedTotal?: number;
    maxTotal?: number;
    testTotalMarks?: number;
    needsReview?: string[];
    /** Parts whose suggestion matched the previous run's and so kept their accepted status. */
    acceptedCarriedForward?: number;
    warnings?: string[];
  } | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

interface MarkBreakdownEntry {
  token: string;
  awarded: boolean;
  note: string;
  /** Which of this unit's own labeled sub-parts this token belongs to, e.g. "a)(i)" -- only present when a single graded unit covers more than one. */
  part?: string;
}

/**
 * Clusters consecutive markBreakdown entries sharing the same `part` label
 * (e.g. "a)(i)", "a)(ii)", "b)") so the review UI can show which marks
 * belong to which sub-part instead of one undifferentiated row of chips.
 * Entries with no `part` (the common case: a unit with no internal
 * sub-part structure) all land in one unlabeled group, so older graded
 * results without this field render exactly as before.
 */
function groupMarkBreakdownByPart(
  entries: MarkBreakdownEntry[]
): { part: string | null; entries: MarkBreakdownEntry[] }[] {
  const groups: { part: string | null; entries: MarkBreakdownEntry[] }[] = [];
  for (const entry of entries) {
    const part = entry.part ?? null;
    const last = groups[groups.length - 1];
    if (last && last.part === part) {
      last.entries.push(entry);
    } else {
      groups.push({ part, entries: [entry] });
    }
  }
  return groups;
}

interface ResultRow {
  id: string;
  run_id: string;
  test_item_id: string;
  suggested_marks: number;
  max_marks: number;
  confidence: Confidence;
  markscheme_source: MarkschemeSource;
  work_found: boolean;
  reasoning: string | null;
  evidence: string | null;
  /** Cropped scan region the model used to produce `evidence`, if it could localise the work. */
  evidence_image_url: string | null;
  /** The fractional-page box `evidence_image_url` was cropped from, if any -- lets the UI fetch the full page for context. */
  evidence_box: { page: number; x0: number; y0: number; x1: number; y1: number } | null;
  /** Question source image(s) from the PPQ bank, if any are on file for this part. */
  question_image_urls: string[];
  /** Mark scheme source image(s) from the PPQ bank, if any are on file for this part. */
  markscheme_image_urls: string[];
  mark_breakdown: MarkBreakdownEntry[];
  accepted: boolean;
  accepted_at: string | null;
  accepted_by: string | null;
}

const SOURCE_LABEL: Record<MarkschemeSource, string> = {
  part_latex: "Part mark scheme",
  part_text: "Part mark scheme (plain text)",
  whole_question: "Whole-question fallback",
  draft: "Draft mark scheme",
  none: "No mark scheme",
};

const CONFIDENCE_STYLE: Record<Confidence, string> = {
  high: "bg-green-500/15 text-green-300 border-green-400/40",
  medium: "bg-amber-500/15 text-amber-300 border-amber-400/40",
  low: "bg-red-500/15 text-red-300 border-red-400/40",
};

function itemLabel(item: TestItem | undefined): string {
  if (!item) return "—";
  return item.part_label
    ? `Q${item.question_number}(${item.part_label})`
    : `Q${item.question_number}`;
}

export function AiGradeClient({ testId }: { testId: string }) {
  const [tab, setTab] = useState<"individual" | "batch">("individual");
  /** Result of GET /api/health/anthropic: null until checked; error string when the key cannot complete a call. */
  const [apiHealthError, setApiHealthError] = useState<string | null>(null);

  const [test, setTest] = useState<TestDetail | null>(null);
  const [students, setStudents] = useState<StudentOption[]>([]);
  /** Newest COMPLETE run per student -- the one whose results are reviewable. */
  const [runsByStudent, setRunsByStudent] = useState<Record<string, RunRow>>({});
  /** Newest run of any status per student, when it is NOT the complete one (a failed or still-running attempt). */
  const [newerAttemptByStudent, setNewerAttemptByStudent] = useState<Record<string, RunRow>>({});
  /** Previous complete run's suggested marks for the student under review, keyed by test_item_id. */
  const [previousMarks, setPreviousMarks] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusLine, setStatusLine] = useState<string | null>(null);

  const [focusStudent, setFocusStudent] = useState<string | null>(null);
  const [results, setResults] = useState<ResultRow[]>([]);
  /**
   * Which student the rows currently in `results` were loaded for. The review
   * panel refuses to render unless this matches `focusStudent`, so one
   * student's marks can never appear under another student's heading -- see
   * lib/ai-grade-review.ts for the incident this guards against.
   */
  const [resultsStudent, setResultsStudent] = useState<string | null>(null);
  const [focusRunId, setFocusRunId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, number>>({}); // keyed by result.id
  const [selected, setSelected] = useState<Set<string>>(new Set()); // result ids
  const [expanded, setExpanded] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  /** Result id currently fetching its full source page (see viewFullPage). */
  const [pageImageLoadingId, setPageImageLoadingId] = useState<string | null>(null);
  /** Which rows have their question image un-minimized — collapsed by default, keyed by result.id. */
  const [questionImageShown, setQuestionImageShown] = useState<Set<string>>(new Set());
  /** Same, for the student's-work scan crop. */
  const [evidenceImageShown, setEvidenceImageShown] = useState<Set<string>>(new Set());
  /** Same, for the mark scheme source image(s). */
  const [markschemeImageShown, setMarkschemeImageShown] = useState<Set<string>>(new Set());

  const [busyStudent, setBusyStudent] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [acceptingRowId, setAcceptingRowId] = useState<string | null>(null);
  const [acceptingAll, setAcceptingAll] = useState(false);

  /** How many of a run's results are accepted, keyed by run id — drives the roster's status dot. */
  const [acceptanceByRun, setAcceptanceByRun] = useState<Record<string, { accepted: number; total: number }>>(
    {}
  );

  // -- Manually correcting a misread transcription (evidence) and re-grading it --
  const [editingEvidenceId, setEditingEvidenceId] = useState<string | null>(null);
  const [evidenceDraft, setEvidenceDraft] = useState<Record<string, string>>({});
  const [regradingId, setRegradingId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingUploadStudent = useRef<string | null>(null);
  /** Incremented per review load; a response from an older load is discarded. */
  const reviewRequestSeq = useRef(0);

  const itemById = new Map((test?.test_items ?? []).map((i) => [i.id, i]));
  const classCount = new Set(students.map((s) => s.class_name ?? "")).size;

  // -- Initial load: test detail (for items + course), roster, latest runs --
  const loadOverview = useCallback(async () => {
    setError(null);
    try {
      const test1 = await fetchJson(`/api/tests/${testId}`);
      if (!test1.ok) {
        setError((test1.data.error as string) ?? "Could not load this assessment.");
        return;
      }
      const testData = test1.data as unknown as TestDetail;
      setTest(testData);

      // includeTrackSiblings: a Grade 9 test is attached to one class (9G)
      // but the scanned pile mixes every class in its track (9A, 9C, 9G),
      // so the roster pools them all -- signed in or not.
      const students1 = await fetchJson(
        `/api/students?courseId=${testData.course_id}&includeInvited=true&includeTrackSiblings=true`
      );
      if (!students1.ok) {
        setError((students1.data.error as string) ?? "Could not load the class roster.");
        return;
      }
      type RosterRow = {
        profile_id?: string;
        profiles: { display_name: string; nickname: string | null };
        course_id?: string;
        course_name?: string | null;
      };
      const rawRows = (students1.data.students as RosterRow[]) ?? [];
      // Class order: the test's own class first, then the pooled sibling
      // classes alphabetically, then students whose class is unknown.
      const ownClass = rawRows.find((s) => s.course_id === testData.course_id)?.course_name ?? null;
      const classRank = (name: string | null) => (name === ownClass ? 0 : name ? 1 : 2);
      const roster: StudentOption[] = rawRows
        .filter((s): s is RosterRow & { profile_id: string } => !!s.profile_id)
        .map((s) => {
          const fullName = s.profiles?.display_name;
          const nickname = s.profiles?.nickname;
          // Full name first — the batch-upload dropdown needs it to tell
          // apart students who share a first name or nickname. Nickname
          // shown alongside when it differs, since that's often what a
          // teacher recognises a cover-page name against.
          const label =
            fullName && nickname && nickname !== fullName
              ? `${fullName} (${nickname})`
              : fullName || nickname || "Unknown";
          return { profile_id: s.profile_id, display_name: label, class_name: s.course_name ?? null };
        })
        .sort(
          (a: StudentOption, b: StudentOption) =>
            classRank(a.class_name) - classRank(b.class_name) ||
            (a.class_name ?? "").localeCompare(b.class_name ?? "") ||
            a.display_name.localeCompare(b.display_name)
        );
      setStudents(roster);

      const runs1 = await fetchJson(`/api/tests/${testId}/ai-grade`);
      if (!runs1.ok) {
        setError((runs1.data.error as string) ?? "Could not load grading runs.");
        return;
      }
      // Runs come back newest-first. The reviewable run is the newest COMPLETE
      // one: a failed or half-finished attempt has no results, and treating it
      // as "the" run used to hide a student's real graded work behind an
      // empty run (seen when a re-mark failed on API credits). The newer
      // attempt is kept separately so its error still shows in the roster.
      const latestComplete: Record<string, RunRow> = {};
      const newestAny: Record<string, RunRow> = {};
      for (const r of ((runs1.data.runs as RunRow[]) ?? [])) {
        if (!newestAny[r.student_id]) newestAny[r.student_id] = r;
        if (r.status === "complete" && !latestComplete[r.student_id]) latestComplete[r.student_id] = r;
      }
      const newerAttempt: Record<string, RunRow> = {};
      for (const [studentId, r] of Object.entries(newestAny)) {
        if (latestComplete[studentId]?.id !== r.id) newerAttempt[studentId] = r;
      }
      setRunsByStudent(latestComplete);
      setNewerAttemptByStudent(newerAttempt);

      const counts: Record<string, { accepted: number; total: number }> = {};
      for (const r of ((runs1.data.results as { run_id: string; accepted: boolean }[]) ?? [])) {
        const c = counts[r.run_id] ?? { accepted: 0, total: 0 };
        c.total += 1;
        if (r.accepted) c.accepted += 1;
        counts[r.run_id] = c;
      }
      setAcceptanceByRun(counts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this assessment.");
    }
  }, [testId]);

  useEffect(() => {
    loadOverview().finally(() => setLoading(false));
  }, [loadOverview]);

  /** Drops whatever is in the review panel. Called before every load, so a
   * failed or superseded fetch leaves the panel empty rather than showing the
   * previously reviewed student's rows under the new student's name. The
   * "was N" hints go too -- a previous run's marks belong to the student
   * they were loaded for, same as the rows themselves. */
  const clearReview = useCallback(() => {
    setResults([]);
    setResultsStudent(null);
    setFocusRunId(null);
    setDrafts({});
    setSelected(new Set());
    setExpanded(null);
    setEditingEvidenceId(null);
    setPreviousMarks({});
  }, []);

  // Is the deployed Anthropic key able to complete a call at all? When the
  // account is out of credit every marking action on this page fails with
  // the same error, one student at a time -- say so once, up front, instead.
  useEffect(() => {
    let cancelled = false;
    fetchJson("/api/health/anthropic")
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) return; // the health route itself failing is not a key problem
        setApiHealthError(data.ok === false ? ((data.error as string) ?? "Anthropic API check failed") : null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // -- Load one student's results for review --
  const loadResultsFor = useCallback(
    async (studentId: string) => {
      const requestId = ++reviewRequestSeq.current;
      // A teacher clicking down the roster has several of these in flight at
      // once; responses can arrive out of order. Only the newest may write.
      const superseded = () => requestId !== reviewRequestSeq.current;
      try {
        const { ok, data } = await fetchJson(`/api/tests/${testId}/ai-grade?studentId=${studentId}`);
        if (superseded()) return;
        if (!ok) {
          setError((data.error as string) ?? "Could not load results for this student.");
          return;
        }
        const runs = (data.runs ?? []) as RunRow[];
        // Only this student's runs, newest first -- a response for anyone
        // else yields nothing rather than their marks under this heading.
        const mine = runsForStudent(studentId, runs);
        // Newest COMPLETE run is what gets reviewed (see loadOverview); the
        // one before it supplies "was N" hints for parts whose suggestion
        // moved between runs.
        const completeRuns = mine.filter((r) => r.status === "complete");
        const latestRun = completeRuns[0] ?? null;
        const previousRun = completeRuns[1] ?? null;
        const rows = (data.results ?? []) as ResultRow[];
        const rowsForLatest = rowsForRun(latestRun?.id ?? null, rows);
        const prev: Record<string, number> = {};
        for (const r of rowsForRun(previousRun?.id ?? null, rows)) {
          prev[r.test_item_id] = r.suggested_marks;
        }
        setPreviousMarks(prev);

        const newest = mine[0] ?? null;
        setNewerAttemptByStudent((current) => {
          const next = { ...current };
          if (newest && newest.id !== latestRun?.id) next[studentId] = newest;
          else delete next[studentId];
          return next;
        });

        setFocusRunId(latestRun?.id ?? null);
        setResults(rowsForLatest);
        setResultsStudent(studentId);
        setDrafts(Object.fromEntries(rowsForLatest.map((r) => [r.id, r.suggested_marks])));
        setSelected(
          new Set(rowsForLatest.filter((r) => !r.accepted && r.work_found).map((r) => r.id))
        );
        if (latestRun) {
          setRunsByStudent((prev) => ({ ...prev, [studentId]: latestRun }));
          setAcceptanceByRun((prev) => ({
            ...prev,
            [latestRun.id]: {
              accepted: rowsForLatest.filter((r) => r.accepted).length,
              total: rowsForLatest.length,
            },
          }));
        }
      } catch (e) {
        if (superseded()) return;
        setError(e instanceof Error ? e.message : "Could not load results for this student.");
      }
    },
    [testId]
  );

  const openReview = async (studentId: string) => {
    clearReview();
    setFocusStudent(studentId);
    setStatusLine(null);
    setError(null);
    await loadResultsFor(studentId);
  };

  // -- Run grading (fresh upload or re-use stored scan) --
  const runGrading = async (studentId: string, file: File | null) => {
    // A new run replaces the reviewable one. Parts whose new suggestion
    // matches the current one keep their accepted status (the server carries
    // it forward); anything that moves needs review again -- say so before
    // spending the call, since the teacher may have already signed this off.
    const currentRun = runsByStudent[studentId];
    const acceptedCount = currentRun ? acceptanceByRun[currentRun.id]?.accepted ?? 0 : 0;
    if (acceptedCount > 0) {
      const ok = window.confirm(
        `${acceptedCount} part(s) for this student are already accepted into Clev's Marks.\n\n` +
          "Re-marking runs the model again. Parts whose new suggestion matches the current one stay accepted; " +
          "any part whose suggestion changes will need to be reviewed and accepted again. Clev's Marks themselves are not changed.\n\n" +
          "Continue?"
      );
      if (!ok) return;
    }
    setBusyStudent(studentId);
    setError(null);
    setStatusLine(file ? "Uploading scan…" : "Marking the stored scan against the mark scheme…");
    try {
      const body: Record<string, unknown> = { studentId };
      if (file) {
        // Scanned PDFs can exceed Vercel's serverless request-body limit, so
        // upload straight to Storage from the browser (same as the batch
        // upload tab) and send only the path through JSON, never the file.
        const supaModule = await import("@/lib/supabase/client");
        const supabase = supaModule.createClient();
        const safeName = file.name.replace(/[^\w.\-]/g, "_");
        const storagePath = `${testId}/${studentId}/${Date.now()}-${safeName}`;
        const { error: uploadErr } = await supabase.storage
          .from("exam-scans")
          .upload(storagePath, file, { contentType: "application/pdf", upsert: true });
        if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);
        body.storagePath = storagePath;
        setStatusLine("Marking it against the mark scheme…");
      } else {
        body.reuseExistingScan = true;
      }

      const { ok, data } = await fetchJson(`/api/tests/${testId}/ai-grade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!ok) {
        setStatusLine(null);
        setError((data.error as string) ?? "Marking failed.");
        return;
      }

      const parts: string[] = [];
      if (typeof data.partsGraded === "number") {
        parts.push(`Marked ${data.partsGraded} of ${data.partsInAssessment ?? data.partsGraded} part(s)`);
      }
      if (data.suggestedTotal !== undefined && data.maxTotal !== undefined) {
        const gradeableSuffix =
          typeof data.testTotalMarks === "number" && data.testTotalMarks !== data.maxTotal
            ? ` of ${data.testTotalMarks} total`
            : "";
        parts.push(`suggested total ${data.suggestedTotal}/${data.maxTotal}${gradeableSuffix}`);
      }
      if (Array.isArray(data.needsReview) && data.needsReview.length > 0) {
        parts.push(`${data.needsReview.length} part(s) flagged for review`);
      }
      if (typeof data.acceptedCarriedForward === "number" && data.acceptedCarriedForward > 0) {
        parts.push(`${data.acceptedCarriedForward} previously accepted part(s) unchanged and still accepted`);
      }
      setStatusLine(parts.length > 0 ? parts.join(", ") + "." : "Marking complete.");

      clearReview();
      setFocusStudent(studentId);
      await loadResultsFor(studentId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Marking failed.");
      setStatusLine(null);
    } finally {
      setBusyStudent(null);
    }
  };

  const handleFilePicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    const studentId = pendingUploadStudent.current;
    e.target.value = "";
    pendingUploadStudent.current = null;
    if (file && studentId) await runGrading(studentId, file);
  };

  // -- Accept selected results into Clev's Marks --
  const acceptSelected = async () => {
    if (!focusRunId || selected.size === 0) return;
    setAccepting(true);
    setError(null);
    try {
      const selections = [...selected].map((resultId) => ({
        resultId,
        marks: drafts[resultId],
      }));
      const { ok, data } = await fetchJson(`/api/tests/${testId}/ai-grade/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: focusRunId, selections }),
      });
      if (!ok) {
        setError((data.error as string) ?? "Could not accept these marks.");
        return;
      }
      setStatusLine(`${data.appliedCount} mark(s) written to Clev's Marks.`);
      if (focusStudent) await loadResultsFor(focusStudent);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not accept these marks.");
    } finally {
      setAccepting(false);
    }
  };

  // -- Accept a single result into Clev's Marks (per-row, from the Status column) --
  const acceptOne = async (resultId: string) => {
    if (!focusRunId) return;
    setAcceptingRowId(resultId);
    setError(null);
    try {
      const { ok, data } = await fetchJson(`/api/tests/${testId}/ai-grade/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: focusRunId,
          selections: [{ resultId, marks: drafts[resultId] }],
        }),
      });
      if (!ok) {
        setError((data.error as string) ?? "Could not accept this mark.");
        return;
      }
      setStatusLine(`${data.appliedCount} mark(s) written to Clev's Marks.`);
      if (focusStudent) await loadResultsFor(focusStudent);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not accept this mark.");
    } finally {
      setAcceptingRowId(null);
    }
  };

  // -- Accept every not-yet-accepted suggested mark, every question, every
  // student's latest completed run -- skips the per-student review entirely,
  // so it asks for confirmation up front rather than after the fact.
  const acceptAllForTest = async () => {
    const ok = window.confirm(
      "This writes every suggested mark, for every question, for every student's latest completed run straight into " +
        "Clev's Marks -- without opening each student's review first. Already-accepted marks are left as they are. " +
        "Continue?"
    );
    if (!ok) return;
    setAcceptingAll(true);
    setError(null);
    try {
      const { ok: reqOk, data } = await fetchJson(`/api/tests/${testId}/ai-grade/accept-all`, {
        method: "POST",
      });
      if (!reqOk) {
        setError((data.error as string) ?? "Could not accept all marks.");
        return;
      }
      setStatusLine(
        `Accepted ${data.appliedCount ?? 0} mark(s) across ${data.studentsProcessed ?? 0} student(s) into Clev's Marks.`
      );
      await loadOverview();
      if (focusStudent) await loadResultsFor(focusStudent);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not accept all marks.");
    } finally {
      setAcceptingAll(false);
    }
  };

  // -- Manually correct a misread transcription, then re-grade just this part --
  const startEditEvidence = (r: ResultRow) => {
    setEvidenceDraft((prev) => ({ ...prev, [r.id]: r.evidence ?? "" }));
    setEditingEvidenceId(r.id);
  };

  const cancelEditEvidence = () => setEditingEvidenceId(null);

  const saveEvidence = async (r: ResultRow) => {
    const corrected = (evidenceDraft[r.id] ?? "").trim();
    if (corrected === (r.evidence ?? "").trim()) {
      // Nothing actually changed -- just close the editor, no need to re-grade.
      setEditingEvidenceId(null);
      return;
    }
    setRegradingId(r.id);
    setError(null);
    try {
      const { ok, data } = await fetchJson(
        `/api/tests/${testId}/ai-grade/results/${r.id}/regrade`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ evidence: corrected }),
        }
      );
      if (!ok) {
        setError((data.error as string) ?? "Could not re-grade this part.");
        return;
      }
      setStatusLine("Transcription corrected and this part re-graded.");
      setEditingEvidenceId(null);
      if (focusStudent) await loadResultsFor(focusStudent);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not re-grade this part.");
    } finally {
      setRegradingId(null);
    }
  };

  // Fetches the full scanned page a crop was taken from (with that crop's
  // region outlined) and opens it in the existing lightbox, so a teacher can
  // check a crop against its surrounding context without re-grading.
  const viewFullPage = async (r: ResultRow) => {
    setPageImageLoadingId(r.id);
    setError(null);
    try {
      const { ok, data } = await fetchJson(`/api/tests/${testId}/ai-grade/results/${r.id}/page-image`);
      if (!ok || typeof data.imageBase64 !== "string") {
        setError((data.error as string) ?? "Could not load the full page for this part.");
        return;
      }
      setLightboxUrl(`data:image/png;base64,${data.imageBase64}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the full page for this part.");
    } finally {
      setPageImageLoadingId(null);
    }
  };

  const toggle = (resultId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(resultId)) next.delete(resultId);
      else next.add(resultId);
      return next;
    });

  const toggleQuestionImage = (resultId: string) =>
    setQuestionImageShown((prev) => {
      const next = new Set(prev);
      if (next.has(resultId)) next.delete(resultId);
      else next.add(resultId);
      return next;
    });

  const toggleEvidenceImage = (resultId: string) =>
    setEvidenceImageShown((prev) => {
      const next = new Set(prev);
      if (next.has(resultId)) next.delete(resultId);
      else next.add(resultId);
      return next;
    });

  const toggleMarkschemeImage = (resultId: string) =>
    setMarkschemeImageShown((prev) => {
      const next = new Set(prev);
      if (next.has(resultId)) next.delete(resultId);
      else next.add(resultId);
      return next;
    });

  if (loading) {
    return <p className="text-sm text-da-muted">Loading this assessment…</p>;
  }

  if (!test) {
    return (
      <div className="rounded-lg border border-red-400/40 bg-red-500/15 px-4 py-3 text-sm text-red-300">
        {error ?? "This assessment could not be loaded."}
      </div>
    );
  }

  const totalItems = test.test_items.length;
  const maxTotal = test.test_items.reduce((s, i) => s + i.max_marks, 0);
  const suggestedTotal = results.reduce((s, r) => s + (drafts[r.id] ?? 0), 0);
  const focusRun = focusStudent ? runsByStudent[focusStudent] : null;

  return (
    <div className="space-y-6">
      {apiHealthError && (
        <div
          role="alert"
          className="rounded-lg border border-red-400/60 bg-red-500/15 px-4 py-3 text-sm text-red-200"
        >
          <p className="font-semibold">AI marking is currently unavailable.</p>
          <p className="mt-1">
            The Anthropic API refused a test call from this deployment&apos;s key, so every marking action on
            this page (and every other AI feature in the app) will fail the same way until it is fixed. The
            usual cause is the account running out of credit: Anthropic Console → Plans &amp; Billing.
          </p>
          <p className="mt-1 break-words font-mono text-xs text-red-300/90">{apiHealthError}</p>
        </div>
      )}

      {/* -- Tabs ---------------------------------------------------------- */}
      <div className="flex gap-1 rounded-lg border border-da-border bg-da-hover p-1 w-fit">
        <button
          type="button"
          onClick={() => setTab("individual")}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
            tab === "individual" ? "bg-da-surface text-da-text shadow-sm" : "text-da-muted hover:text-da-text"
          }`}
        >
          Individual
        </button>
        <button
          type="button"
          onClick={() => setTab("batch")}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
            tab === "batch" ? "bg-da-surface text-da-text shadow-sm" : "text-da-muted hover:text-da-text"
          }`}
        >
          Batch upload
        </button>
      </div>

      {/* Kept mounted (not conditionally rendered) so switching to Individual
          and back doesn't wipe BatchGradeTab's own state — its matched rows
          and grading progress live in that component, not here, and a
          conditional render would unmount and reset it on every tab switch. */}
      <div className={tab === "batch" ? undefined : "hidden"}>
        <BatchGradeTab testId={testId} students={students} />
      </div>

      {tab === "individual" && (
        <>
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

          {/* -- Assessment summary ------------------------------------------ */}
          <section className="rounded-xl border border-da-border bg-da-surface p-5 shadow-sm">
            <h2 className="text-lg font-bold text-da-text">{test.name}</h2>
            <p className="mt-1 text-sm text-da-muted">
              {totalItems} part{totalItems === 1 ? "" : "s"} · {maxTotal} marks total. Upload a
              scanned PDF per student — the model marks it against the mark scheme stored in the
              PPQ bank. Nothing reaches Clev&apos;s Marks until you review and accept it below.
            </p>
          </section>

          {/* -- Students ----------------------------------------------------- */}
          <section className="rounded-xl border border-da-border bg-da-surface shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-da-border px-5 py-3">
              <h2 className="text-lg font-bold text-da-text">Students</h2>
              {Object.keys(runsByStudent).length > 0 && (
                <button
                  type="button"
                  onClick={acceptAllForTest}
                  disabled={acceptingAll}
                  title="Accepts every suggested mark for every student's latest completed run, without opening each review individually"
                  className="rounded-lg border border-blue-400/40 bg-blue-500/15 px-4 py-2 text-sm font-medium text-blue-300 hover:bg-blue-500/25 disabled:opacity-50"
                >
                  {acceptingAll ? "Accepting all…" : "Accept all into Clev's Marks"}
                </button>
              )}
            </div>

            {students.length === 0 && (
              <p className="px-5 py-4 text-sm text-da-muted">
                No students are enrolled in this assessment&apos;s class.
              </p>
            )}

            <ul className="divide-y divide-da-border">
              {students.map((s, i) => {
                // Class heading above the first student of each class, only
                // when the roster spans more than one (a pooled Grade 9 track).
                const classHeading =
                  classCount > 1 && (i === 0 || students[i - 1].class_name !== s.class_name)
                    ? (s.class_name ?? "Other")
                    : null;
                const busy = busyStudent === s.profile_id;
                const run = runsByStudent[s.profile_id];
                const newerAttempt = newerAttemptByStudent[s.profile_id];
                const acceptance = run ? acceptanceByRun[run.id] : undefined;
                const dot =
                  run?.status === "complete" && acceptance && acceptance.total > 0
                    ? acceptance.accepted === acceptance.total
                      ? { color: "bg-green-500", title: "All suggested marks accepted into Clev's Marks" }
                      : acceptance.accepted === 0
                        ? { color: "bg-red-500", title: "No suggested marks accepted yet" }
                        : {
                            color: "bg-amber-500",
                            title: `${acceptance.accepted} of ${acceptance.total} suggested marks accepted`,
                          }
                    : null;
                return (
                  <Fragment key={s.profile_id}>
                    {classHeading && (
                      <li className="bg-da-hover/40 px-5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-da-muted">
                        {classHeading}
                      </li>
                    )}
                    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                      <div>
                        <p className="flex items-center gap-2 font-semibold text-da-text">
                          {dot && (
                            <span
                              className={`h-2 w-2 shrink-0 rounded-full ${dot.color}`}
                              role="img"
                              aria-label={dot.title}
                              title={dot.title}
                            />
                          )}
                          {s.display_name}
                        </p>
                        <p className="text-xs text-da-muted">
                          {run ? (
                            <>
                              Last run: {run.status}
                              {run.coverage?.suggestedTotal !== undefined &&
                                run.coverage?.maxTotal !== undefined &&
                                ` · ${run.coverage.suggestedTotal}/${run.coverage.maxTotal}${
                                  typeof run.coverage.testTotalMarks === "number" &&
                                  run.coverage.testTotalMarks !== run.coverage.maxTotal
                                    ? ` of ${run.coverage.testTotalMarks} total`
                                    : ""
                                } suggested`}
                              {run.error && ` — ${run.error}`}
                            </>
                          ) : newerAttempt ? (
                            "No completed run yet"
                          ) : (
                            "No scan graded yet"
                          )}
                        </p>
                        {newerAttempt && (
                          <p className="text-xs text-amber-300">
                            {newerAttempt.status === "failed"
                              ? `A newer re-mark failed${newerAttempt.error ? ` — ${newerAttempt.error}` : ""}. ${
                                  run ? "The last completed run is still shown." : ""
                                }`
                              : "A newer re-mark is still running."}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            pendingUploadStudent.current = s.profile_id;
                            fileInputRef.current?.click();
                          }}
                          className="rounded border border-blue-400/40 bg-blue-500/15 px-3 py-1 text-xs font-medium text-blue-300 hover:bg-blue-500/25 disabled:opacity-50"
                        >
                          {busy ? "Working…" : "Upload scan & mark"}
                        </button>

                        {(run?.source_storage_path || newerAttempt?.source_storage_path) && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => runGrading(s.profile_id, null)}
                            className="rounded border border-da-border px-3 py-1 text-xs text-da-muted hover:bg-da-hover disabled:opacity-50"
                          >
                            Re-mark stored scan
                          </button>
                        )}

                        {run?.status === "complete" && (
                          <button
                            type="button"
                            onClick={() => openReview(s.profile_id)}
                            className="rounded border border-da-border px-3 py-1 text-xs text-da-muted hover:bg-da-hover"
                          >
                            Review →
                          </button>
                        )}
                      </div>
                    </li>
                  </Fragment>
                );
              })}
            </ul>
          </section>

          {/* -- Review table ---------------------------------------------- */}
          {focusStudent && resultsStudent === focusStudent && results.length > 0 && (
            <section className="rounded-xl border border-da-border bg-da-surface shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-da-border px-5 py-3">
                <div>
                  <h2 className="text-lg font-bold text-da-text">
                    Review — {students.find((s) => s.profile_id === focusStudent)?.display_name}
                  </h2>
                  <p className="text-xs text-da-muted">
                    Suggested total {suggestedTotal} / {maxTotal}. Edit any value before accepting.
                  </p>
                  {focusStudent && newerAttemptByStudent[focusStudent] && (
                    <p className="mt-1 text-xs text-amber-300">
                      ⚠ A newer re-mark {newerAttemptByStudent[focusStudent].status === "failed" ? "failed" : "is still running"}
                      {newerAttemptByStudent[focusStudent].error ? ` — ${newerAttemptByStudent[focusStudent].error}` : ""}. Showing the last completed run.
                    </p>
                  )}
                  {focusRun?.coverage?.warnings && focusRun.coverage.warnings.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-xs text-amber-300">
                      {focusRun.coverage.warnings.map((w, i) => (
                        <li key={i}>⚠ {w}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <button
                  type="button"
                  onClick={acceptSelected}
                  disabled={accepting || selected.size === 0}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {accepting ? "Writing…" : `Accept ${selected.size} into Clev's Marks`}
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-da-border text-left text-xs uppercase tracking-wide text-da-muted">
                      <th className="px-4 py-2 font-semibold">
                        <span className="sr-only">Accept</span>
                      </th>
                      <th className="px-2 py-2 font-semibold">Question</th>
                      <th className="px-2 py-2 font-semibold">Suggested</th>
                      <th className="px-2 py-2 font-semibold">Max</th>
                      <th className="px-2 py-2 font-semibold">Confidence</th>
                      <th className="px-2 py-2 font-semibold">Mark scheme</th>
                      <th className="px-2 py-2 font-semibold">Status</th>
                      <th className="px-2 py-2 font-semibold" />
                    </tr>
                  </thead>
                  <tbody>
                    {sortReviewRows(results, (r) => itemById.get(r.test_item_id))
                      .map((r) => {
                        const meta = itemById.get(r.test_item_id);
                        const label = itemLabel(meta);
                        const isOpen = expanded === r.id;
                        return (
                          <Fragment key={r.id}>
                            <tr className="border-b border-da-border">
                              <td className="px-4 py-2">
                                <input
                                  type="checkbox"
                                  checked={selected.has(r.id)}
                                  onChange={() => toggle(r.id)}
                                  aria-label={`Accept ${label}`}
                                />
                              </td>
                              <td className="px-2 py-2 font-medium text-da-text">{label}</td>
                              <td className="px-2 py-2">
                                <input
                                  type="number"
                                  min={0}
                                  max={r.max_marks}
                                  value={drafts[r.id] ?? 0}
                                  onChange={(e) =>
                                    setDrafts((prev) => ({
                                      ...prev,
                                      [r.id]: Math.max(
                                        0,
                                        Math.min(r.max_marks, Number(e.target.value))
                                      ),
                                    }))
                                  }
                                  className="w-16 rounded border border-da-border px-2 py-1 text-sm focus:ring-2 focus:ring-blue-400"
                                />
                                {previousMarks[r.test_item_id] !== undefined &&
                                  previousMarks[r.test_item_id] !== r.suggested_marks && (
                                    <span
                                      className="ml-2 rounded border border-amber-400/40 bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-300"
                                      title="The previous completed run suggested a different mark for this part -- the model is not certain here, so it is worth a look."
                                    >
                                      was {previousMarks[r.test_item_id]}
                                    </span>
                                  )}
                              </td>
                              <td className="px-2 py-2 text-da-muted">{r.max_marks}</td>
                              <td className="px-2 py-2">
                                <span
                                  className={`rounded border px-2 py-0.5 text-xs font-medium ${CONFIDENCE_STYLE[r.confidence]}`}
                                >
                                  {r.confidence}
                                </span>
                                {!r.work_found && (
                                  <span className="ml-2 text-xs text-da-muted">no attempt found</span>
                                )}
                              </td>
                              <td className="px-2 py-2 text-xs text-da-muted">
                                {SOURCE_LABEL[r.markscheme_source]}
                              </td>
                              <td className="px-2 py-2">
                                {r.accepted ? (
                                  <span className="text-xs text-green-300">accepted</span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => acceptOne(r.id)}
                                    disabled={acceptingRowId === r.id}
                                    className="rounded border border-blue-400/40 px-2 py-0.5 text-xs font-medium text-blue-300 hover:bg-blue-500/25 disabled:opacity-50"
                                  >
                                    {acceptingRowId === r.id ? "Accepting…" : "Accept"}
                                  </button>
                                )}
                              </td>
                              <td className="px-2 py-2">
                                <button
                                  type="button"
                                  onClick={() => setExpanded(isOpen ? null : r.id)}
                                  className="text-xs text-blue-300 hover:underline"
                                >
                                  {isOpen ? "Hide" : "Why?"}
                                </button>
                              </td>
                            </tr>

                            {isOpen && (
                              <tr className="bg-da-hover">
                                <td colSpan={8} className="px-6 py-4">
                                  <div className="space-y-3">
                                    {r.mark_breakdown.length > 0 && (
                                      <div className="space-y-1.5">
                                        {groupMarkBreakdownByPart(r.mark_breakdown).map((group, gi) => (
                                          <div key={gi} className="flex flex-wrap items-center gap-2">
                                            {group.part && (
                                              <span className="text-xs font-semibold text-da-muted">{group.part}</span>
                                            )}
                                            {group.entries.map((b, i) => (
                                              <span
                                                key={i}
                                                className={`rounded border px-2 py-0.5 text-xs ${
                                                  b.awarded
                                                    ? "border-green-400/40 bg-green-500/15 text-green-300"
                                                    : "border-da-border bg-da-surface text-da-muted line-through"
                                                }`}
                                                title={b.note}
                                              >
                                                {b.token}
                                              </span>
                                            ))}
                                          </div>
                                        ))}
                                      </div>
                                    )}

                                    {r.question_image_urls.length > 0 && (
                                      <div>
                                        <button
                                          type="button"
                                          onClick={() => toggleQuestionImage(r.id)}
                                          className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-da-muted hover:text-da-text"
                                        >
                                          <span>{questionImageShown.has(r.id) ? "▾" : "▸"}</span>
                                          Question
                                        </button>
                                        {questionImageShown.has(r.id) && (
                                          <div className="mt-1 flex flex-wrap gap-2">
                                            {r.question_image_urls.map((url, i) => (
                                              // eslint-disable-next-line @next/next/no-img-element
                                              <img
                                                key={i}
                                                src={url}
                                                alt="Question source image"
                                                title="Click to enlarge"
                                                onClick={() => setLightboxUrl(url)}
                                                className="max-h-64 cursor-zoom-in rounded border border-da-border hover:border-blue-400"
                                              />
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    )}

                                    {(r.evidence || r.evidence_image_url || editingEvidenceId === r.id) && (
                                      <div>
                                        {r.evidence_image_url ? (
                                          <button
                                            type="button"
                                            onClick={() => toggleEvidenceImage(r.id)}
                                            className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-da-muted hover:text-da-text"
                                          >
                                            <span>{evidenceImageShown.has(r.id) ? "▾" : "▸"}</span>
                                            Student&apos;s work
                                          </button>
                                        ) : (
                                          <p className="text-xs font-semibold uppercase tracking-wide text-da-muted">
                                            Student&apos;s work
                                          </p>
                                        )}
                                        <div className="mt-1 space-y-2">
                                          {evidenceImageShown.has(r.id) && r.evidence_image_url && (
                                            <div className="relative inline-block">
                                              {/* eslint-disable-next-line @next/next/no-img-element */}
                                              <img
                                                src={r.evidence_image_url}
                                                alt="Cropped scan region the model read this part's work from"
                                                title="Click to enlarge"
                                                onClick={() => setLightboxUrl(r.evidence_image_url)}
                                                className="max-h-64 cursor-zoom-in rounded border border-da-border hover:border-blue-400"
                                              />
                                              {r.evidence_box && (
                                                <button
                                                  type="button"
                                                  onClick={() => viewFullPage(r)}
                                                  disabled={pageImageLoadingId === r.id}
                                                  title="Show the full page this crop was taken from"
                                                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded bg-black/60 text-xs text-white hover:bg-black/80 disabled:opacity-50"
                                                >
                                                  {pageImageLoadingId === r.id ? "…" : "⤢"}
                                                </button>
                                              )}
                                            </div>
                                          )}
                                          {editingEvidenceId === r.id ? (
                                            <div className="space-y-2">
                                              <textarea
                                                value={evidenceDraft[r.id] ?? ""}
                                                onChange={(e) =>
                                                  setEvidenceDraft((prev) => ({ ...prev, [r.id]: e.target.value }))
                                                }
                                                rows={3}
                                                placeholder="Correct the transcription of the student's work for this part -- checked against the scan above -- then save to re-grade it."
                                                className="w-full rounded border border-da-border p-2 font-mono text-xs focus:ring-2 focus:ring-blue-400"
                                              />
                                              <div className="flex gap-2">
                                                <button
                                                  type="button"
                                                  onClick={() => saveEvidence(r)}
                                                  disabled={regradingId === r.id}
                                                  className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                                                >
                                                  {regradingId === r.id ? "Re-grading…" : "Save & re-grade"}
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={cancelEditEvidence}
                                                  disabled={regradingId === r.id}
                                                  className="rounded border border-da-border px-3 py-1 text-xs text-da-muted hover:bg-da-hover disabled:opacity-50"
                                                >
                                                  Cancel
                                                </button>
                                              </div>
                                            </div>
                                          ) : (
                                            <div
                                              role="button"
                                              tabIndex={0}
                                              onClick={() => startEditEvidence(r)}
                                              onKeyDown={(e) => {
                                                if (e.key === "Enter" || e.key === " ") {
                                                  e.preventDefault();
                                                  startEditEvidence(r);
                                                }
                                              }}
                                              title="Click to fix transcription"
                                              className="cursor-text rounded border border-da-border bg-da-surface p-3 hover:border-blue-400 hover:bg-blue-500/30"
                                            >
                                              {r.evidence ? (
                                                <LatexRenderer latex={r.evidence} />
                                              ) : (
                                                <p className="text-xs text-da-muted">
                                                  No transcription on file -- click to add one.
                                                </p>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    )}

                                    {r.markscheme_image_urls.length > 0 && (
                                      <div>
                                        <button
                                          type="button"
                                          onClick={() => toggleMarkschemeImage(r.id)}
                                          className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-da-muted hover:text-da-text"
                                        >
                                          <span>{markschemeImageShown.has(r.id) ? "▾" : "▸"}</span>
                                          Mark scheme
                                        </button>
                                        {markschemeImageShown.has(r.id) && (
                                          <div className="mt-1 flex flex-wrap gap-2">
                                            {r.markscheme_image_urls.map((url, i) => (
                                              // eslint-disable-next-line @next/next/no-img-element
                                              <img
                                                key={i}
                                                src={url}
                                                alt="Mark scheme source image"
                                                title="Click to enlarge"
                                                onClick={() => setLightboxUrl(url)}
                                                className="max-h-64 cursor-zoom-in rounded border border-da-border hover:border-blue-400"
                                              />
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    )}

                                    {r.reasoning && (
                                      <div>
                                        <p className="text-xs font-semibold uppercase tracking-wide text-da-muted">
                                          Examiner reasoning
                                        </p>
                                        <div className="mt-1 rounded border border-da-border bg-da-surface p-3">
                                          <LatexRenderer latex={r.reasoning} />
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      {lightboxUrl && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Close enlarged image"
          onClick={() => setLightboxUrl(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape" || e.key === "Enter") setLightboxUrl(null);
          }}
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/80 p-6"
        >
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            className="absolute right-6 top-6 rounded-full bg-da-surface/10 px-3 py-1 text-sm text-white hover:bg-da-surface/20"
          >
            Close ✕
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxUrl}
            alt="Enlarged view"
            className="max-h-[90vh] max-w-[90vw] cursor-default rounded object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
