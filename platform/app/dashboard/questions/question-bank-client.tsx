"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { AddQuestionWizard } from "./add-question-wizard";
import { QuestionRow } from "./components/QuestionRow";
import { TestBuilderPanel } from "./components/TestBuilderPanel";
import { SECTION_NAMES, DEFAULT_COMMAND_TERMS, filterPriorLearning } from "./components/question-utils";
import type {
  Question,
  Filters,
  QuestionImage,
  DocExtractTroubleshooting,
  TestQueueItem,
  ExamConfig,
  Course,
  SavedExam,
  Subtopic,
} from "./components/types";

export function QuestionBankClient({ initialDriveConnected = false }: { initialDriveConnected?: boolean }) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [filters, setFilters] = useState<Filters | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [customTerms, setCustomTerms] = useState<string[]>([]);
  const [questionImages, setQuestionImages] = useState<Record<string, QuestionImage[]>>({});
  const [extracting, setExtracting] = useState<Set<string>>(new Set());
  const [deletingImage, setDeletingImage] = useState<Set<string>>(new Set());
  const [uploadingImage, setUploadingImage] = useState<Set<string>>(new Set());
  const [driveConnected, setDriveConnected] = useState(initialDriveConnected);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{
    found: number;
    updated: number;
    focused?: {
      code: string | null;
      status: string | null;
      requestedFocus?: { code: string | null; questionId: string | null };
      db: { id?: string; google_doc_id: string | null; google_ms_id: string | null } | null;
      needs: { doc: boolean; ms: boolean } | null;
      questionMatchCount: number;
      markschemeMatchCount: number;
      selectedQuestionDocId: string | null;
      selectedMarkschemeDocId: string | null;
      questionMatches: { id: string; name: string }[];
      markschemeMatches: { id: string; name: string }[];
      _debug?: {
        totalQuestionsLoaded: number;
        focusRequestedQuestionId: string | null;
        focusRequestedCode: string | null;
        idLookupResult: string;
        codeLookupResult: string;
        finalLookupResult: string;
        sampleIds: string[];
        codesContaining25M?: Array<{ id: string; code: string }>;
        codesContainingH6?: Array<{ id: string; code: string }>;
      };
    };
  } | null>(null);
  const [fixingLinks, setFixingLinks] = useState<false | "dryrun" | "apply">(false);
  const [fixLinksResult, setFixLinksResult] = useState<{
    dryRun: boolean;
    issuesFound: number;
    clearedGoogleDocId?: number;
    clearedGoogleMsId?: number;
    updatedRows?: number;
  } | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; updated: number; errors?: string[]; debug?: Record<string, unknown> } | null>(null);
  const [bulkExtracting, setBulkExtracting] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{
    completed: number;
    total: number;
    currentCode: string;
    totalImages: number;
    errors: number;
  } | null>(null);
  const [bulkErrors, setBulkErrors] = useState<{ code: string; error: string }[]>([]);
  const [bulkEventLog, setBulkEventLog] = useState<string[]>([]);
  const [showErrors, setShowErrors] = useState(false);
  const [docExtractTroubleshooting, setDocExtractTroubleshooting] = useState<Record<string, DocExtractTroubleshooting>>({});
  const [docTroubleshootingCopied, setDocTroubleshootingCopied] = useState<Set<string>>(new Set());
  const [bulkTroubleshootingCopied, setBulkTroubleshootingCopied] = useState(false);

  // ── ExamBuilder state ───────────────────────────────────────────────────────
  const [testBuilderOpen, setTestBuilderOpen] = useState(false);
  const [addQuestionOpen, setAddQuestionOpen] = useState(false);
  const [testQueue, setTestQueue] = useState<TestQueueItem[]>([]);
  const [examConfig, setExamConfig] = useState<ExamConfig>({
    name: "",
    curriculum: "AA",
    level: "HL",
    paper: 1,
    courseId: "",
    date: "",
    time: "",
    answerBoxMode: "auto",
    answerBoxFixedMm: 52,
  });
  const [courses, setCourses] = useState<Course[]>([]);
  useEffect(() => {
    if (courses.length > 0 && !examConfig.courseId) {
      const ah = courses.find((c) => c.name.toLowerCase().includes("27ah"));
      if (ah) {
        setExamConfig((prev) => ({ ...prev, courseId: ah.id }));
      }
    }
  }, [courses, examConfig.courseId]);
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);
  const [templateEdits, setTemplateEdits] = useState<Record<string, string>>({});
  const [savingSection, setSavingSection] = useState<Set<string>>(new Set());

  // ── Saved exams state ───────────────────────────────────────────────────────
  const [savedExams, setSavedExams] = useState<SavedExam[]>([]);
  const [showSavedExams, setShowSavedExams] = useState(false);
  const [savingExam, setSavingExam] = useState(false);
  const [loadingExams, setLoadingExams] = useState(false);
  const [deletingExamId, setDeletingExamId] = useState<string | null>(null);
  const [activeExamId, setActiveExamId] = useState<string | null>(null);
  const [examDirty, setExamDirty] = useState(false);
  const [saveExamError, setSaveExamError] = useState<string | null>(null);
  const [pendingAddQuestion, setPendingAddQuestion] = useState<Question | null>(null);
  const [savingToGradebook, setSavingToGradebook] = useState(false);

  // ── Random exam state ───────────────────────────────────────────────────────
  const [showRandomPanel, setShowRandomPanel] = useState(false);
  const [randomTargetMinutes, setRandomTargetMinutes] = useState(120);
  const [buildingRandom, setBuildingRandom] = useState(false);
  const [randomError, setRandomError] = useState<string | null>(null);
  const [courseIdError, setCourseIdError] = useState(false);
  const [pendingOpenQuestionId, setPendingOpenQuestionId] = useState<string | null>(null);

  const allCommandTerms = [...DEFAULT_COMMAND_TERMS, ...customTerms].sort(
    (a, b) => a.localeCompare(b)
  );

  useEffect(() => {
    try {
      const saved = localStorage.getItem("custom-command-terms");
      if (saved) setCustomTerms(JSON.parse(saved));
    } catch {}
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let dirty = false;

    const testId = params.get("testId");
    if (testId) {
      fetch(`/api/questions/from-test?testId=${encodeURIComponent(testId)}`)
        .then((r) => r.json())
        .then((d: {
          test?: { name?: string; courseId?: string | null; date?: string | null };
          queue?: TestQueueItem[];
          missingCodes?: string[];
          error?: string;
        }) => {
          if (d.error) { setError(d.error); return; }
          if (Array.isArray(d.queue)) {
            setTestQueue(d.queue);
            setTestBuilderOpen(true);
            setActiveExamId(null);
            setExamDirty(false);
            setShowSavedExams(false);
          }
          if (d.test) {
            setExamConfig((prev) => ({
              ...prev,
              name: d.test?.name ?? prev.name,
              courseId: d.test?.courseId ?? prev.courseId,
              date: d.test?.date ?? prev.date,
            }));
          }
          if (Array.isArray(d.missingCodes) && d.missingCodes.length > 0) {
            setError(`Some test question codes are no longer in the bank and were skipped: ${d.missingCodes.join(", ")}`);
          }
        })
        .catch(() => { setError("Failed to load linked exam in Question Bank."); });
      dirty = true;
    }

    const testItemId = params.get("testItemId");
    if (testItemId) {
      fetch(`/api/questions/from-test-item?testItemId=${encodeURIComponent(testItemId)}`)
        .then((r) => r.json())
        .then((d: { code?: string; questionId?: string | null; error?: string }) => {
          if (d.error) return;
          if (d.questionId) setPendingOpenQuestionId(d.questionId);
          if (d.code) {
            setSearch(d.code);
            setSearchContent(false);
            setSession("");
            setPaper("");
            setLevel("");
            setTimezone("");
            setSubtopic("");
            setPage(1);
          }
        })
        .catch(() => {});
      dirty = true;
    }

    if (params.get("drive_connected") === "true") { setDriveConnected(true); dirty = true; }
    if (params.get("drive_error")) { setError(`Google Drive connection failed: ${params.get("drive_error")}`); dirty = true; }
    if (params.get("search")) dirty = true;
    if (dirty) window.history.replaceState({}, "", window.location.pathname);
  }, []);

  const [search, setSearch] = useState(() => {
    try {
      if (typeof window !== "undefined") {
        const urlSearch = new URLSearchParams(window.location.search).get("search");
        if (urlSearch) return urlSearch;
      }
      return localStorage.getItem("qbank-search") ?? "";
    } catch { return ""; }
  });
  const [searchContent, setSearchContent] = useState(false);
  const [session, setSession] = useState("");
  const [paper, setPaper] = useState("");
  const [level, setLevel] = useState("");
  const [timezone, setTimezone] = useState("");
  const [subtopic, setSubtopic] = useState("");

  const pageSize = 50;

  useEffect(() => {
    fetch("/api/questions/filters")
      .then((r) => r.json())
      .then((d: Filters) => setFilters(d))
      .catch(() => {});
  }, []);

  const loadQuestions = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (searchContent) params.set("searchContent", "1");
    if (session) params.set("session", session);
    if (paper) params.set("paper", paper);
    if (level) params.set("level", level);
    if (timezone) params.set("timezone", timezone);
    if (subtopic) params.set("subtopic", subtopic);
    params.set("page", String(page));

    fetch(`/api/questions?${params}`)
      .then(async (r) => {
        const text = await r.text();
        let d: { error?: string; questions?: unknown[]; total?: number } = {};
        try { d = JSON.parse(text); } catch { setError(`Server error (${r.status}): non-JSON response`); setQuestions([]); setTotal(0); return; }
        if (d.error) { setError(d.error); setQuestions([]); setTotal(0); }
        else { setQuestions((d.questions ?? []) as Parameters<typeof setQuestions>[0]); setTotal(d.total ?? 0); }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [search, searchContent, session, paper, level, timezone, subtopic, page]);

  useEffect(() => { loadQuestions(); }, [loadQuestions]);
  useEffect(() => { setPage(1); }, [search, searchContent, session, paper, level, timezone, subtopic]);

  const openExpand = (id: string) => {
    setExpanded((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      if (!questionImages[id]) loadImages(id);
      return next;
    });
  };

  const closeExpand = (id: string) => {
    setExpanded((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    const q = questions.find((qq) => qq.id === id);
    if (q) {
      setTestQueue((prevQueue) =>
        prevQueue.map((item) =>
          item.id === id
            ? {
                ...item,
                marks: q.question_parts.reduce((sum, p) => sum + p.marks, 0),
                subtopicCodes: [...new Set(q.question_parts.flatMap((p) => filterPriorLearning(p.subtopic_codes ?? [])))],
                partSubtopics: q.question_parts
                  .map((p) => ({ partLabel: p.part_label ?? "", codes: filterPriorLearning(p.subtopic_codes ?? []) }))
                  .filter((ps) => ps.codes.length > 0),
              }
            : item
        )
      );
    }
  };

  const openQuestionFromQueue = (item: TestQueueItem) => {
    const visible = questions.find((q) => q.id === item.id);
    if (visible) { openExpand(item.id); return; }
    setPendingOpenQuestionId(item.id);
    setSearch(item.code);
    setSearchContent(false);
    setSession(""); setPaper(""); setLevel(""); setTimezone(""); setSubtopic("");
    setPage(1);
  };

  useEffect(() => {
    if (!pendingOpenQuestionId || loading) return;
    const found = questions.find((q) => q.id === pendingOpenQuestionId);
    if (!found) return;
    openExpand(found.id);
    setPendingOpenQuestionId(null);
  }, [pendingOpenQuestionId, questions, loading]);

  const loadImages = async (questionId: string) => {
    try {
      const res = await fetch(`/api/questions/images?questionId=${questionId}`);
      const data = await res.json();
      if (!data.error) setQuestionImages((prev) => ({ ...prev, [questionId]: data.images ?? [] }));
    } catch {}
  };

  const extractImages = async (question: Question) => {
    const requestStartedAt = Date.now();
    const endpoint = "/api/questions/extract-images";
    const payload = { questionId: question.id };
    if (question.google_ms_id && question.google_doc_id === question.google_ms_id) {
      const message = "Question doc and markscheme doc are the same file — question doc link needs to be fixed before extracting images.";
      setError(message);
      setDocExtractTroubleshooting((prev) => ({
        ...prev,
        [question.id]: {
          capturedAt: new Date().toISOString(), questionId: question.id, code: question.code,
          googleDocId: question.google_doc_id ?? null, googleMsId: question.google_ms_id ?? null,
          request: { endpoint, method: "POST", payload },
          response: { ok: false, status: 400, statusText: "CLIENT_PRECHECK_FAILED", durationMs: 0, body: { error: message } },
          appContext: { driveConnected, globalError: error },
        },
      }));
      return;
    }
    setExtracting((prev) => new Set(prev).add(question.id));
    setError(null);
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      let data: unknown; let parseError: string | undefined;
      try { data = await res.json(); } catch (e) { parseError = e instanceof Error ? e.message : "Failed to parse JSON response"; }
      const durationMs = Date.now() - requestStartedAt;
      const report: DocExtractTroubleshooting = {
        capturedAt: new Date().toISOString(), questionId: question.id, code: question.code,
        googleDocId: question.google_doc_id ?? null, googleMsId: question.google_ms_id ?? null,
        request: { endpoint, method: "POST", payload },
        response: { ok: res.ok, status: res.status, statusText: res.statusText, durationMs, body: data, parseError },
        appContext: { driveConnected, globalError: error },
      };
      setDocExtractTroubleshooting((prev) => ({ ...prev, [question.id]: report }));
      if (!data || typeof data !== "object") { setError(parseError ?? "Extraction failed: empty response"); return; }
      const result = data as { error?: string };
      if (result.error) {
        if (result.error.includes("Google Drive not connected")) {
          setError("Google Drive not connected. Click 'Connect Google Drive' at the top first.");
        } else { setError(result.error); }
      } else { setDriveConnected(true); await loadImages(question.id); }
    } catch (e) {
      const durationMs = Date.now() - requestStartedAt;
      const message = e instanceof Error ? e.message : "Extraction failed";
      setDocExtractTroubleshooting((prev) => ({
        ...prev,
        [question.id]: {
          capturedAt: new Date().toISOString(), questionId: question.id, code: question.code,
          googleDocId: question.google_doc_id ?? null, googleMsId: question.google_ms_id ?? null,
          request: { endpoint, method: "POST", payload },
          response: { ok: false, status: 0, statusText: "NETWORK_ERROR", durationMs, body: { error: message } },
          appContext: { driveConnected, globalError: error },
        },
      }));
      setError(message);
    } finally {
      setExtracting((prev) => { const next = new Set(prev); next.delete(question.id); return next; });
    }
  };

  const formatTroubleshooting = (t: DocExtractTroubleshooting): string => {
    const lines: string[] = [];
    lines.push("Google Doc extraction troubleshooting report");
    lines.push(`Captured at: ${t.capturedAt}`);
    lines.push(`Question code: ${t.code}`);
    lines.push(`Question id: ${t.questionId}`);
    lines.push(`Google doc id: ${t.googleDocId ?? "(none)"}`);
    lines.push(`Google markscheme id: ${t.googleMsId ?? "(none)"}`);
    lines.push("");
    lines.push("Request");
    lines.push(`- Endpoint: ${t.request.endpoint}`);
    lines.push(`- Method: ${t.request.method}`);
    lines.push(`- Payload: ${JSON.stringify(t.request.payload)}`);
    lines.push("");
    lines.push("Response");
    lines.push(`- ok: ${t.response.ok}`);
    lines.push(`- status: ${t.response.status} ${t.response.statusText}`);
    lines.push(`- durationMs: ${t.response.durationMs}`);
    if (t.response.parseError) lines.push(`- parseError: ${t.response.parseError}`);
    lines.push("");
    lines.push("Response body");
    lines.push(typeof t.response.body === "undefined" ? "(empty)" : JSON.stringify(t.response.body, null, 2));
    lines.push("");
    lines.push("App context");
    lines.push(`- driveConnected (client): ${t.appContext.driveConnected}`);
    lines.push(`- current global error: ${t.appContext.globalError ?? "(none)"}`);
    return lines.join("\n");
  };

  const copyQuestionTroubleshooting = (questionId: string) => {
    const report = docExtractTroubleshooting[questionId];
    if (!report) return;
    void navigator.clipboard.writeText(formatTroubleshooting(report)).then(() => {
      setDocTroubleshootingCopied((prev) => { const next = new Set(prev); next.add(questionId); return next; });
      setTimeout(() => {
        setDocTroubleshootingCopied((prev) => { const next = new Set(prev); next.delete(questionId); return next; });
      }, 2000);
    });
  };

  const copyBulkTroubleshooting = () => {
    const perQuestionReports = Object.values(docExtractTroubleshooting);
    const text = [
      "Bulk extract troubleshooting report",
      `Captured at: ${new Date().toISOString()}`,
      `Location: ${window.location.href}`,
      `driveConnected: ${driveConnected}`,
      `bulkExtracting: ${bulkExtracting}`,
      `syncing: ${syncing}`,
      `importing: ${importing}`,
      `globalError: ${error ?? "(none)"}`,
      `search: ${search || "(none)"}`,
      `searchContent: ${searchContent}`,
      `session: ${session || "(none)"}`,
      `paper: ${paper || "(none)"}`,
      `level: ${level || "(none)"}`,
      `timezone: ${timezone || "(none)"}`,
      `subtopic: ${subtopic || "(none)"}`,
      `page: ${page}`,
      `visibleQuestions: ${questions.length}`,
      `totalQuestions: ${total}`,
      "",
      "Bulk progress",
      JSON.stringify(bulkProgress, null, 2),
      "",
      "Bulk errors",
      JSON.stringify(bulkErrors, null, 2),
      "",
      "Import result",
      JSON.stringify(importResult, null, 2),
      "",
      "Sync result",
      JSON.stringify(syncResult, null, 2),
      "",
      "Bulk event log",
      bulkEventLog.length > 0 ? bulkEventLog.join("\n") : "(no events recorded in this tab yet)",
      "",
      "Per-question extraction troubleshooting",
      perQuestionReports.length > 0
        ? perQuestionReports.map((r) => formatTroubleshooting(r)).join("\n\n==============================\n\n")
        : "(none captured)",
      "",
      "Save exam error",
      saveExamError ?? "(none)",
    ].join("\n");
    void navigator.clipboard.writeText(text).then(() => {
      setBulkTroubleshootingCopied(true);
      setTimeout(() => setBulkTroubleshootingCopied(false), 2000);
    });
  };

  const clearUICache = () => {
    if (!confirm("Clear all UI cache? This will reset questions, filters, and cached data. You'll need to reload the page.")) return;
    setQuestions([]); setTotal(0); setPage(1); setSearch(""); setSearchContent(false);
    setSession(""); setPaper(""); setLevel(""); setTimezone(""); setSubtopic("");
    setFilters(null); setQuestionImages({}); setExpanded(new Set());
    setBulkProgress(null); setBulkErrors([]); setSyncResult(null); setFixLinksResult(null); setImportResult(null);
    try { localStorage.clear(); sessionStorage.clear(); } catch (e) { console.warn("Could not clear storage:", e); }
    setTimeout(() => { window.location.reload(); }, 500);
  };

  const deleteAllImages = async (questionId: string, allImages: QuestionImage[]) => {
    setDeletingImage((prev) => { const n = new Set(prev); for (const i of allImages) n.add(i.id); return n; });
    try {
      const res = await fetch(`/api/questions/images?questionId=${questionId}`, { method: "DELETE" });
      if (res.ok) setQuestionImages((prev) => ({ ...prev, [questionId]: [] }));
    } finally {
      setDeletingImage((prev) => { const n = new Set(prev); for (const i of allImages) n.delete(i.id); return n; });
    }
  };

  const deleteImage = async (questionId: string, imageId: string) => {
    setDeletingImage((prev) => new Set(prev).add(imageId));
    try {
      const res = await fetch(`/api/questions/images/${imageId}`, { method: "DELETE" });
      if (res.ok) {
        setQuestionImages((prev) => ({ ...prev, [questionId]: (prev[questionId] ?? []).filter((i) => i.id !== imageId) }));
      }
    } finally {
      setDeletingImage((prev) => { const next = new Set(prev); next.delete(imageId); return next; });
    }
  };

  const reorderImages = async (questionId: string, imageType: "question" | "markscheme", orderedIds: string[]) => {
    setQuestionImages((prev) => {
      const current = prev[questionId] ?? [];
      const otherType = current.filter((i) => i.image_type !== imageType);
      const reordered = orderedIds.map((id, idx) => { const img = current.find((i) => i.id === id)!; return { ...img, sort_order: idx }; });
      return { ...prev, [questionId]: [...otherType, ...reordered] };
    });
    await Promise.all(orderedIds.map((id, idx) =>
      fetch(`/api/questions/images/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sortOrder: idx }) })
    ));
  };

  const uploadImage = async (questionId: string, imageType: "question" | "markscheme", file: File) => {
    setUploadingImage((prev) => new Set(prev).add(questionId));
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => { const result = reader.result as string; resolve(result.split(",")[1]); };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await fetch("/api/questions/images/upload", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId, imageType, data: base64, mimeType: file.type || "image/png" }),
      });
      const data = await res.json();
      if (data.image) setQuestionImages((prev) => ({ ...prev, [questionId]: [...(prev[questionId] ?? []), data.image] }));
    } finally {
      setUploadingImage((prev) => { const next = new Set(prev); next.delete(questionId); return next; });
    }
  };

  const syncDriveLinks = async () => {
    setSyncing(true); setSyncResult(null); setError(null);
    try {
      const focusQuestion = questions.length === 1 ? questions[0] : null;
      const focusCode = focusQuestion?.code ?? search.trim();
      const focusQuestionId = focusQuestion?.id ?? null;
      const res = await fetch("/api/admin/sync-drive-docs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(focusCode ? { focusCode } : {}), ...(focusQuestionId ? { focusQuestionId } : {}) }),
      });
      const data = await res.json() as {
        found?: number; updated?: number; error?: string;
        focused?: {
          code: string | null; status: string | null;
          requestedFocus?: { code: string | null; questionId: string | null };
          db: { id?: string; google_doc_id: string | null; google_ms_id: string | null } | null;
          needs: { doc: boolean; ms: boolean } | null;
          questionMatchCount: number; markschemeMatchCount: number;
          selectedQuestionDocId: string | null; selectedMarkschemeDocId: string | null;
          questionMatches: { id: string; name: string }[]; markschemeMatches: { id: string; name: string }[];
          _debug?: {
            totalQuestionsLoaded: number; focusRequestedQuestionId: string | null; focusRequestedCode: string | null;
            idLookupResult: string; codeLookupResult: string; finalLookupResult: string; sampleIds: string[];
            codesContaining25M?: Array<{ id: string; code: string }>; codesContainingH6?: Array<{ id: string; code: string }>;
          };
        };
      };
      if (!res.ok) setError(data.error ?? "Sync failed");
      else setSyncResult({ found: data.found ?? 0, updated: data.updated ?? 0, focused: data.focused });
    } catch { setError("Network error during sync"); }
    finally { setSyncing(false); }
  };

  const fixConflictedLinks = async (dryRun: boolean) => {
    setFixingLinks(dryRun ? "dryrun" : "apply"); setFixLinksResult(null); setError(null);
    try {
      const res = await fetch("/api/admin/fix-conflicted-doc-links", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dryRun, limit: 100 }),
      });
      const data = await res.json() as {
        error?: string; dryRun?: boolean; issuesFound?: number; conflictedCount?: number;
        updatedRows?: number; updated?: number; clearedGoogleDocId?: number; clearedGoogleMsId?: number;
      };
      if (!res.ok) setError(data.error ?? "Fix conflicted links failed");
      else setFixLinksResult({
        dryRun: data.dryRun ?? dryRun, issuesFound: data.issuesFound ?? data.conflictedCount ?? 0,
        updatedRows: data.updatedRows ?? data.updated, clearedGoogleDocId: data.clearedGoogleDocId, clearedGoogleMsId: data.clearedGoogleMsId,
      });
    } catch { setError("Network error during fix conflicted links"); }
    finally { setFixingLinks(false); }
  };

  const importFromDrive = async () => {
    setImporting(true); setImportResult(null); setError(null);
    try {
      const res = await fetch("/api/admin/import-from-drive", { method: "POST" });
      const data = await res.json() as { created?: number; updated?: number; error?: string; errors?: string[]; debug?: Record<string, unknown> };
      if (!res.ok) setError(data.error ?? "Import failed");
      else setImportResult({ created: data.created ?? 0, updated: data.updated ?? 0, errors: data.errors, debug: data.debug });
    } catch { setError("Network error during import"); }
    finally { setImporting(false); }
  };

  const extractAllImages = async () => {
    setBulkExtracting(true);
    setBulkProgress({ completed: 0, total: 0, currentCode: "", totalImages: 0, errors: 0 });
    setBulkErrors([]); setBulkEventLog([]); setShowErrors(false); setError(null);

    const appendBulkEvent = (message: string) => {
      setBulkEventLog((prev) => { const next = [...prev, `[${new Date().toISOString()}] ${message}`]; return next.length > 400 ? next.slice(next.length - 400) : next; });
    };

    appendBulkEvent("Bulk extraction started (skipExisting=true)");

    try {
      const res = await fetch("/api/questions/extract-all-images", {
        method: "POST", redirect: "manual", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skipExisting: true }),
      });

      if (res.type === "opaqueredirect" || res.status === 0) {
        setError("Session expired. Please refresh the page and try again.");
        appendBulkEvent("Session expired or redirected before stream opened");
        setBulkExtracting(false); setBulkProgress(null); return;
      }

      if (!res.ok) {
        try { const data = await res.json(); setError(data.error ?? "Bulk extraction failed"); appendBulkEvent(`Bulk extraction HTTP ${res.status}: ${data.error ?? "Bulk extraction failed"}`); }
        catch { setError(`Bulk extraction failed (HTTP ${res.status})`); appendBulkEvent(`Bulk extraction HTTP ${res.status} with non-JSON error body`); }
        setBulkExtracting(false); setBulkProgress(null); return;
      }

      if (!res.body) { setError("No response stream"); appendBulkEvent("Bulk extraction returned no response body stream"); setBulkExtracting(false); setBulkProgress(null); return; }

      const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.type === "start") { appendBulkEvent(`Stream start: total=${msg.total}`); setBulkProgress((p) => ({ ...p!, total: msg.total })); }
            else if (msg.type === "progress") {
              if (msg.error) appendBulkEvent(`Progress ${msg.completed}/${msg.total} ${msg.code}: ERROR ${msg.error}`);
              setBulkProgress((prev) => ({
                completed: msg.completed, total: msg.total, currentCode: msg.code,
                totalImages: (prev?.totalImages ?? 0) + msg.questionImages + msg.msImages,
                errors: msg.error ? (prev?.errors ?? 0) + 1 : (prev?.errors ?? 0),
              }));
              if (msg.error) setBulkErrors((prev) => [...prev, { code: msg.code, error: msg.error }]);
            } else if (msg.type === "done") {
              appendBulkEvent(`Done: totalQuestions=${msg.totalQuestions}, totalImages=${msg.totalImages}, errors=${msg.errors}`);
              setBulkProgress({ completed: msg.totalQuestions, total: msg.totalQuestions, currentCode: "Done!", totalImages: msg.totalImages, errors: msg.errors });
            } else if (msg.type === "error") { setError(msg.error); appendBulkEvent(`Stream error: ${msg.error}`); }
          } catch (parseErr) { console.error("Failed to parse stream line:", line, parseErr); appendBulkEvent(`Failed to parse stream line: ${line.slice(0, 180)}`); }
        }
      }
      setDriveConnected(true); appendBulkEvent("Bulk extraction stream finished successfully");
    } catch (e) { setError(e instanceof Error ? e.message : "Bulk extraction failed"); appendBulkEvent(e instanceof Error ? `Exception: ${e.message}` : "Exception: Bulk extraction failed"); }
    finally { setBulkExtracting(false); }
  };

  const clearFilters = () => { setSearch(""); setSearchContent(false); setSession(""); setPaper(""); setLevel(""); setTimezone(""); setSubtopic(""); };

  const addCustomTerm = (term: string) => {
    const trimmed = term.trim();
    if (!trimmed || allCommandTerms.includes(trimmed)) return;
    const updated = [...customTerms, trimmed];
    setCustomTerms(updated);
    try { localStorage.setItem("custom-command-terms", JSON.stringify(updated)); } catch {}
  };

  const updateCommandTerm = async (partId: string, commandTerm: string | null) => {
    try {
      const res = await fetch("/api/questions/command-term", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ partId, commandTerm }) });
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setQuestions((prev) => prev.map((q) => ({
        ...q,
        question_parts: q.question_parts.map((p) =>
          p.id === partId ? { ...p, ...(data.part ?? { command_term: commandTerm, command_terms: commandTerm ? [commandTerm] : [] }) } : p
        ),
      })));
    } catch { setError("Failed to update command term"); }
  };

  const updateSubtopics = async (partId: string, codes: string[], primaryCode?: string | null) => {
    const effectivePrimary = primaryCode !== undefined ? primaryCode : codes.length === 1 ? codes[0] : undefined;
    setQuestions((prev) => prev.map((q) => ({
      ...q,
      question_parts: q.question_parts.map((p) =>
        p.id === partId ? { ...p, subtopic_codes: codes, ...(effectivePrimary !== undefined ? { primary_subtopic_code: effectivePrimary } : {}) } : p
      ),
    })));
    try {
      const res = await fetch("/api/questions/subtopics", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partId, subtopicCodes: codes, ...(primaryCode !== undefined ? { primarySubtopicCode: primaryCode } : {}) }),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setQuestions((prev) => prev.map((q) => ({
        ...q,
        question_parts: q.question_parts.map((p) =>
          p.id === partId ? { ...p, subtopic_codes: data.subtopic_codes, primary_subtopic_code: data.primary_subtopic_code ?? p.primary_subtopic_code } : p
        ),
      })));
      const ownerQ = questions.find((q) => q.question_parts.some((p) => p.id === partId));
      if (ownerQ) {
        const updatedParts = ownerQ.question_parts.map((p) =>
          p.id === partId ? { ...p, subtopic_codes: data.subtopic_codes, primary_subtopic_code: data.primary_subtopic_code ?? p.primary_subtopic_code } : p
        );
        setTestQueue((prevQueue) => prevQueue.map((item) =>
          item.id === ownerQ.id ? {
            ...item,
            marks: updatedParts.reduce((sum, p) => sum + p.marks, 0),
            subtopicCodes: [...new Set(updatedParts.flatMap((p) => filterPriorLearning(p.subtopic_codes ?? [])))],
            partSubtopics: updatedParts.map((p) => ({ partLabel: p.part_label ?? "", codes: filterPriorLearning(p.subtopic_codes ?? []) })).filter((ps) => ps.codes.length > 0),
          } : item
        ));
      }
    } catch { setError("Failed to update subtopics"); }
  };

  // ── ExamBuilder handlers ────────────────────────────────────────────────────

  useEffect(() => {
    if (!testBuilderOpen || courses.length > 0) return;
    fetch("/api/courses").then((r) => r.json()).then((d) => { if (d.courses) setCourses(d.courses); }).catch(() => {});
  }, [testBuilderOpen, courses.length]);

  const doAddToQueue = (q: Question) => {
    if (testQueue.find((item) => item.id === q.id)) return;
    setTestQueue((prev) => [...prev, {
      id: q.id, code: q.code, section: q.section, curriculum: q.curriculum ?? ["AA"],
      hasQuestion: q.has_question_images, hasMarkscheme: q.has_markscheme_images,
      marks: q.question_parts.reduce((sum, p) => sum + p.marks, 0), answerBoxMm: null,
      subtopicCodes: [...new Set(q.question_parts.flatMap((p) => filterPriorLearning(p.subtopic_codes ?? [])))],
      partSubtopics: q.question_parts.map((p) => ({ partLabel: p.part_label ?? "", codes: filterPriorLearning(p.subtopic_codes ?? []) })).filter((ps) => ps.codes.length > 0),
    }]);
    setExamDirty(true);
  };

  const addToQueue = (q: Question) => {
    if (testQueue.find((item) => item.id === q.id)) return;
    if (activeExamId) { setPendingAddQuestion(q); } else { doAddToQueue(q); }
  };

  const confirmPendingAdd = async () => {
    if (!pendingAddQuestion) return;
    const q = pendingAddQuestion;
    const newItem: TestQueueItem = {
      id: q.id, code: q.code, section: q.section, curriculum: q.curriculum ?? ["AA"],
      hasQuestion: q.has_question_images, hasMarkscheme: q.has_markscheme_images,
      marks: q.question_parts.reduce((sum, p) => sum + p.marks, 0), answerBoxMm: null,
      subtopicCodes: [...new Set(q.question_parts.flatMap((p) => filterPriorLearning(p.subtopic_codes ?? [])))],
      partSubtopics: q.question_parts.map((p) => ({ partLabel: p.part_label ?? "", codes: filterPriorLearning(p.subtopic_codes ?? []) })).filter((ps) => ps.codes.length > 0),
    };
    const newQueue = [...testQueue, newItem];
    setTestQueue(newQueue); setExamDirty(false); setPendingAddQuestion(null);
    await saveExam(newQueue);
  };

  const removeFromQueue = (id: string) => { setTestQueue((prev) => prev.filter((item) => item.id !== id)); setExamDirty(true); };
  const updateQueueSection = (id: string, section: "A" | "B") => { setTestQueue((prev) => prev.map((item) => (item.id === id ? { ...item, section } : item))); setExamDirty(true); };
  const updateQueueAnswerBoxMm = (id: string, answerBoxMm: number | null) => { setTestQueue((prev) => prev.map((item) => (item.id === id ? { ...item, answerBoxMm } : item))); setExamDirty(true); };

  const applyFixedAnswerBoxToSectionA = () => {
    const mm = Math.max(20, Math.min(140, Math.round(examConfig.answerBoxFixedMm || 52)));
    setTestQueue((prev) => prev.map((item) => (item.section === "A" ? { ...item, answerBoxMm: mm } : item)));
    setExamDirty(true);
  };

  const autoSortQueue = () => {
    setTestQueue((prev) => { const a = prev.filter((q) => q.section === "A"); const b = prev.filter((q) => q.section === "B"); const other = prev.filter((q) => q.section !== "A" && q.section !== "B"); return [...a, ...b, ...other]; });
    setExamDirty(true);
  };

  const handleMoveUp = (fromIndex: number, toIndex: number) => {
    if (fromIndex <= 0 || toIndex < 0 || fromIndex === toIndex) return;
    setTestQueue((prev) => { const next = [...prev]; [next[toIndex], next[fromIndex]] = [next[fromIndex], next[toIndex]]; return next; });
    setExamDirty(true);
  };

  const updateSection = async (questionId: string, section: "A" | "B") => {
    setSavingSection((prev) => new Set(prev).add(questionId));
    try {
      const res = await fetch("/api/questions/section", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ questionId, section }) });
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setQuestions((prev) => prev.map((q) => (q.id === questionId ? { ...q, section } : q)));
    } catch { setError("Failed to update section"); }
    finally { setSavingSection((prev) => { const next = new Set(prev); next.delete(questionId); return next; }); }
  };

  const openPreview = (imageType: "question" | "markscheme") => {
    const questionAnswerBoxMm: Record<string, number> = {};
    for (const q of testQueue) { if (typeof q.answerBoxMm === "number" && Number.isFinite(q.answerBoxMm)) questionAnswerBoxMm[q.id] = q.answerBoxMm; }
    const config = {
      questionIds: testQueue.map((q) => q.id), imageType, examName: examConfig.name || "Exam",
      curriculum: examConfig.curriculum, level: examConfig.level, paper: examConfig.paper,
      courseId: examConfig.courseId, date: examConfig.date, time: examConfig.time,
      answerBoxMode: examConfig.answerBoxMode, answerBoxFixedMm: examConfig.answerBoxFixedMm, questionAnswerBoxMm,
    };
    sessionStorage.setItem("testBuilderConfig", JSON.stringify(config));
    window.open("/dashboard/questions/test-preview", "_blank");
  };

  const saveTemplates = async () => {
    for (const [key, slideId] of Object.entries(templateEdits)) {
      const [curriculum, level, paper] = key.split("-");
      if (!slideId.trim()) continue;
      await fetch("/api/exam-templates", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ curriculum, level, paper: parseInt(paper), slide_presentation_id: slideId }) });
    }
    setShowTemplateEditor(false); setTemplateEdits({});
  };

  // ── Saved exam handlers ─────────────────────────────────────────────────────

  const fetchSavedExams = async () => {
    setLoadingExams(true); setSaveExamError(null);
    try {
      const res = await fetch("/api/exams");
      const raw = await res.text();
      let data: { exams?: SavedExam[]; error?: string } = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch { throw new Error(`Invalid response while loading saved exams (${res.status})`); }
      if (!res.ok) throw new Error(data.error || `Failed to load saved exams (${res.status})`);
      setSavedExams(Array.isArray(data.exams) ? data.exams : []);
    } catch (err) { setSaveExamError(`Failed to load saved exams: ${err instanceof Error ? err.message : String(err)}`); }
    finally { setLoadingExams(false); }
  };

  const toggleSavedExams = async () => {
    if (!showSavedExams) await fetchSavedExams();
    setShowSavedExams((v) => !v);
  };

  useEffect(() => { setTestBuilderOpen(true); setShowSavedExams(true); fetchSavedExams(); }, []);

  const saveExam = async (queueOverride?: TestQueueItem[]) => {
    const queueToSave = queueOverride ?? testQueue;
    if (!examConfig.name.trim()) { alert("Please enter an exam name before saving."); return; }
    if (queueToSave.length === 0) { alert("Add at least one question before saving."); return; }
    setSavingExam(true); setSaveExamError(null);
    try {
      if (!Array.isArray(queueToSave)) throw new Error(`Queue is not an array (got ${typeof queueToSave}: ${JSON.stringify(queueToSave)?.slice(0, 200)}). Reload the page and try again.`);
      const sanitizedQueue = queueToSave.map((item) => ({
        id: item.id, code: item.code, section: item.section, curriculum: item.curriculum,
        hasQuestion: item.hasQuestion, hasMarkscheme: item.hasMarkscheme, marks: item.marks,
        answerBoxMm: item.answerBoxMm ?? null, subtopicCodes: item.subtopicCodes, partSubtopics: item.partSubtopics,
      }));
      const payload = {
        name: examConfig.name, curriculum: examConfig.curriculum, level: examConfig.level, paper: examConfig.paper,
        course_id: examConfig.courseId || null, exam_date: examConfig.date || null, exam_time: examConfig.time || null, questions: sanitizedQueue,
      };
      const now = new Date().toISOString();
      if (activeExamId) {
        const res = await fetch("/api/exams", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: activeExamId, ...payload }) });
        if (!res.ok) throw new Error(await res.text());
        const patchedNotes = (!payload.exam_date && !payload.exam_time) ? "no_datetime" : null;
        setSavedExams((prev) => prev.map((e) =>
          e.id === activeExamId
            ? { ...e, name: payload.name.trim(), curriculum: payload.curriculum, level: payload.level, paper: payload.paper, course_id: payload.course_id, exam_date: payload.exam_date, exam_time: payload.exam_time, notes: patchedNotes, questions: sanitizedQueue, updated_at: now }
            : e
        ));
      } else {
        const res = await fetch("/api/exams", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        if (data.id) {
          setActiveExamId(data.id);
          const newExam: SavedExam = {
            id: data.id, name: payload.name.trim(), curriculum: payload.curriculum, level: payload.level, paper: payload.paper,
            course_id: payload.course_id, exam_date: payload.exam_date, exam_time: payload.exam_time,
            notes: data.notes ?? null, questions: sanitizedQueue, created_at: now, updated_at: now,
          };
          setSavedExams((prev) => [newExam, ...prev]);
          setShowSavedExams(true);
        }
      }
      setExamDirty(false);
      fetchSavedExams();
    } catch (err) { setSaveExamError(`${err instanceof Error ? err.message : String(err)}`); }
    finally { setSavingExam(false); }
  };

  const loadExam = (exam: SavedExam) => {
    const queue = Array.isArray(exam.questions) ? exam.questions : [];
    const sectionAHeights = queue.filter((item) => item.section === "A" && typeof item.answerBoxMm === "number").map((item) => Number(item.answerBoxMm));
    const uniqueHeights = [...new Set(sectionAHeights)];
    const inferredMode: "auto" | "fixed" = uniqueHeights.length === 1 ? "fixed" : "auto";
    const inferredFixedMm = uniqueHeights.length === 1 ? uniqueHeights[0] : 52;
    setTestQueue(queue);
    setExamConfig({
      name: exam.name, curriculum: exam.curriculum, level: exam.level, paper: exam.paper,
      courseId: exam.course_id ?? "", date: exam.exam_date ?? "", time: exam.exam_time ?? "",
      answerBoxMode: inferredMode, answerBoxFixedMm: inferredFixedMm,
    });
    setActiveExamId(exam.id); setExamDirty(false); setShowSavedExams(false);
  };

  const deleteExam = async (id: string) => {
    if (!confirm("Archive this saved exam?")) return;
    setDeletingExamId(id);
    try {
      const res = await fetch(`/api/exams?id=${id}`, { method: "DELETE" });
      if (!res.ok) { const body = await res.text(); throw new Error(body || "Archive failed"); }
      setSavedExams((prev) => prev.filter((e) => e.id !== id));
      if (activeExamId === id) { setActiveExamId(null); setExamDirty(false); }
    } catch (err) { setSaveExamError(`Failed to archive exam: ${err instanceof Error ? err.message : String(err)}`); }
    finally { setDeletingExamId(null); }
  };

  const saveToGradebook = async () => {
    if (!examConfig.name.trim()) { alert("Set an exam name before saving to gradebook."); return; }
    if (!examConfig.courseId) { alert("Select a course before saving to gradebook."); return; }
    if (testQueue.length === 0) { alert("Add at least one question before saving to gradebook."); return; }
    setSavingToGradebook(true);
    try {
      const res = await fetch("/api/gradebook/tests", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: examConfig.name.trim(), courseId: examConfig.courseId,
          testDate: examConfig.date || null, examTime: examConfig.time || null,
          releaseAt: examConfig.date && examConfig.time
            ? new Date(new Date(`${examConfig.date}T${examConfig.time}:00`).getTime() + 80 * 60 * 1000).toISOString()
            : null,
          questions: testQueue.map((q) => ({ id: q.id, code: q.code, marks: q.marks, subtopicCodes: q.subtopicCodes })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      window.open(`/dashboard/gradebook/${data.courseId}`, "_blank");
    } catch (err) { alert(`Failed to save to gradebook: ${err instanceof Error ? err.message : String(err)}`); }
    finally { setSavingToGradebook(false); }
  };

  const buildRandomExam = async () => {
    if (!examConfig.courseId) { setCourseIdError(true); return; }
    setCourseIdError(false); setBuildingRandom(true); setRandomError(null);
    try {
      const res = await fetch("/api/questions/random", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId: examConfig.courseId, paper: examConfig.paper, targetMinutes: randomTargetMinutes }),
      });
      const data = await res.json();
      if (data.error) { setRandomError(data.error); return; }
      setTestQueue(data.questions ?? []); setActiveExamId(null); setShowRandomPanel(false);
    } catch (e: unknown) { setRandomError(e instanceof Error ? e.message : "Failed to build random exam"); }
    finally { setBuildingRandom(false); }
  };

  const showSectionsInPanel = examConfig.paper !== 3 && examConfig.curriculum === "AA";
  const queueHasMarkscheme = testQueue.some((q) => q.hasMarkscheme);

  // Saved exams for the currently selected course — used to show green ✓ on questions already saved
  const savedExamsForCourse = examConfig.courseId
    ? savedExams.filter((e) => e.course_id === examConfig.courseId)
    : [];

  /** Returns the first saved exam (for the current course) that contains this question id. */
  function savedExamContaining(questionId: string): SavedExam | null {
    for (const exam of savedExamsForCourse) {
      if (Array.isArray(exam.questions) && exam.questions.some((q) => q.id === questionId)) {
        return exam;
      }
    }
    return null;
  }

  const totalPages = Math.ceil(total / pageSize);

  const subtopicsBySection = (filters?.subtopics ?? []).reduce(
    (acc, s) => { if (!acc[s.section]) acc[s.section] = []; acc[s.section].push(s); return acc; },
    {} as Record<number, Subtopic[]>
  );

  const totalMarks = (q: Question) => q.question_parts.reduce((sum, p) => sum + p.marks, 0);

  return (
    <div className={`flex gap-4 items-start ${testBuilderOpen ? "pr-0" : ""}`} suppressHydrationWarning>
      <div className="flex-1 min-w-0 space-y-4" suppressHydrationWarning>
      {!testBuilderOpen && (
        <div>
          <h1 className="text-3xl font-extrabold text-blue-900 drop-shadow-sm">Past Paper Questions (PPQ)</h1>
          <p className="mt-1 text-base font-medium text-blue-700">Browse, search, and filter past paper questions.</p>
        </div>
      )}
      {driveConnected ? (
        <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-sm font-semibold text-green-800">Google Drive connected</span>
            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" onClick={importFromDrive} disabled={importing || syncing || bulkExtracting} className="rounded-lg bg-violet-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-50" title="Create DB entries for Drive docs whose question codes are not yet in the database">{importing ? "Importing…" : "Import Missing from Drive"}</button>
              <button type="button" onClick={syncDriveLinks} disabled={syncing || bulkExtracting || importing || !!fixingLinks} className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50" title="Scan Drive folders and link Google Doc IDs to questions that are missing them">{syncing ? "Syncing…" : "Sync Doc Links"}</button>
              <button type="button" onClick={() => fixConflictedLinks(true)} disabled={syncing || bulkExtracting || importing || !!fixingLinks} className="rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-sm font-bold text-amber-800 hover:bg-amber-50 disabled:opacity-50" title="Scan for wrong question/markscheme doc links using Drive folder ancestry">{fixingLinks === "dryrun" ? "Scanning…" : "Dry Run Fix Links"}</button>
              <button type="button" onClick={() => fixConflictedLinks(false)} disabled={syncing || bulkExtracting || importing || !!fixingLinks} className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-50" title="Apply cleanup: clear wrong-field links before re-syncing">{fixingLinks === "apply" ? "Applying…" : "Apply Fix Links"}</button>
              <button type="button" onClick={extractAllImages} disabled={bulkExtracting || syncing || importing || !!fixingLinks} className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">{bulkExtracting ? "Extracting…" : "Extract All Images from Docs"}</button>
              <button type="button" onClick={copyBulkTroubleshooting} className="rounded-lg border border-slate-400 bg-white px-3 py-1.5 text-sm font-bold text-slate-700 hover:bg-slate-100" title="Copy bulk extraction diagnostics and errors for troubleshooting">{bulkTroubleshootingCopied ? "✓ Copied" : "Copy Logs"}</button>
              <button type="button" onClick={clearUICache} className="rounded-lg border border-red-400 bg-white px-3 py-1.5 text-sm font-bold text-red-700 hover:bg-red-50" title="Clear cached questions, filters, and storage. This will reload the page.">Clear UI Cache</button>
            </div>
          </div>
          {importResult && (
            <div className="mt-1 text-xs text-violet-700">
              <p>Import complete — {importResult.created} new question{importResult.created !== 1 ? "s" : ""} created, {importResult.updated} doc link{importResult.updated !== 1 ? "s" : ""} updated.</p>
              {importResult.errors && importResult.errors.length > 0 && <p className="text-red-600">Errors: {importResult.errors.join("; ")}</p>}
              {importResult.debug && (<details className="mt-1"><summary className="cursor-pointer underline">Debug info</summary><pre className="mt-1 max-h-40 overflow-auto rounded bg-violet-50 p-2 text-[10px] text-violet-900 whitespace-pre-wrap">{JSON.stringify(importResult.debug, null, 2)}</pre></details>)}
            </div>
          )}
          {syncResult && (
            <div className="mt-1 text-xs text-green-700 space-y-1">
              <p>Sync complete — {syncResult.found} doc link{syncResult.found !== 1 ? "s" : ""} found, {syncResult.updated} updated.</p>
              {syncResult.focused && (
                <div className="rounded border border-green-200 bg-white/80 p-2 text-[11px] text-slate-700">
                  <p>Focused code <span className="font-mono font-semibold">{syncResult.focused.code}</span>: <span className="font-semibold">{syncResult.focused.status ?? "unknown"}</span></p>
                  <p>DB Q={syncResult.focused.db?.google_doc_id ?? "null"}, MS={syncResult.focused.db?.google_ms_id ?? "null"}; needs Q={String(syncResult.focused.needs?.doc ?? false)}, MS={String(syncResult.focused.needs?.ms ?? false)}</p>
                  <p>Matches Q={syncResult.focused.questionMatchCount}, MS={syncResult.focused.markschemeMatchCount}; selected Q={syncResult.focused.selectedQuestionDocId ?? "null"}, MS={syncResult.focused.selectedMarkschemeDocId ?? "null"}</p>
                  {syncResult.focused._debug && (
                    <div className="mt-2 pt-2 border-t border-green-200 text-[10px] text-slate-600">
                      <p>DEBUG: {syncResult.focused._debug.totalQuestionsLoaded} total questions in DB</p>
                      <p>ID lookup (requested: {syncResult.focused._debug.focusRequestedQuestionId}): {syncResult.focused._debug.idLookupResult}</p>
                      <p>Code lookup (requested: "{syncResult.focused._debug.focusRequestedCode}"): {syncResult.focused._debug.codeLookupResult}</p>
                      <p>Final result: {syncResult.focused._debug.finalLookupResult}</p>
                      <p>Sample DB IDs: {syncResult.focused._debug.sampleIds.slice(0, 2).join(", ")}</p>
                      {syncResult.focused._debug.codesContaining25M && syncResult.focused._debug.codesContaining25M.length > 0 && (<div className="mt-1 pt-1 border-t border-green-200"><p className="font-semibold">Questions with "25M" in DB:</p>{syncResult.focused._debug.codesContaining25M.map((q) => (<p key={q.id} className="text-[9px]">{q.code} → ID: {q.id}</p>))}</div>)}
                      {syncResult.focused._debug.codesContaining25M && syncResult.focused._debug.codesContaining25M.length === 0 && (<p className="mt-1 pt-1 text-[9px] font-semibold text-red-600">⚠️ NO questions with "25M" found in DB!</p>)}
                      {syncResult.focused._debug.codesContainingH6 && syncResult.focused._debug.codesContainingH6.length > 0 && (<div className="mt-1 pt-1 border-t border-green-200"><p className="font-semibold">Questions with "H_6" in DB:</p>{syncResult.focused._debug.codesContainingH6.map((q) => (<p key={q.id} className="text-[9px]">{q.code} → ID: {q.id}</p>))}</div>)}
                      {syncResult.focused._debug.codesContainingH6 && syncResult.focused._debug.codesContainingH6.length === 0 && (<p className="mt-1 pt-1 text-[9px] font-semibold text-red-600">⚠️ NO questions with "H_6" found in DB!</p>)}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {fixLinksResult && (<p className="mt-1 text-xs text-amber-800">{fixLinksResult.dryRun ? `Fix dry run — ${fixLinksResult.issuesFound} issue(s) found.` : `Fix applied — ${fixLinksResult.updatedRows ?? 0} row(s), cleared Q=${fixLinksResult.clearedGoogleDocId ?? 0}, MS=${fixLinksResult.clearedGoogleMsId ?? 0}.`}</p>)}
          {bulkProgress && (
            <div className="mt-2">
              <div className="flex items-center justify-between text-xs text-gray-700 mb-1">
                <span>{bulkProgress.completed} / {bulkProgress.total} questions{bulkProgress.currentCode && ` — ${bulkProgress.currentCode}`}</span>
                <span>{bulkProgress.totalImages} images extracted{bulkProgress.errors > 0 && `, ${bulkProgress.errors} errors`}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2"><div className="bg-blue-600 h-2 rounded-full transition-all duration-300" style={{ width: bulkProgress.total > 0 ? `${(bulkProgress.completed / bulkProgress.total) * 100}%` : "0%" }} /></div>
            </div>
          )}
          {bulkErrors.length > 0 && (
            <div className="mt-2">
              <button type="button" onClick={() => setShowErrors((v) => !v)} className="text-xs font-semibold text-red-700 underline">{showErrors ? "Hide" : "Show"} {bulkErrors.length} error{bulkErrors.length !== 1 ? "s" : ""}</button>
              {showErrors && (<div className="mt-1 max-h-48 overflow-y-auto rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">{bulkErrors.slice(0, 50).map((e, i) => (<div key={i} className="py-0.5"><span className="font-bold">{e.code}:</span> {e.error}</div>))}{bulkErrors.length > 50 && (<div className="py-1 font-semibold">…and {bulkErrors.length - 50} more</div>)}</div>)}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-amber-800">Connect Google Drive to extract images from question documents.</p>
          <a href="/api/questions/connect-drive" className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-blue-700">Connect Google Drive</a>
        </div>
      )}

      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
        <div suppressHydrationWarning className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-50">
            <label className="block text-sm font-bold text-blue-900 mb-1">{searchContent ? "Search LaTeX Content" : "Search Code"}</label>
            <input suppressHydrationWarning type="text" value={search} onChange={(e) => { setSearch(e.target.value); try { localStorage.setItem("qbank-search", e.target.value); } catch {} }} placeholder={searchContent ? "e.g. \\binom, \\int..." : "e.g. 22M, TZ2, H_10..."} className="input-dark w-full rounded border-2 border-blue-300 px-3 py-1.5 text-base font-semibold text-blue-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-600" />
          </div>
          <div>
            <label className="block text-sm font-bold text-blue-900 mb-1">Session</label>
            <select suppressHydrationWarning value={session} onChange={(e) => setSession(e.target.value)} className="input-dark rounded border-2 border-blue-300 px-3 py-1.5 text-sm font-semibold text-blue-900 bg-white">
              <option value="">All</option>
              {(filters?.sessions ?? []).map((s) => (<option key={s} value={s}>{s}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-bold text-blue-900 mb-1">Paper</label>
            <select suppressHydrationWarning value={paper} onChange={(e) => setPaper(e.target.value)} className="input-dark rounded border-2 border-blue-300 px-3 py-1.5 text-sm font-semibold text-blue-900 bg-white">
              <option value="">All</option><option value="1">Paper 1</option><option value="2">Paper 2</option><option value="3">Paper 3</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-bold text-blue-900 mb-1">Level</label>
            <select suppressHydrationWarning value={level} onChange={(e) => setLevel(e.target.value)} className="input-dark rounded border-2 border-blue-300 px-3 py-1.5 text-sm font-semibold text-blue-900 bg-white">
              <option value="">All</option><option value="AHL">HL</option><option value="SL">SL</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-bold text-blue-900 mb-1">Timezone</label>
            <select suppressHydrationWarning value={timezone} onChange={(e) => setTimezone(e.target.value)} className="input-dark rounded border-2 border-blue-300 px-3 py-1.5 text-sm font-semibold text-blue-900 bg-white">
              <option value="">All</option>
              {(filters?.timezones ?? []).map((tz) => (<option key={tz} value={tz}>{tz}</option>))}
            </select>
          </div>
          <div className="min-w-55">
            <label className="block text-sm font-bold text-blue-900 mb-1">Subtopic</label>
            <select suppressHydrationWarning value={subtopic} onChange={(e) => setSubtopic(e.target.value)} className="input-dark rounded border-2 border-blue-300 px-3 py-1.5 text-sm font-semibold text-blue-900 bg-white w-full">
              <option value="">All</option>
              {Object.entries(subtopicsBySection).map(([sec, subs]) => (
                <optgroup key={sec} label={`${sec}. ${SECTION_NAMES[Number(sec)] ?? "Other"}`}>
                  {subs.map((st) => (<option key={st.code} value={st.code}>{st.code} — {st.descriptor}</option>))}
                </optgroup>
              ))}
            </select>
          </div>
          <button suppressHydrationWarning type="button" onClick={clearFilters} className="rounded-lg border-2 border-blue-400 bg-white px-3 py-1.5 text-sm font-bold text-blue-700 hover:bg-blue-100">Clear</button>
          <button suppressHydrationWarning type="button" title={searchContent ? "Searching LaTeX content — click to switch to code search" : "Click to search inside LaTeX content"} onClick={() => setSearchContent((v) => !v)} className={`rounded-lg border-2 px-3 py-1.5 text-sm font-bold transition-colors ${searchContent ? "border-purple-500 bg-purple-600 text-white" : "border-purple-300 bg-white text-purple-600 hover:bg-purple-50"}`}>LaTeX</button>
        </div>
      </div>

      {error && (
        <div className="flex items-start justify-between gap-2 rounded-lg border-2 border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-800">
          <span>Error: {error}</span>
          <button type="button" className="shrink-0 rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-200" onClick={() => { navigator.clipboard.writeText(`[${new Date().toISOString()}] Error: ${error}`).catch(() => {}); }}>Copy</button>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <p className="text-base font-bold text-blue-900">{loading ? "Loading…" : `${total} question${total !== 1 ? "s" : ""} found`}</p>
          <button type="button" suppressHydrationWarning onClick={() => setAddQuestionOpen(true)} className="rounded-lg border-2 border-emerald-400 bg-white px-3 py-1.5 text-sm font-bold text-emerald-700 hover:bg-emerald-50">+ New Question</button>
          <button type="button" onClick={() => { setTestBuilderOpen((v) => { if (!v) window.dispatchEvent(new CustomEvent("exam-builder-open")); return !v; }); }} className={`rounded-lg px-4 py-1.5 text-sm font-bold transition-colors ${testBuilderOpen ? "bg-indigo-600 text-white hover:bg-indigo-700" : "border-2 border-indigo-400 text-indigo-700 bg-white hover:bg-indigo-50"}`} suppressHydrationWarning>
            🏗 ExamBuilder{testQueue.length > 0 ? ` (${testQueue.length})` : ""}
          </button>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded border-2 border-blue-300 px-2 py-1 text-sm font-bold text-blue-900 disabled:opacity-40 hover:bg-blue-50">← Prev</button>
            <span className="text-sm font-semibold text-blue-800">Page {page} of {totalPages}</span>
            <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="rounded border-2 border-blue-300 px-2 py-1 text-sm font-bold text-blue-900 disabled:opacity-40 hover:bg-blue-50">Next →</button>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-blue-200 bg-white">
        <table className="min-w-full divide-y divide-blue-100">
          <thead className="bg-blue-50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-bold text-blue-900">Code</th>
              <th className="px-4 py-3 text-center text-sm font-bold text-blue-900">Session</th>
              <th className="px-4 py-3 text-center text-sm font-bold text-blue-900">Paper</th>
              <th className="px-4 py-3 text-center text-sm font-bold text-blue-900">Level</th>
              <th className="px-4 py-3 text-center text-sm font-bold text-blue-900">TZ</th>
              <th className="px-4 py-3 text-center text-sm font-bold text-blue-900">Parts</th>
              <th className="px-4 py-3 text-center text-sm font-bold text-blue-900">Marks</th>
              <th className="px-4 py-3 text-center text-sm font-bold text-blue-900">Images</th>
              <th className="px-4 py-3 text-center text-sm font-bold text-blue-900">Section</th>
              {testBuilderOpen && (<th className="px-3 py-3 text-center text-sm font-bold text-indigo-700">Add</th>)}
              <th className="px-2 py-3 text-center text-sm font-bold text-blue-900">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {questions.map((q) => (
              <QuestionRow
                key={q.id}
                question={q}
                expanded={expanded.has(q.id)}
                onOpen={() => openExpand(q.id)}
                onClose={() => closeExpand(q.id)}
                totalMarks={totalMarks(q)}
                commandTerms={allCommandTerms}
                onUpdateCommandTerm={updateCommandTerm}
                onAddCustomTerm={addCustomTerm}
                availableSubtopics={filters?.subtopics ?? []}
                onUpdateSubtopics={updateSubtopics}
                images={questionImages[q.id] ?? []}
                extracting={extracting.has(q.id)}
                driveConnected={driveConnected}
                onExtractImages={() => extractImages(q)}
                hasTroubleshooting={!!docExtractTroubleshooting[q.id]}
                troubleshootingCopied={docTroubleshootingCopied.has(q.id)}
                onCopyTroubleshooting={() => copyQuestionTroubleshooting(q.id)}
                deletingImageIds={deletingImage}
                uploadingImage={uploadingImage.has(q.id)}
                onDeleteImage={(imageId) => deleteImage(q.id, imageId)}
                onDeleteAllImages={() => deleteAllImages(q.id, questionImages[q.id] ?? [])}
                onReorderImages={(imageType, orderedIds) => reorderImages(q.id, imageType, orderedIds)}
                onUploadImage={(imageType, file) => uploadImage(q.id, imageType, file)}
                testBuilderOpen={testBuilderOpen}
                inQueue={!!testQueue.find((item) => item.id === q.id)}
                onAddToQueue={() => addToQueue(q)}
                savedExamWithQuestion={savedExamContaining(q.id)}
                onOpenSavedExam={loadExam}
                savingSection={savingSection.has(q.id)}
                onUpdateSection={(section) => updateSection(q.id, section)}
                onRefresh={loadQuestions}
                onQueueMarksChange={(qId, marks) =>
                  setTestQueue((prev) => prev.map((item) => item.id === qId ? { ...item, marks } : item))
                }
              />
            ))}
            {!loading && questions.length === 0 && (
              <tr><td colSpan={testBuilderOpen ? 10 : 9} className="px-4 py-8 text-center text-base text-blue-700">No questions match your filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center gap-2 pb-4">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded border-2 border-blue-300 px-3 py-1 text-sm font-bold text-blue-900 disabled:opacity-40 hover:bg-blue-50">← Prev</button>
          <span className="text-sm font-semibold text-blue-800 py-1">Page {page} of {totalPages}</span>
          <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="rounded border-2 border-blue-300 px-3 py-1 text-sm font-bold text-blue-900 disabled:opacity-40 hover:bg-blue-50">Next →</button>
        </div>
      )}
      </div>

      {testBuilderOpen && (
        <TestBuilderPanel
          queue={testQueue}
          examConfig={examConfig}
          courses={courses}
          showSections={showSectionsInPanel}
          queueHasMarkscheme={queueHasMarkscheme}
          showTemplateEditor={showTemplateEditor}
          templateEdits={templateEdits}
          onConfigChange={(updates) => { setExamConfig((prev) => ({ ...prev, ...updates })); setExamDirty(true); }}
          onRemove={removeFromQueue}
          onUpdateSection={updateQueueSection}
          onUpdateAnswerBoxMm={updateQueueAnswerBoxMm}
          onApplyFixedToSectionA={applyFixedAnswerBoxToSectionA}
          onAutoSort={autoSortQueue}
          onMoveUp={handleMoveUp}
          onPreviewTest={() => openPreview("question")}
          onPreviewMS={() => openPreview("markscheme")}
          onClear={() => { setTestQueue([]); setActiveExamId(null); }}
          onToggleTemplateEditor={() => setShowTemplateEditor((v) => !v)}
          onTemplateEditChange={(key, val) => setTemplateEdits((prev) => ({ ...prev, [key]: val }))}
          onSaveTemplates={saveTemplates}
          savedExams={savedExams}
          showSavedExams={showSavedExams}
          savingExam={savingExam}
          loadingExams={loadingExams}
          deletingExam={Boolean(deletingExamId)}
          activeExamId={activeExamId}
          examDirty={examDirty}
          saveExamError={saveExamError}
          onClearSaveExamError={() => setSaveExamError(null)}
          onSaveExam={saveExam}
          onToggleSavedExams={toggleSavedExams}
          onLoadExam={loadExam}
          onDeleteExam={deleteExam}
          showRandomPanel={showRandomPanel}
          randomTargetMinutes={randomTargetMinutes}
          buildingRandom={buildingRandom}
          randomError={randomError}
          courseIdError={courseIdError}
          onToggleRandomPanel={() => { setShowRandomPanel((v) => !v); setCourseIdError(false); setRandomError(null); }}
          onRandomTargetChange={setRandomTargetMinutes}
          onBuildRandom={buildRandomExam}
          onClearCourseIdError={() => setCourseIdError(false)}
          onOpenQuestionFromQueue={openQuestionFromQueue}
          savingToGradebook={savingToGradebook}
          onSaveToGradebook={saveToGradebook}
        />
      )}

      {addQuestionOpen && (
        <AddQuestionWizard
          availableSubtopics={filters?.subtopics ?? []}
          commandTerms={allCommandTerms}
          onAddCustomTerm={addCustomTerm}
          onClose={() => setAddQuestionOpen(false)}
          onSaved={loadQuestions}
        />
      )}

      {pendingAddQuestion && (
        <AddToExamModal
          questionCode={pendingAddQuestion.code}
          onConfirm={confirmPendingAdd}
          onCancel={() => setPendingAddQuestion(null)}
          saving={savingExam}
        />
      )}
    </div>
  );
}

function AddToExamModal({ questionCode, onConfirm, onCancel, saving }: { questionCode: string; onConfirm: () => void; onCancel: () => void; saving: boolean; }) {
  return createPortal(
    <div className="fixed inset-0 z-200 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl p-6 w-80 flex flex-col gap-4">
        <h2 className="text-base font-bold text-gray-800">Add to saved exam?</h2>
        <p className="text-sm text-gray-600">Adding <span className="font-mono font-semibold">{questionCode}</span> will overwrite the currently saved exam.</p>
        <div className="flex gap-3 justify-end">
          <button type="button" onClick={onCancel} className="rounded px-4 py-1.5 text-sm font-semibold border border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors">Cancel</button>
          <button type="button" onClick={onConfirm} disabled={saving} className="rounded px-4 py-1.5 text-sm font-semibold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition-colors">{saving ? "Saving…" : "Overwrite"}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
