"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface QuestionPart {
  id: string;
  part_label: string;
  marks: number;
  subtopic_codes: string[];
  command_term: string | null;
  sort_order: number;
}

interface QuestionImage {
  id: string;
  image_type: "question" | "markscheme";
  storage_path: string;
  sort_order: number;
  alt_text: string | null;
  url: string | null;
}

interface Question {
  id: string;
  code: string;
  session: string;
  paper: number;
  level: string;
  timezone: string;
  difficulty: number | null;
  google_doc_id: string;
  google_ms_id: string | null;
  section: "A" | "B" | null;
  curriculum: string[];
  has_question_images: boolean;
  has_markscheme_images: boolean;
  question_parts: QuestionPart[];
}

interface Course {
  id: string;
  name: string;
}

interface TestQueueItem {
  id: string;
  code: string;
  section: "A" | "B" | null;
  curriculum: string[];
  hasQuestion: boolean;
  hasMarkscheme: boolean;
  marks: number;
}

interface ExamConfig {
  name: string;
  curriculum: "AA" | "AI";
  level: "HL" | "SL";
  paper: 1 | 2 | 3;
  courseId: string;
  date: string;
}

interface Subtopic {
  code: string;
  descriptor: string;
  section: number;
}

interface Filters {
  sessions: string[];
  timezones: string[];
  subtopics: Subtopic[];
}

const SECTION_NAMES: Record<number, string> = {
  1: "Number & Algebra",
  2: "Functions",
  3: "Geometry & Trig",
  4: "Stats & Probability",
  5: "Calculus",
};

const DEFAULT_COMMAND_TERMS = [
  "Calculate",
  "Classify",
  "Comment",
  "Compare",
  "Complete",
  "Construct",
  "Copy",
  "Deduce",
  "Demonstrate",
  "Describe",
  "Determine",
  "Differentiate",
  "Distinguish",
  "Draw",
  "Estimate",
  "Evaluate",
  "Expand",
  "Explain",
  "Express",
  "Factorise",
  "Find",
  "Give",
  "Hence",
  "Identify",
  "Integrate",
  "Interpret",
  "Investigate",
  "Justify",
  "Label",
  "Let",
  "List",
  "Mark",
  "Measure",
  "Outline",
  "Plot",
  "Predict",
  "Prove",
  "Represent",
  "Show",
  "Simplify",
  "Sketch",
  "Solve",
  "State",
  "Suggest",
  "Trace",
  "Using",
  "Verify",
  "Write",
  "Write down",
];

