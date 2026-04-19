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

interface Question {
  id: string;
  code: string;
  session: string;
  paper: number;
  level: string;
  timezone: string;
  difficulty: number | null;
  google_doc_id: string | null;
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

export function QuestionBankClient() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [filters, setFilters] = useState<Filters | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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
        setQuestions(d.questions ?? []);
        setTotal(d.total ?? 0);
      })
      .catch(() => {})
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
      else next.add(id);
      return next;
    });
  };

  const clearFilters = () => {
    setSearch("");
    setSession("");
    setPaper("");
    setLevel("");
    setTimezone("");
    setSubtopic("");
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
              <option value="AHL">AHL</option>
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
                Doc
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
}: {
  question: Question;
  expanded: boolean;
  onToggle: () => void;
  totalMarks: number;
}) {
  const hasDoc = !!question.google_doc_id;

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
            {question.level}
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
          {hasDoc ? (
            <a
              href={`https://docs.google.com/document/d/${question.google_doc_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline text-sm font-semibold"
              onClick={(e) => e.stopPropagation()}
            >
              📄 View
            </a>
          ) : (
            <span className="text-gray-400 text-sm">—</span>
          )}
        </td>
      </tr>
      {expanded && question.question_parts.length > 0 && (
        <tr>
          <td colSpan={8} className="bg-blue-50 px-4 py-3">
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
                      <td className="px-2 py-1">
                        {part.subtopic_codes.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {part.subtopic_codes.map((c) => (
                              <span
                                key={c}
                                className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800"
                              >
                                {c}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1 text-sm text-gray-800">
                        {part.command_term ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
