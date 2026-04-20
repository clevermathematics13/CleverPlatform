"use client";

import { useState, useEffect, useCallback } from "react";

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
  question_parts: QuestionPart[];
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
  const [driveConnected, setDriveConnected] = useState(false);
  const [bulkExtracting, setBulkExtracting] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{
    completed: number;
    total: number;
    currentCode: string;
    totalImages: number;
    errors: number;
  } | null>(null);

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
  }, [search, session, paper, level, timezone, subtopic, page]);

  useEffect(() => {
    loadQuestions();
  }, [loadQuestions]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [search, session, paper, level, timezone, subtopic]);

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

  const extractAllImages = async () => {
    setBulkExtracting(true);
    setBulkProgress({ completed: 0, total: 0, currentCode: "", totalImages: 0, errors: 0 });
    setError(null);

    try {
      const res = await fetch("/api/questions/extract-all-images", {
        method: "POST",
        redirect: "manual",
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
    <div className="space-y-4">
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
        <div className="flex flex-wrap items-end gap-3">
          {/* Search */}
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-bold text-blue-900 mb-1">
              Search Code
            </label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="e.g. 22M, TZ2, H_10..."
              className="w-full rounded border-2 border-blue-300 px-3 py-1.5 text-base font-semibold text-blue-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-600"
            />
          </div>

          {/* Session */}
          <div>
            <label className="block text-sm font-bold text-blue-900 mb-1">
              Session
            </label>
            <select
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
            type="button"
            onClick={clearFilters}
            className="rounded-lg border-2 border-blue-400 bg-white px-3 py-1.5 text-sm font-bold text-blue-700 hover:bg-blue-100"
          >
            Clear
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
      <div className="flex items-center justify-between">
        <p className="text-base font-bold text-blue-900">
          {loading ? "Loading…" : `${total} question${total !== 1 ? "s" : ""} found`}
        </p>
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
              />
            ))}
            {!loading && questions.length === 0 && (
              <tr>
                <td
                  colSpan={8}
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
}) {
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
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} className="bg-blue-50 px-4 py-3">
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
                <span className="text-sm font-bold text-blue-900">Extracted Images</span>
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

              {images.length > 0 && (
                <div className="space-y-2">
                  {/* Question images */}
                  {images.filter(i => i.image_type === "question").length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-blue-800 mb-1">Question</p>
                      <div className="flex flex-wrap gap-2">
                        {images
                          .filter(i => i.image_type === "question")
                          .map((img) => (
                            <a
                              key={img.id}
                              href={img.url ?? "#"}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="block"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={img.url ?? ""}
                                alt={img.alt_text ?? `Question image ${img.sort_order + 1}`}
                                className="max-h-40 rounded border border-blue-200 bg-white p-1 hover:border-blue-500 hover:shadow-md transition-all"
                              />
                            </a>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Markscheme images */}
                  {images.filter(i => i.image_type === "markscheme").length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-green-800 mb-1">Markscheme</p>
                      <div className="flex flex-wrap gap-2">
                        {images
                          .filter(i => i.image_type === "markscheme")
                          .map((img) => (
                            <a
                              key={img.id}
                              href={img.url ?? "#"}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="block"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={img.url ?? ""}
                                alt={img.alt_text ?? `Markscheme image ${img.sort_order + 1}`}
                                className="max-h-40 rounded border border-green-200 bg-white p-1 hover:border-green-500 hover:shadow-md transition-all"
                              />
                            </a>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
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