export function QuestionBankClient() {
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
  const [uploadingImage, setUploadingImage] = useState<Set<string>>(new Set()); // keyed by questionId
  const [driveConnected, setDriveConnected] = useState(false);
  const [bulkExtracting, setBulkExtracting] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{
    completed: number;
    total: number;
    currentCode: string;
    totalImages: number;
    errors: number;
  } | null>(null);
  const [bulkErrors, setBulkErrors] = useState<{ code: string; error: string }[]>([]);
  const [showErrors, setShowErrors] = useState(false);

  // ── ExamBuilder state ───────────────────────────────────────────────────────
  const [testBuilderOpen, setTestBuilderOpen] = useState(false);
  const [testQueue, setTestQueue] = useState<TestQueueItem[]>([]);
  const [examConfig, setExamConfig] = useState<ExamConfig>({
    name: "",
    curriculum: "AA",
    level: "HL",
    paper: 1,
    courseId: "",
    date: "",
  });
  const [courses, setCourses] = useState<Course[]>([]);
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);
  const [templateEdits, setTemplateEdits] = useState<Record<string, string>>({});
  const [savingSection, setSavingSection] = useState<Set<string>>(new Set());
  const dragIndexRef = useRef<number | null>(null);

  // All available command terms (built-in + custom)
  const allCommandTerms = [...DEFAULT_COMMAND_TERMS, ...customTerms].sort(
    (a, b) => a.localeCompare(b)
  );

  // Load custom terms from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("custom-command-terms");
      if (saved) setCustomTerms(JSON.parse(saved));
    } catch {}
  }, []);

  // Detect Google Drive connection status from URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("drive_connected") === "true") {
      setDriveConnected(true);
      // Clean URL
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (params.get("drive_error")) {
      setError(`Google Drive connection failed: ${params.get("drive_error")}`);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // Filter state
  const [search, setSearch] = useState("");
  const [searchContent, setSearchContent] = useState(false);
  const [session, setSession] = useState("");
  const [paper, setPaper] = useState("");
  const [level, setLevel] = useState("");
  const [timezone, setTimezone] = useState("");
  const [subtopic, setSubtopic] = useState("");

  const pageSize = 50;

  // Load filter options on mount
  useEffect(() => {
    fetch("/api/questions/filters")
      .then((r) => r.json())
      .then((d: Filters) => setFilters(d))
      .catch(() => {});
  }, []);

  // Load questions
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
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setError(d.error);
          setQuestions([]);
          setTotal(0);
        } else {
          setQuestions(d.questions ?? []);
          setTotal(d.total ?? 0);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [search, searchContent, session, paper, level, timezone, subtopic, page]);

  useEffect(() => {
    loadQuestions();
  }, [loadQuestions]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [search, searchContent, session, paper, level, timezone, subtopic]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        next.add(id);
        // Load images when expanding if not already loaded
        if (!questionImages[id]) {
          loadImages(id);
        }
      }
      return next;
    });
  };

  const loadImages = async (questionId: string) => {
    try {
      const res = await fetch(`/api/questions/images?questionId=${questionId}`);
      const data = await res.json();
      if (!data.error) {
        setQuestionImages((prev) => ({ ...prev, [questionId]: data.images ?? [] }));
      }
    } catch {}
  };

  const extractImages = async (questionId: string) => {
    setExtracting((prev) => new Set(prev).add(questionId));
    setError(null);
    try {
      const res = await fetch("/api/questions/extract-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId }),
      });
      const data = await res.json();
      if (data.error) {
        if (data.error.includes("Google Drive not connected")) {
          setError("Google Drive not connected. Click 'Connect Google Drive' at the top first.");
        } else {
          setError(data.error);
        }
      } else {
        setDriveConnected(true);
        // Reload images for this question
        await loadImages(questionId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed");
    } finally {
      setExtracting((prev) => {
        const next = new Set(prev);
        next.delete(questionId);
        return next;
      });
    }
  };

  const deleteImage = async (questionId: string, imageId: string) => {
    setDeletingImage((prev) => new Set(prev).add(imageId));
    try {
      const res = await fetch(`/api/questions/images/${imageId}`, { method: "DELETE" });
      if (res.ok) {
        setQuestionImages((prev) => ({
          ...prev,
          [questionId]: (prev[questionId] ?? []).filter((i) => i.id !== imageId),
        }));
      }
    } finally {
      setDeletingImage((prev) => {
        const next = new Set(prev);
        next.delete(imageId);
        return next;
      });
    }
  };

  const reorderImages = async (
    questionId: string,
    imageType: "question" | "markscheme",
    orderedIds: string[]
  ) => {
    // Optimistic update
    setQuestionImages((prev) => {
      const current = prev[questionId] ?? [];
      const otherType = current.filter((i) => i.image_type !== imageType);
      const reordered = orderedIds.map((id, idx) => {
        const img = current.find((i) => i.id === id)!;
        return { ...img, sort_order: idx };
      });
      return { ...prev, [questionId]: [...otherType, ...reordered] };
    });
    // Persist each updated sort_order
    await Promise.all(
      orderedIds.map((id, idx) =>
        fetch(`/api/questions/images/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sortOrder: idx }),
        })
      )
    );
  };

  const uploadImage = async (
    questionId: string,
    imageType: "question" | "markscheme",
    file: File
  ) => {
    setUploadingImage((prev) => new Set(prev).add(questionId));
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await fetch("/api/questions/images/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId, imageType, data: base64, mimeType: file.type || "image/png" }),
      });
      const data = await res.json();
      if (data.image) {
        setQuestionImages((prev) => ({
          ...prev,
          [questionId]: [...(prev[questionId] ?? []), data.image],
        }));
      }
    } finally {
      setUploadingImage((prev) => {
        const next = new Set(prev);
        next.delete(questionId);
        return next;
      });
    }
  };

  const extractAllImages = async () => {
    setBulkProgress({ completed: 0, total: 0, currentCode: "", totalImages: 0, errors: 0 });
    setBulkErrors([]);
    setShowErrors(false);
    setError(null);

    try {
      const res = await fetch("/api/questions/extract-all-images", {
        method: "POST",
        redirect: "manual",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skipExisting: true }),
      });

      // If redirected (e.g. to login), the user isn't authenticated
      if (res.type === "opaqueredirect" || res.status === 0) {
        setError("Session expired. Please refresh the page and try again.");
        setBulkExtracting(false);
        setBulkProgress(null);
        return;
      }

      if (!res.ok) {
        try {
          const data = await res.json();
          setError(data.error ?? "Bulk extraction failed");
        } catch {
          setError(`Bulk extraction failed (HTTP ${res.status})`);
        }
        setBulkExtracting(false);
        setBulkProgress(null);
        return;
      }

      if (!res.body) {
        setError("No response stream");
        setBulkExtracting(false);
        setBulkProgress(null);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.type === "start") {
              setBulkProgress((p) => ({ ...p!, total: msg.total }));
            } else if (msg.type === "progress") {
              setBulkProgress((prev) => ({
                completed: msg.completed,
                total: msg.total,
                currentCode: msg.code,
                totalImages: (prev?.totalImages ?? 0) + msg.questionImages + msg.msImages,
                errors: msg.error ? (prev?.errors ?? 0) + 1 : (prev?.errors ?? 0),
              }));
              if (msg.error) {
                setBulkErrors((prev) => [...prev, { code: msg.code, error: msg.error }]);
              }
            } else if (msg.type === "done") {
              setBulkProgress({
                completed: msg.totalQuestions,
                total: msg.totalQuestions,
                currentCode: "Done!",
                totalImages: msg.totalImages,
                errors: msg.errors,
              });
            } else if (msg.type === "error") {
              setError(msg.error);
            }
          } catch (parseErr) {
            console.error("Failed to parse stream line:", line, parseErr);
          }
        }
      }

      setDriveConnected(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bulk extraction failed");
    } finally {
      setBulkExtracting(false);
    }
  };

  const clearFilters = () => {
    setSearch("");
    setSearchContent(false);
    setSession("");
    setPaper("");
    setLevel("");
    setTimezone("");
    setSubtopic("");
  };

  const addCustomTerm = (term: string) => {
    const trimmed = term.trim();
    if (!trimmed || allCommandTerms.includes(trimmed)) return;
    const updated = [...customTerms, trimmed];
    setCustomTerms(updated);
    try {
      localStorage.setItem("custom-command-terms", JSON.stringify(updated));
    } catch {}
  };

  const updateCommandTerm = async (partId: string, commandTerm: string | null) => {
    try {
      const res = await fetch("/api/questions/command-term", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partId, commandTerm }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        return;
      }
      setQuestions((prev) =>
        prev.map((q) => ({
          ...q,
          question_parts: q.question_parts.map((p) =>
            p.id === partId ? { ...p, command_term: data.command_term } : p
          ),
        }))
      );
    } catch {
      setError("Failed to update command term");
    }
  };

  const updateSubtopics = async (partId: string, codes: string[]) => {
    // Optimistic update
    setQuestions((prev) =>
      prev.map((q) => ({
        ...q,
        question_parts: q.question_parts.map((p) =>
          p.id === partId ? { ...p, subtopic_codes: codes } : p
        ),
      }))
    );
    try {
      const res = await fetch("/api/questions/subtopics", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partId, subtopicCodes: codes }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        return;
      }
      setQuestions((prev) =>
        prev.map((q) => ({
          ...q,
          question_parts: q.question_parts.map((p) =>
            p.id === partId ? { ...p, subtopic_codes: data.subtopic_codes } : p
          ),
        }))
      );
    } catch {
      setError("Failed to update subtopics");
    }
  };

  // ── ExamBuilder handlers ────────────────────────────────────────────────────

  // Load courses once
  useEffect(() => {
    if (!testBuilderOpen || courses.length > 0) return;
    fetch("/api/courses")
      .then((r) => r.json())
      .then((d) => { if (d.courses) setCourses(d.courses); })
      .catch(() => {});
  }, [testBuilderOpen, courses.length]);

  const addToQueue = (q: Question) => {
    if (testQueue.find((item) => item.id === q.id)) return;
    setTestQueue((prev) => [
      ...prev,
      {
        id: q.id,
        code: q.code,
        section: q.section,
        curriculum: q.curriculum ?? ["AA"],
        hasQuestion: q.has_question_images,
        hasMarkscheme: q.has_markscheme_images,
        marks: q.question_parts.reduce((sum, p) => sum + p.marks, 0),
      },
    ]);
  };

  const removeFromQueue = (id: string) => {
    setTestQueue((prev) => prev.filter((item) => item.id !== id));
  };

  const updateQueueSection = (id: string, section: "A" | "B") => {
    setTestQueue((prev) =>
      prev.map((item) => (item.id === id ? { ...item, section } : item))
    );
  };

  const autoSortQueue = () => {
    setTestQueue((prev) => {
      const a = prev.filter((q) => q.section === "A");
      const b = prev.filter((q) => q.section === "B");
      const other = prev.filter((q) => q.section !== "A" && q.section !== "B");
      return [...a, ...b, ...other];
    });
  };

  const handleDragStart = (index: number) => {
    dragIndexRef.current = index;
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndexRef.current === null || dragIndexRef.current === index) return;
    setTestQueue((prev) => {
      const next = [...prev];
      const [dragged] = next.splice(dragIndexRef.current!, 1);
      next.splice(index, 0, dragged);
      dragIndexRef.current = index;
      return next;
    });
  };

  const updateSection = async (questionId: string, section: "A" | "B") => {
    setSavingSection((prev) => new Set(prev).add(questionId));
    try {
      const res = await fetch("/api/questions/section", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId, section }),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setQuestions((prev) =>
        prev.map((q) => (q.id === questionId ? { ...q, section } : q))
      );
    } catch {
      setError("Failed to update section");
    } finally {
      setSavingSection((prev) => {
        const next = new Set(prev);
        next.delete(questionId);
        return next;
      });
    }
  };

  const openPreview = (imageType: "question" | "markscheme") => {
    const config = {
      questionIds: testQueue.map((q) => q.id),
      imageType,
      examName: examConfig.name || "Exam",
      curriculum: examConfig.curriculum,
      level: examConfig.level,
      paper: examConfig.paper,
      courseId: examConfig.courseId,
      date: examConfig.date,
    };
    sessionStorage.setItem("testBuilderConfig", JSON.stringify(config));
    window.open("/dashboard/questions/test-preview", "_blank");
  };

  const saveTemplates = async () => {
    for (const [key, slideId] of Object.entries(templateEdits)) {
      const [curriculum, level, paper] = key.split("-");
      if (!slideId.trim()) continue;
      await fetch("/api/exam-templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ curriculum, level, paper: parseInt(paper), slide_presentation_id: slideId }),
      });
    }
    setShowTemplateEditor(false);
    setTemplateEdits({});
  };

  const showSectionsInPanel =
    examConfig.paper !== 3 && examConfig.curriculum === "AA";

  const queueHasMarkscheme = testQueue.some((q) => q.hasMarkscheme);

  const totalPages = Math.ceil(total / pageSize);

  // Group subtopics by section
  const subtopicsBySection = (filters?.subtopics ?? []).reduce(
    (acc, s) => {
      if (!acc[s.section]) acc[s.section] = [];
      acc[s.section].push(s);
      return acc;
    },
    {} as Record<number, Subtopic[]>
  );

  const totalMarks = (q: Question) =>
    q.question_parts.reduce((sum, p) => sum + p.marks, 0);

  return (
    <div className={`flex gap-4 items-start ${testBuilderOpen ? "pr-0" : ""}`}>
      {/* ── Main question bank column ── */}
      <div className="flex-1 min-w-0 space-y-4">
      {!testBuilderOpen && (
        <div>
          <h1 className="text-3xl font-extrabold text-blue-900 drop-shadow-sm">
            Question Bank
          </h1>
          <p className="mt-1 text-base font-medium text-blue-700">
            Browse, search, and filter IB questions.
          </p>
        </div>
      )}
      {/* Google Drive Connection & Bulk Extract */}
      {driveConnected ? (
        <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-green-800">
              Google Drive connected
            </span>
            <button
              type="button"
              onClick={extractAllImages}
              disabled={bulkExtracting}
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {bulkExtracting ? "Extracting…" : "Extract All Images from Docs"}
            </button>
          </div>
          {bulkProgress && (
            <div className="mt-2">
              <div className="flex items-center justify-between text-xs text-gray-700 mb-1">
                <span>
                  {bulkProgress.completed} / {bulkProgress.total} questions
                  {bulkProgress.currentCode && ` — ${bulkProgress.currentCode}`}
                </span>
                <span>
                  {bulkProgress.totalImages} images extracted
                  {bulkProgress.errors > 0 && `, ${bulkProgress.errors} errors`}
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{
                    width: bulkProgress.total > 0
                      ? `${(bulkProgress.completed / bulkProgress.total) * 100}%`
                      : "0%",
                  }}
                />
              </div>
            </div>
          )}
          {bulkErrors.length > 0 && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowErrors((v) => !v)}
                className="text-xs font-semibold text-red-700 underline"
              >
                {showErrors ? "Hide" : "Show"} {bulkErrors.length} error{bulkErrors.length !== 1 ? "s" : ""}
              </button>
              {showErrors && (
                <div className="mt-1 max-h-48 overflow-y-auto rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
                  {bulkErrors.slice(0, 50).map((e, i) => (
                    <div key={i} className="py-0.5">
                      <span className="font-bold">{e.code}:</span> {e.error}
                    </div>
                  ))}
                  {bulkErrors.length > 50 && (
                    <div className="py-1 font-semibold">…and {bulkErrors.length - 50} more</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-amber-800">
            Connect Google Drive to extract images from question documents.
          </p>
          <a
            href="/api/questions/connect-drive"
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-blue-700"
          >
            Connect Google Drive
          </a>
        </div>
      )}

      {/* Filters */}
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
        <div suppressHydrationWarning className="flex flex-wrap items-end gap-3">
          {/* Search */}
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-bold text-blue-900 mb-1">
              {searchContent ? "Search LaTeX Content" : "Search Code"}
            </label>
            <input
                suppressHydrationWarning
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchContent ? "e.g. \\binom, \\int..." : "e.g. 22M, TZ2, H_10..."}
                className="w-full rounded border-2 border-blue-300 px-3 py-1.5 text-base font-semibold text-blue-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-600"
              />
          </div>

          {/* Session */}
          <div>
            <label className="block text-sm font-bold text-blue-900 mb-1">
              Session
            </label>
            <select
              suppressHydrationWarning
              value={session}
              onChange={(e) => setSession(e.target.value)}
              className="rounded border-2 border-blue-300 px-3 py-1.5 text-sm font-semibold text-blue-900 bg-white"
            >
              <option value="">All</option>
              {(filters?.sessions ?? []).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {/* Paper */}
          <div>
            <label className="block text-sm font-bold text-blue-900 mb-1">
              Paper
            </label>
            <select
              suppressHydrationWarning
              value={paper}
              onChange={(e) => setPaper(e.target.value)}
              className="rounded border-2 border-blue-300 px-3 py-1.5 text-sm font-semibold text-blue-900 bg-white"
            >
              <option value="">All</option>
              <option value="1">Paper 1</option>
              <option value="2">Paper 2</option>
              <option value="3">Paper 3</option>
            </select>
          </div>

          {/* Level */}
          <div>
            <label className="block text-sm font-bold text-blue-900 mb-1">
              Level
            </label>
            <select
              suppressHydrationWarning
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              className="rounded border-2 border-blue-300 px-3 py-1.5 text-sm font-semibold text-blue-900 bg-white"
            >
              <option value="">All</option>
              <option value="AHL">HL</option>
              <option value="SL">SL</option>
            </select>
          </div>

          {/* Timezone */}
          <div>
            <label className="block text-sm font-bold text-blue-900 mb-1">
              Timezone
            </label>
            <select
              suppressHydrationWarning
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="rounded border-2 border-blue-300 px-3 py-1.5 text-sm font-semibold text-blue-900 bg-white"
            >
              <option value="">All</option>
              {(filters?.timezones ?? []).map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>

          {/* Subtopic */}
          <div className="min-w-[220px]">
            <label className="block text-sm font-bold text-blue-900 mb-1">
              Subtopic
            </label>
            <select
              suppressHydrationWarning
              value={subtopic}
              onChange={(e) => setSubtopic(e.target.value)}
              className="rounded border-2 border-blue-300 px-3 py-1.5 text-sm font-semibold text-blue-900 bg-white w-full"
            >
              <option value="">All</option>
              {Object.entries(subtopicsBySection).map(([sec, subs]) => (
                <optgroup
                  key={sec}
                  label={`${sec}. ${SECTION_NAMES[Number(sec)] ?? "Other"}`}
                >
                  {subs.map((st) => (
                    <option key={st.code} value={st.code}>
                      {st.code} — {st.descriptor}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Clear */}
          <button
            suppressHydrationWarning
            type="button"
            onClick={clearFilters}
            className="rounded-lg border-2 border-blue-400 bg-white px-3 py-1.5 text-sm font-bold text-blue-700 hover:bg-blue-100"
          >
            Clear
          </button>

          {/* LaTeX toggle */}
          <button
            suppressHydrationWarning
            type="button"
            title={searchContent ? "Searching LaTeX content — click to switch to code search" : "Click to search inside LaTeX content"}
            onClick={() => setSearchContent((v) => !v)}
            className={`rounded-lg border-2 px-3 py-1.5 text-sm font-bold transition-colors ${
              searchContent
                ? "border-purple-500 bg-purple-600 text-white"
                : "border-purple-300 bg-white text-purple-600 hover:bg-purple-50"
            }`}
          >
            LaTeX
          </button>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="rounded-lg border-2 border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-800">
          Error: {error}
        </div>
      )}

      {/* Results header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <p className="text-base font-bold text-blue-900">
            {loading ? "Loading…" : `${total} question${total !== 1 ? "s" : ""} found`}
          </p>
          <button
            type="button"
            onClick={() => setTestBuilderOpen((v) => !v)}
            className={`rounded-lg px-4 py-1.5 text-sm font-bold transition-colors ${
              testBuilderOpen
                ? "bg-indigo-600 text-white hover:bg-indigo-700"
                : "border-2 border-indigo-400 text-indigo-700 bg-white hover:bg-indigo-50"
            }`}
          >
            🏗 ExamBuilder{testQueue.length > 0 ? ` (${testQueue.length})` : ""}
          </button>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded border-2 border-blue-300 px-2 py-1 text-sm font-bold text-blue-900 disabled:opacity-40 hover:bg-blue-50"
            >
              ← Prev
            </button>
            <span className="text-sm font-semibold text-blue-800">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded border-2 border-blue-300 px-2 py-1 text-sm font-bold text-blue-900 disabled:opacity-40 hover:bg-blue-50"
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* Questions table */}
      <div className="overflow-hidden rounded-xl border border-blue-200 bg-white">
        <table className="min-w-full divide-y divide-blue-100">
          <thead className="bg-blue-50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-bold text-blue-900">
                Code
              </th>
              <th className="px-4 py-3 text-center text-sm font-bold text-blue-900">
                Session
              </th>
              <th className="px-4 py-3 text-center text-sm font-bold text-blue-900">
                Paper
              </th>
              <th className="px-4 py-3 text-center text-sm font-bold text-blue-900">
                Level
              </th>
              <th className="px-4 py-3 text-center text-sm font-bold text-blue-900">
                TZ
              </th>
              <th className="px-4 py-3 text-center text-sm font-bold text-blue-900">
                Parts
              </th>
              <th className="px-4 py-3 text-center text-sm font-bold text-blue-900">
                Marks
              </th>
              <th className="px-4 py-3 text-center text-sm font-bold text-blue-900">
                Images
              </th>
              <th className="px-4 py-3 text-center text-sm font-bold text-blue-900">
                Section
              </th>
              {testBuilderOpen && (
                <th className="px-3 py-3 text-center text-sm font-bold text-indigo-700">
                  Add
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {questions.map((q) => (
              <QuestionRow
                key={q.id}
                question={q}
                expanded={expanded.has(q.id)}
                onToggle={() => toggleExpand(q.id)}
                totalMarks={totalMarks(q)}
                commandTerms={allCommandTerms}
                onUpdateCommandTerm={updateCommandTerm}
                onAddCustomTerm={addCustomTerm}
                availableSubtopics={filters?.subtopics ?? []}
                onUpdateSubtopics={updateSubtopics}
                images={questionImages[q.id] ?? []}
                extracting={extracting.has(q.id)}
                onExtractImages={() => extractImages(q.id)}
                deletingImageIds={deletingImage}
                uploadingImage={uploadingImage.has(q.id)}
                onDeleteImage={(imageId) => deleteImage(q.id, imageId)}
                onReorderImages={(imageType, orderedIds) => reorderImages(q.id, imageType, orderedIds)}
                onUploadImage={(imageType, file) => uploadImage(q.id, imageType, file)}
                testBuilderOpen={testBuilderOpen}
                inQueue={!!testQueue.find((item) => item.id === q.id)}
                onAddToQueue={() => addToQueue(q)}
                savingSection={savingSection.has(q.id)}
                onUpdateSection={(section) => updateSection(q.id, section)}
              />
            ))}
            {!loading && questions.length === 0 && (
              <tr>
                <td
                  colSpan={testBuilderOpen ? 10 : 9}
                  className="px-4 py-8 text-center text-base text-blue-700"
                >
                  No questions match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Bottom pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2 pb-4">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded border-2 border-blue-300 px-3 py-1 text-sm font-bold text-blue-900 disabled:opacity-40 hover:bg-blue-50"
          >
            ← Prev
          </button>
          <span className="text-sm font-semibold text-blue-800 py-1">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded border-2 border-blue-300 px-3 py-1 text-sm font-bold text-blue-900 disabled:opacity-40 hover:bg-blue-50"
          >
            Next →
          </button>
        </div>
      )}
      </div> {/* end main column */}

      {/* ── ExamBuilder Panel ── */}
      {testBuilderOpen && (
        <TestBuilderPanel
          queue={testQueue}
          examConfig={examConfig}
          courses={courses}
          showSections={showSectionsInPanel}
          queueHasMarkscheme={queueHasMarkscheme}
          showTemplateEditor={showTemplateEditor}
          templateEdits={templateEdits}
          onConfigChange={(updates) =>
            setExamConfig((prev) => ({ ...prev, ...updates }))
          }
          onRemove={removeFromQueue}
          onUpdateSection={updateQueueSection}
          onAutoSort={autoSortQueue}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onPreviewTest={() => openPreview("question")}
          onPreviewMS={() => openPreview("markscheme")}
          onClear={() => setTestQueue([])}
          onToggleTemplateEditor={() => setShowTemplateEditor((v) => !v)}
          onTemplateEditChange={(key, val) =>
            setTemplateEdits((prev) => ({ ...prev, [key]: val }))
          }
          onSaveTemplates={saveTemplates}
        />
      )}
    </div>
  );
}


function QuestionRow({
  question,
  expanded,
  onToggle,
  totalMarks,
  commandTerms,
  onUpdateCommandTerm,
  onAddCustomTerm,
  availableSubtopics,
  onUpdateSubtopics,
  images,
  extracting,
  onExtractImages,
  deletingImageIds,
  uploadingImage,
  onDeleteImage,
  onReorderImages,
  onUploadImage,
  testBuilderOpen,
  inQueue,
  onAddToQueue,
  savingSection,
  onUpdateSection,
}: {
  question: Question;
  expanded: boolean;
  onToggle: () => void;
  totalMarks: number;
  commandTerms: string[];
  onUpdateCommandTerm: (partId: string, commandTerm: string | null) => void;
  onAddCustomTerm: (term: string) => void;
  availableSubtopics: Subtopic[];
  onUpdateSubtopics: (partId: string, codes: string[]) => void;
  images: QuestionImage[];
  extracting: boolean;
  onExtractImages: () => void;
  deletingImageIds: Set<string>;
  uploadingImage: boolean;
  onDeleteImage: (imageId: string) => void;
  onReorderImages: (imageType: "question" | "markscheme", orderedIds: string[]) => void;
  onUploadImage: (imageType: "question" | "markscheme", file: File) => void;
  testBuilderOpen: boolean;
  inQueue: boolean;
  onAddToQueue: () => void;
  savingSection: boolean;
  onUpdateSection: (section: "A" | "B") => void;
}) {
  const showSection = question.paper !== 3;

  return (
    <>
      <tr
        className="cursor-pointer hover:bg-blue-50 transition-colors"
        onClick={onToggle}
      >
        <td className="px-4 py-2">
          <span className="font-bold text-blue-900">{question.code}</span>
        </td>
        <td className="px-4 py-2 text-center text-sm font-semibold text-gray-800">
          {question.session}
        </td>
        <td className="px-4 py-2 text-center text-sm font-semibold text-gray-800">
          P{question.paper}
        </td>
        <td className="px-4 py-2 text-center">
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${
              question.level === "AHL"
                ? "bg-purple-100 text-purple-800"
                : "bg-green-100 text-green-800"
            }`}
          >
            {question.level === "AHL" ? "HL" : question.level}
          </span>
        </td>
        <td className="px-4 py-2 text-center text-sm font-semibold text-gray-800">
          {question.timezone}
        </td>
        <td className="px-4 py-2 text-center text-sm font-bold text-blue-900">
          {question.question_parts.length}
        </td>
        <td className="px-4 py-2 text-center text-sm font-bold text-blue-900">
          {totalMarks}
        </td>
        <td className="px-4 py-2 text-center">
          <div className="flex items-center justify-center gap-2">
            <a
              href={`https://docs.google.com/document/d/${question.google_doc_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline text-xs font-semibold"
              onClick={(e) => e.stopPropagation()}
              title="Question images"
            >
              📄 Q
            </a>
            {question.google_ms_id && (
              <a
                href={`https://docs.google.com/document/d/${question.google_ms_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-green-600 hover:underline text-xs font-semibold"
                onClick={(e) => e.stopPropagation()}
                title="Markscheme images"
              >
                📝 MS
              </a>
            )}
          </div>
        </td>
        {/* Section badge (editable for P1/P2) */}
        <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
          {showSection ? (
            <div className="flex items-center justify-center gap-1">
              <button
                type="button"
                disabled={savingSection}
                onClick={() => onUpdateSection("A")}
                className={`rounded px-1.5 py-0.5 text-xs font-bold transition-colors ${
                  question.section === "A"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-500 hover:bg-blue-100"
                }`}
              >
                A
              </button>
              <button
                type="button"
                disabled={savingSection}
                onClick={() => onUpdateSection("B")}
                className={`rounded px-1.5 py-0.5 text-xs font-bold transition-colors ${
                  question.section === "B"
                    ? "bg-orange-500 text-white"
                    : "bg-gray-100 text-gray-500 hover:bg-orange-100"
                }`}
              >
                B
              </button>
            </div>
          ) : (
            <span className="text-xs text-gray-400">—</span>
          )}
        </td>
        {/* Add to test button */}
        {testBuilderOpen && (
          <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
            {question.has_question_images ? (
              <button
                type="button"
                onClick={onAddToQueue}
                disabled={inQueue}
                title={inQueue ? "Already in queue" : "Add to test"}
                className={`rounded-full w-7 h-7 text-sm font-bold transition-colors ${
                  inQueue
                    ? "bg-indigo-100 text-indigo-400 cursor-default"
                    : "bg-indigo-600 text-white hover:bg-indigo-700"
                }`}
              >
                {inQueue ? "✓" : "+"}
              </button>
            ) : (
              <span className="text-xs text-gray-300" title="No images extracted">—</span>
            )}
          </td>
        )}
      </tr>
      {expanded && (
        <tr>
          <td colSpan={testBuilderOpen ? 10 : 9} className="bg-blue-50 px-4 py-3">
            {question.question_parts.length > 0 && (
            <div className="ml-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-blue-200">
                    <th className="px-2 py-1 text-left font-bold text-blue-900">
                      Part
                    </th>
                    <th className="px-2 py-1 text-center font-bold text-blue-900">
                      Marks
                    </th>
                    <th className="px-2 py-1 text-left font-bold text-blue-900">
                      Subtopics
                    </th>
                    <th className="px-2 py-1 text-left font-bold text-blue-900">
                      Command Term
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {question.question_parts.map((part) => (
                    <tr
                      key={part.id}
                      className="border-b border-blue-100 last:border-0"
                    >
                      <td className="px-2 py-1 font-bold text-blue-800">
                        {part.part_label || "(whole)"}
                      </td>
                      <td className="px-2 py-1 text-center font-bold text-blue-900">
                        {part.marks}
                      </td>
                      <td className="px-2 py-1" onClick={(e) => e.stopPropagation()}>
                        <SubtopicEditor
                          codes={part.subtopic_codes}
                          available={availableSubtopics}
                          onChange={(codes) => onUpdateSubtopics(part.id, codes)}
                        />
                      </td>
                      <td className="px-2 py-1" onClick={(e) => e.stopPropagation()}>
                        <CommandTermSelect
                          value={part.command_term}
                          terms={commandTerms}
                          onChange={(term) => onUpdateCommandTerm(part.id, term)}
                          onAddCustom={onAddCustomTerm}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}

            {/* Images Section */}
            <div className="ml-4 mt-3 border-t border-blue-200 pt-3">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-sm font-bold text-blue-900">Images</span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onExtractImages(); }}
                  disabled={extracting}
                  className="rounded-lg border border-blue-400 bg-white px-3 py-1 text-xs font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                >
                  {extracting ? "Extracting…" : images.length > 0 ? "Re-extract" : "Extract from Docs"}
                </button>
                {images.length > 0 && (
                  <span className="text-xs text-gray-500">
                    {images.filter(i => i.image_type === "question").length} question,{" "}
                    {images.filter(i => i.image_type === "markscheme").length} markscheme
                  </span>
                )}
              </div>

              <div className="space-y-4">
                <ImageGroup
                  label="Question"
                  labelColor="blue"
                  questionId={question.id}
                  imageType="question"
                  images={images.filter(i => i.image_type === "question")}
                  deletingImageIds={deletingImageIds}
                  uploading={uploadingImage}
                  onDelete={onDeleteImage}
                  onReorder={(orderedIds) => onReorderImages("question", orderedIds)}
                  onUpload={(file) => onUploadImage("question", file)}
                />
                <ImageGroup
                  label="Markscheme"
                  labelColor="green"
                  questionId={question.id}
                  imageType="markscheme"
                  images={images.filter(i => i.image_type === "markscheme")}
                  deletingImageIds={deletingImageIds}
                  uploading={uploadingImage}
                  onDelete={onDeleteImage}
                  onReorder={(orderedIds) => onReorderImages("markscheme", orderedIds)}
                  onUpload={(file) => onUploadImage("markscheme", file)}
                />
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Image Group ──────────────────────────────────────────────────────────────

function ImageGroup({
  label,
  labelColor,
  questionId,
  imageType,
  images,
  deletingImageIds,
  uploading,
  onDelete,
  onReorder,
  onUpload,
}: {
  label: string;
  labelColor: "blue" | "green";
  questionId: string;
  imageType: "question" | "markscheme";
  images: QuestionImage[];
  deletingImageIds: Set<string>;
  uploading: boolean;
  onDelete: (imageId: string) => void;
  onReorder: (orderedIds: string[]) => void;
  onUpload: (file: File) => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const dragIdx = useRef<number | null>(null);

  const borderColor = labelColor === "blue" ? "border-blue-200" : "border-green-200";
  const hoverBorderColor = labelColor === "blue" ? "hover:border-blue-500" : "hover:border-green-500";
  const labelClass = labelColor === "blue"
    ? "text-xs font-semibold text-blue-800 mb-1"
    : "text-xs font-semibold text-green-800 mb-1";

  const handlePaste = (e: React.ClipboardEvent) => {
    e.stopPropagation();
    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find((item) => item.type.startsWith("image/"));
    if (imageItem) {
      const file = imageItem.getAsFile();
      if (file) onUpload(file);
    }
  };

  const handleDragStart = (idx: number) => {
    dragIdx.current = idx;
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx.current === null || dragIdx.current === idx) return;
    const newOrder = [...images];
    const [moved] = newOrder.splice(dragIdx.current, 1);
    newOrder.splice(idx, 0, moved);
    dragIdx.current = idx;
    onReorder(newOrder.map((i) => i.id));
  };

  return (
    <div>
      {/* Label only shown if there are images or we always want the paste target */}
      <div className="flex items-center gap-2 mb-1">
        <p className={labelClass}>{label}</p>
        {uploading && (
          <span className="text-xs text-gray-400 italic">Uploading…</span>
        )}
      </div>

      <div
        className={`rounded-lg border-2 border-dashed p-2 min-h-[60px] transition-colors ${
          labelColor === "blue" ? "border-blue-200 bg-blue-50/30" : "border-green-200 bg-green-50/30"
        }`}
        onPaste={handlePaste}
        onClick={(e) => e.stopPropagation()}
      >
        {images.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-2">
            📋 Paste an image from clipboard to add
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {images.map((img, idx) => (
              <div
                key={img.id}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                className="relative group cursor-grab active:cursor-grabbing"
              >
                {/* Drag handle overlay (top-left corner) */}
                <div className="absolute top-1 left-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 rounded px-1 py-0.5 text-white text-xs select-none pointer-events-none">
                  ⠿
                </div>

                {/* Image */}
                <a
                  href={img.url ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url ?? ""}
                    alt={img.alt_text ?? `${label} image ${idx + 1}`}
                    className={`max-h-40 rounded border bg-white p-1 ${borderColor} ${hoverBorderColor} hover:shadow-md transition-all ${
                      deletingImageIds.has(img.id) ? "opacity-40" : ""
                    }`}
                    draggable={false}
                  />
                </a>

                {/* Delete button (top-right) */}
                {confirmingDelete === img.id ? (
                  <div
                    className="absolute inset-0 flex flex-col items-center justify-center bg-red-900/80 rounded gap-1 z-20"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="text-white text-xs font-bold">Delete?</span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        disabled={deletingImageIds.has(img.id)}
                        onClick={() => { onDelete(img.id); setConfirmingDelete(null); }}
                        className="rounded bg-red-500 text-white text-xs font-bold px-2 py-0.5 hover:bg-red-400 disabled:opacity-50"
                      >
                        {deletingImageIds.has(img.id) ? "…" : "Yes"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingDelete(null)}
                        className="rounded bg-gray-200 text-gray-800 text-xs font-bold px-2 py-0.5 hover:bg-gray-300"
                      >
                        No
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); setConfirmingDelete(img.id); }}
                    className="absolute top-1 right-1 z-10 opacity-0 group-hover:opacity-100 rounded-full w-5 h-5 flex items-center justify-center bg-red-600 text-white text-xs font-bold hover:bg-red-500 transition-opacity"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Always show paste hint below images if there are some */}
        {images.length > 0 && (
          <p className="text-xs text-gray-400 mt-1 text-center">
            📋 Paste an image to add · drag to reorder
          </p>
        )}
      </div>
    </div>
  );
}

function SubtopicEditor({
  codes,
  available,
  onChange,
}: {
  codes: string[];
  available: Subtopic[];
  onChange: (codes: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const removeTopic = (code: string) => {
    onChange(codes.filter((c) => c !== code));
  };

  const addTopic = (code: string) => {
    if (!codes.includes(code)) {
      onChange([...codes, code].sort());
    }
    setSearch("");
    setOpen(false);
  };

  // Group available by section, filter by search and already-selected
  const filtered = available.filter(
    (s) =>
      !codes.includes(s.code) &&
      (search === "" ||
        s.code.toLowerCase().includes(search.toLowerCase()) ||
        s.descriptor.toLowerCase().includes(search.toLowerCase()))
  );

  const grouped = filtered.reduce(
    (acc, s) => {
      if (!acc[s.section]) acc[s.section] = [];
      acc[s.section].push(s);
      return acc;
    },
    {} as Record<number, Subtopic[]>
  );

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-1">
        {codes.map((c) => {
          const sub = available.find((s) => s.code === c);
          return (
            <span
              key={c}
              className="inline-flex items-center gap-0.5 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800"
              title={sub?.descriptor}
            >
              {c}
              <button
                type="button"
                onClick={() => removeTopic(c)}
                className="ml-0.5 text-blue-500 hover:text-red-600 font-bold leading-none"
                title="Remove"
              >
                ×
              </button>
            </span>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="inline-flex items-center rounded-full border border-dashed border-blue-300 px-2 py-0.5 text-xs font-semibold text-blue-600 hover:bg-blue-50"
        >
          + Add
        </button>
      </div>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-blue-200 bg-white shadow-lg">
          <div className="p-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search subtopics..."
              autoFocus
              className="w-full rounded border border-blue-300 px-2 py-1 text-xs font-semibold text-blue-900 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="max-h-48 overflow-y-auto px-1 pb-2">
            {Object.entries(grouped).length === 0 && (
              <p className="px-2 py-1 text-xs text-gray-400">No matches</p>
            )}
            {Object.entries(grouped)
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([sec, subs]) => (
                <div key={sec}>
                  <div className="sticky top-0 bg-white px-2 py-0.5 text-xs font-bold text-gray-500">
                    {sec}. {SECTION_NAMES[Number(sec)] ?? "Other"}
                  </div>
                  {subs.map((s) => (
                    <button
                      key={s.code}
                      type="button"
                      onClick={() => addTopic(s.code)}
                      className="block w-full px-3 py-1 text-left text-xs hover:bg-blue-50 rounded"
                    >
                      <span className="font-bold text-blue-800">{s.code}</span>{" "}
                      <span className="text-gray-600">{s.descriptor}</span>
                    </button>
                  ))}
                </div>
              ))}
          </div>
          <div className="border-t border-blue-100 p-1">
            <button
              type="button"
              onClick={() => { setOpen(false); setSearch(""); }}
              className="w-full rounded px-2 py-1 text-xs font-bold text-gray-600 hover:bg-gray-100"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CommandTermSelect({
  value,
  terms,
  onChange,
  onAddCustom,
}: {
  value: string | null;
  terms: string[];
  onChange: (term: string | null) => void;
  onAddCustom: (term: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newTerm, setNewTerm] = useState("");

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === "__add__") {
      setAdding(true);
      return;
    }
    if (val === "__clear__") {
      onChange(null);
      return;
    }
    onChange(val);
  };

  const handleAddSubmit = () => {
    const trimmed = newTerm.trim();
    if (trimmed) {
      onAddCustom(trimmed);
      onChange(trimmed);
    }
    setAdding(false);
    setNewTerm("");
  };

  if (adding) {
    return (
      <div className="flex gap-1">
        <input
          type="text"
          value={newTerm}
          onChange={(e) => setNewTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAddSubmit();
            if (e.key === "Escape") { setAdding(false); setNewTerm(""); }
          }}
          placeholder="New term..."
          autoFocus
          className="w-28 rounded border border-blue-300 px-2 py-0.5 text-xs font-semibold text-blue-900 bg-white focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={handleAddSubmit}
          className="rounded bg-blue-600 px-2 py-0.5 text-xs font-bold text-white hover:bg-blue-700"
        >
          Add
        </button>
        <button
          type="button"
          onClick={() => { setAdding(false); setNewTerm(""); }}
          className="rounded bg-gray-200 px-2 py-0.5 text-xs font-bold text-gray-700 hover:bg-gray-300"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <select
      value={value ?? ""}
      onChange={handleChange}
      className={`rounded border px-2 py-0.5 text-xs font-semibold ${
        value
          ? "border-green-400 bg-green-50 text-green-800"
          : "border-gray-300 bg-white text-gray-500"
      }`}
    >
      <option value="">— Select —</option>
      {value && <option value="__clear__">✕ Clear</option>}
      {terms.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
      <option value="__add__">+ Add custom…</option>
    </select>
  );
}

// ─── ExamBuilder Panel ─────────────────────────────────────────────────────────

const ALL_TEMPLATES = [
  { curriculum: "AA", level: "HL", paper: 1 },
  { curriculum: "AA", level: "HL", paper: 2 },
  { curriculum: "AA", level: "HL", paper: 3 },
  { curriculum: "AA", level: "SL", paper: 1 },
  { curriculum: "AA", level: "SL", paper: 2 },
  { curriculum: "AI", level: "HL", paper: 1 },
  { curriculum: "AI", level: "HL", paper: 2 },
  { curriculum: "AI", level: "HL", paper: 3 },
  { curriculum: "AI", level: "SL", paper: 1 },
  { curriculum: "AI", level: "SL", paper: 2 },
];

function TestBuilderPanel({
  queue,
  examConfig,
  courses,
  showSections,
  queueHasMarkscheme,
  showTemplateEditor,
  templateEdits,
  onConfigChange,
  onRemove,
  onUpdateSection,
  onAutoSort,
  onDragStart,
  onDragOver,
  onPreviewTest,
  onPreviewMS,
  onClear,
  onToggleTemplateEditor,
  onTemplateEditChange,
  onSaveTemplates,
}: {
  queue: TestQueueItem[];
  examConfig: ExamConfig;
  courses: Course[];
  showSections: boolean;
  queueHasMarkscheme: boolean;
  showTemplateEditor: boolean;
  templateEdits: Record<string, string>;
  onConfigChange: (updates: Partial<ExamConfig>) => void;
  onRemove: (id: string) => void;
  onUpdateSection: (id: string, section: "A" | "B") => void;
  onAutoSort: () => void;
  onDragStart: (index: number) => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onPreviewTest: () => void;
  onPreviewMS: () => void;
  onClear: () => void;
  onToggleTemplateEditor: () => void;
  onTemplateEditChange: (key: string, val: string) => void;
  onSaveTemplates: () => void;
}) {
  // Build section groups for rendering placeholder dividers
  const sectionAItems = showSections ? queue.filter((q) => q.section === "A") : [];
  const sectionBItems = showSections ? queue.filter((q) => q.section === "B") : [];
  const unsectionedItems = showSections
    ? queue.filter((q) => q.section !== "A" && q.section !== "B")
    : [];

  const canPreview = queue.length > 0 && examConfig.courseId;
  const totalMarks = queue.reduce((sum, item) => sum + item.marks, 0);
  const totalMinutes = Math.ceil((12 / 11) * totalMarks);

  return (
    <div
      className="flex-shrink-0 rounded-xl border-2 border-indigo-300 bg-indigo-50 flex flex-col transition-[width] duration-200"
      style={{
        width: "var(--exam-builder-width, 20rem)",
        maxHeight: "calc(100vh - 140px)",
        position: "sticky",
        top: 20,
      }}
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-2 border-b border-indigo-200">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-indigo-900 text-base">🏗 ExamBuilder</h3>
          <span className="text-xs font-semibold text-indigo-600">
            {queue.length} question{queue.length !== 1 ? "s" : ""}
          </span>
        </div>
        {queue.length > 0 && (
          <div className="flex items-center justify-between rounded-lg bg-indigo-100 border border-indigo-200 px-3 py-1.5 mb-2">
            <span className="text-xs font-bold text-indigo-800">
              {totalMarks} mark{totalMarks !== 1 ? "s" : ""}
            </span>
            <span className="text-xs font-semibold text-indigo-600">
              ≈ {totalMinutes} min
            </span>
          </div>
        )}

        {/* Exam config form */}
        <div className="space-y-2">
          <input
            type="text"
            value={examConfig.name}
            onChange={(e) => onConfigChange({ name: e.target.value })}
            placeholder="Exam name (e.g. Mock 2026)"
            className="w-full rounded border border-indigo-300 px-2 py-1 text-sm font-semibold text-indigo-900 bg-white placeholder:text-indigo-300"
          />
          <div className="flex gap-2">
            <select
              value={examConfig.curriculum}
              onChange={(e) => onConfigChange({ curriculum: e.target.value as "AA" | "AI" })}
              className="flex-1 rounded border border-indigo-300 px-2 py-1 text-xs font-bold text-indigo-900 bg-white"
            >
              <option value="AA">AA</option>
              <option value="AI">AI</option>
            </select>
            <select
              value={examConfig.level}
              onChange={(e) => onConfigChange({ level: e.target.value as "HL" | "SL" })}
              className="flex-1 rounded border border-indigo-300 px-2 py-1 text-xs font-bold text-indigo-900 bg-white"
            >
              <option value="HL">HL</option>
              <option value="SL">SL</option>
            </select>
            <select
              value={examConfig.paper}
              onChange={(e) => onConfigChange({ paper: parseInt(e.target.value) as 1 | 2 | 3 })}
              className="flex-1 rounded border border-indigo-300 px-2 py-1 text-xs font-bold text-indigo-900 bg-white"
            >
              <option value={1}>P1</option>
              <option value={2}>P2</option>
              <option value={3}>P3</option>
            </select>
          </div>
          <select
            value={examConfig.courseId}
            onChange={(e) => onConfigChange({ courseId: e.target.value })}
            className="w-full rounded border border-indigo-300 px-2 py-1 text-xs font-bold text-indigo-900 bg-white"
          >
            <option value="">— Select class —</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <input
            type="date"
            value={examConfig.date}
            onChange={(e) => onConfigChange({ date: e.target.value })}
            className="w-full rounded border border-indigo-300 px-2 py-1 text-xs font-semibold text-indigo-900 bg-white"
          />
        </div>

        {/* Section controls (P1/P2 AA only) */}
        {showSections && queue.length > 0 && (
          <button
            type="button"
            onClick={onAutoSort}
            className="mt-2 w-full rounded border border-indigo-400 bg-white text-xs font-bold text-indigo-700 px-2 py-1 hover:bg-indigo-100"
          >
            ⇅ Sort: All Section A then Section B
          </button>
        )}
      </div>

      {/* Queue list */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        {queue.length === 0 && (
          <p className="text-center text-xs text-indigo-400 py-6">
            Click + next to a question to add it here
          </p>
        )}

        {showSections ? (
          <>
            {/* Section A group */}
            {sectionAItems.length > 0 && (
              <>
                <div className="px-2 py-1 text-xs font-bold text-blue-700 bg-blue-50 rounded border border-blue-200">
                  Section A ({sectionAItems.length})
                </div>
                {/* TODO: Section A header image placeholder */}
                <div className="px-2 py-1 text-xs text-gray-400 italic border border-dashed border-gray-300 rounded text-center">
                  [ Section A header image — coming soon ]
                </div>
                {sectionAItems.map((item, globalIdx) => {
                  const idx = queue.indexOf(item);
                  return (
                    <QueueRow
                      key={item.id}
                      item={item}
                      number={globalIdx + 1}
                      showSection={true}
                      onRemove={() => onRemove(item.id)}
                      onUpdateSection={(s) => onUpdateSection(item.id, s)}
                      onDragStart={() => onDragStart(idx)}
                      onDragOver={(e) => onDragOver(e, idx)}
                    />
                  );
                })}
              </>
            )}

            {/* Section B group */}
            {sectionBItems.length > 0 && (
              <>
                <div className="px-2 py-1 text-xs font-bold text-orange-700 bg-orange-50 rounded border border-orange-200 mt-1">
                  Section B ({sectionBItems.length})
                </div>
                {/* TODO: Section B header image placeholder */}
                <div className="px-2 py-1 text-xs text-gray-400 italic border border-dashed border-gray-300 rounded text-center">
                  [ Section B header image — coming soon ]
                </div>
                {sectionBItems.map((item, bIdx) => {
                  const idx = queue.indexOf(item);
                  return (
                    <QueueRow
                      key={item.id}
                      item={item}
                      number={sectionAItems.length + bIdx + 1}
                      showSection={true}
                      onRemove={() => onRemove(item.id)}
                      onUpdateSection={(s) => onUpdateSection(item.id, s)}
                      onDragStart={() => onDragStart(idx)}
                      onDragOver={(e) => onDragOver(e, idx)}
                    />
                  );
                })}
              </>
            )}

            {/* Unsectioned */}
            {unsectionedItems.map((item, uIdx) => {
              const idx = queue.indexOf(item);
              return (
                <QueueRow
                  key={item.id}
                  item={item}
                  number={sectionAItems.length + sectionBItems.length + uIdx + 1}
                  showSection={true}
                  onRemove={() => onRemove(item.id)}
                  onUpdateSection={(s) => onUpdateSection(item.id, s)}
                  onDragStart={() => onDragStart(idx)}
                  onDragOver={(e) => onDragOver(e, idx)}
                />
              );
            })}
          </>
        ) : (
          queue.map((item, idx) => (
            <QueueRow
              key={item.id}
              item={item}
              number={idx + 1}
              showSection={false}
              onRemove={() => onRemove(item.id)}
              onUpdateSection={(s) => onUpdateSection(item.id, s)}
              onDragStart={() => onDragStart(idx)}
              onDragOver={(e) => onDragOver(e, idx)}
            />
          ))
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-indigo-200 space-y-2">
        <button
          type="button"
          onClick={onPreviewTest}
          disabled={!canPreview}
          className="w-full rounded-lg bg-indigo-600 text-white font-bold text-sm py-2 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          🖨 Preview Test
        </button>
        <button
          type="button"
          onClick={onPreviewMS}
          disabled={!canPreview || !queueHasMarkscheme}
          className="w-full rounded-lg border-2 border-indigo-400 text-indigo-700 font-bold text-sm py-1.5 hover:bg-indigo-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title={!queueHasMarkscheme ? "No markscheme images in queue" : undefined}
        >
          📝 Preview Mark Scheme
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClear}
            disabled={queue.length === 0}
            className="flex-1 rounded border border-gray-300 text-xs font-bold text-gray-600 py-1 hover:bg-gray-100 disabled:opacity-40"
          >
            Clear all
          </button>
          <button
            type="button"
            onClick={onToggleTemplateEditor}
            className="flex-1 rounded border border-gray-300 text-xs font-bold text-gray-600 py-1 hover:bg-gray-100"
          >
            ⚙ Templates
          </button>
        </div>

        {/* Inline template editor */}
        {showTemplateEditor && (
          <div className="rounded border border-gray-200 bg-white p-2 space-y-1">
            <p className="text-xs font-bold text-gray-700 mb-1">Cover Slide Presentation IDs</p>
            {ALL_TEMPLATES.map(({ curriculum, level, paper }) => {
              const key = `${curriculum}-${level}-${paper}`;
              return (
                <div key={key} className="flex items-center gap-1">
                  <span className="text-xs font-semibold text-gray-600 w-16 flex-shrink-0">
                    {curriculum}{level} P{paper}
                  </span>
                  <input
                    type="text"
                    value={templateEdits[key] ?? ""}
                    onChange={(e) => onTemplateEditChange(key, e.target.value)}
                    placeholder="Presentation ID"
                    className="flex-1 rounded border border-gray-300 px-1.5 py-0.5 text-xs font-mono"
                  />
                </div>
              );
            })}
            <button
              type="button"
              onClick={onSaveTemplates}
              className="w-full mt-1 rounded bg-green-600 text-white text-xs font-bold py-1 hover:bg-green-700"
            >
              Save Templates
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function QueueRow({
  item,
  number,
  showSection,
  onRemove,
  onUpdateSection,
  onDragStart,
  onDragOver,
}: {
  item: TestQueueItem;
  number: number;
  showSection: boolean;
  onRemove: () => void;
  onUpdateSection: (section: "A" | "B") => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      className="flex items-center gap-1 rounded bg-white border border-indigo-200 px-2 py-1 text-xs cursor-grab active:cursor-grabbing hover:border-indigo-400"
    >
      {/* Drag handle */}
      <span className="text-gray-400 select-none text-base leading-none mr-0.5">⠿</span>
      {/* Number */}
      <span className="font-bold text-indigo-700 w-5 text-right flex-shrink-0">
        {number}.
      </span>
      {/* Code */}
      <span className="flex-1 font-semibold text-gray-800 truncate">{item.code}</span>
      {/* Marks */}
      <span className="text-xs text-indigo-500 font-semibold flex-shrink-0">{item.marks}m</span>
      {/* Section toggle (P1/P2 AA only) */}
      {showSection && (
        <div className="flex gap-0.5 flex-shrink-0">
          <button
            type="button"
            onClick={() => onUpdateSection("A")}
            className={`rounded px-1 py-0.5 text-xs font-bold ${
              item.section === "A"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-500 hover:bg-blue-100"
            }`}
          >
            A
          </button>
          <button
            type="button"
            onClick={() => onUpdateSection("B")}
            className={`rounded px-1 py-0.5 text-xs font-bold ${
              item.section === "B"
                ? "bg-orange-500 text-white"
                : "bg-gray-100 text-gray-500 hover:bg-orange-100"
            }`}
          >
            B
          </button>
        </div>
      )}
      {/* Remove */}
      <button
        type="button"
        onClick={onRemove}
        className="text-gray-400 hover:text-red-600 font-bold ml-0.5 flex-shrink-0"
      >
        ×
      </button>
    </div>
  );
}

