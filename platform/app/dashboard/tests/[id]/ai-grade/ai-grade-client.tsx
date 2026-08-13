"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import LatexRenderer from "@/components/LatexRenderer";

type MarkSchemeSource = "part_latex" | "part_text" | "whole_question" | "draft" | "none";
type Confidence = "high" | "medium" | "low";

interface Coverage {
  total_items: number;
  resolved_items: number;
  unresolved_items: number;
  unsegmented_items: number;
  by_source: Record<MarkSchemeSource, number>;
  warnings: string[];
}

interface ItemMeta {
  test_item_id: string;
  question_number: number;
  part_label: string;
  max_marks: number;
  ib_question_code: string;
  markscheme_source: MarkSchemeSource;
  unsegmented: boolean;
}

interface RunSummary {
  id: string;
  status: "running" | "complete" | "failed";
  created_at: string;
  error: string | null;
}

interface StudentRow {
  student_id: string;
  display_name: string;
  has_scan: boolean;
  scan_name: string | null;
  latest_run: RunSummary | null;
}

interface MarkBreakdownEntry {
  code: string;
  kind: string;
  awarded: boolean;
  note: string;
}

interface ResultRow {
  test_item_id: string;
  suggested_marks: number;
  max_marks: number;
  confidence: Confidence;
  markscheme_source: MarkSchemeSource;
  work_found: boolean;
  reasoning: string | null;
  evidence: string | null;
  mark_breakdown: MarkBreakdownEntry[];
  accepted: boolean;
  current_marks: number | null;
}

const SOURCE_LABEL: Record<MarkSchemeSource, string> = {
  part_latex: "Part mark scheme",
  part_text: "Part mark scheme (plain text)",
  whole_question: "Whole-question fallback",
  draft: "Draft mark scheme",
  none: "No mark scheme",
};

const CONFIDENCE_STYLE: Record<Confidence, string> = {
  high: "bg-green-100 text-green-800 border-green-300",
  medium: "bg-amber-100 text-amber-800 border-amber-300",
  low: "bg-red-100 text-red-800 border-red-300",
};

export function AiGradeClient({ testId }: { testId: string }) {
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [items, setItems] = useState<ItemMeta[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [focusStudent, setFocusStudent] = useState<string | null>(null);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);

  const [busyStudent, setBusyStudent] = useState<string | null>(null);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingUploadStudent = useRef<string | null>(null);

  const itemById = new Map(items.map((i) => [i.test_item_id, i]));

  const load = useCallback(
    async (studentId?: string | null) => {
      setError(null);
      const qs = studentId ? `?studentId=${studentId}` : "";
      const res = await fetch(`/api/tests/${testId}/ai-grade${qs}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not load marking data.");
        return;
      }
      setCoverage(data.coverage);
      setItems(data.items ?? []);
      setStudents(data.students ?? []);
      if (studentId) {
        const rows = (data.results ?? []) as ResultRow[];
        setResults(rows);
        setRunId(data.focusedRunId ?? null);
        setDrafts(
          Object.fromEntries(rows.map((r) => [r.test_item_id, r.suggested_marks]))
        );
        setSelected(
          new Set(rows.filter((r) => !r.accepted && r.work_found).map((r) => r.test_item_id))
        );
      }
    },
    [testId]
  );

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const runGrading = async (studentId: string, file: File | null) => {
    setBusyStudent(studentId);
    setStatusLine(
      file
        ? "Uploading scan and reading it against the mark scheme…"
        : "Reading the stored scan against the mark scheme…"
    );
    try {
      let res: Response;
      if (file) {
        const form = new FormData();
        form.append("studentId", studentId);
        form.append("file", file);
        res = await fetch(`/api/tests/${testId}/ai-grade`, { method: "POST", body: form });
      } else {
        res = await fetch(`/api/tests/${testId}/ai-grade`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studentId }),
        });
      }
      const data = await res.json();
      if (!res.ok) {
        setStatusLine(null);
        setError(data.error ?? "Marking failed.");
        return;
      }
      setStatusLine(
        `Marked ${data.graded} item(s).` +
          (data.skipped_no_markscheme
            ? ` ${data.skipped_no_markscheme} skipped for lack of a mark scheme.`
            : "")
      );
      setFocusStudent(studentId);
      await load(studentId);
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

  const openReview = async (studentId: string) => {
    setFocusStudent(studentId);
    setStatusLine(null);
    await load(studentId);
  };

  const acceptSelected = async () => {
    if (!runId || selected.size === 0) return;
    setAccepting(true);
    try {
      const payload = [...selected].map((id) => ({
        testItemId: id,
        marks: drafts[id] ?? 0,
      }));
      const res = await fetch(`/api/tests/${testId}/ai-grade/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, items: payload }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not accept these marks.");
        return;
      }
      setStatusLine(`${data.accepted} mark(s) written to Clev's Marks.`);
      if (focusStudent) await load(focusStudent);
    } finally {
      setAccepting(false);
    }
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (loading) {
    return <p className="text-sm text-gray-500">Loading mark scheme coverage…</p>;
  }

  const suggestedTotal = results.reduce((s, r) => s + (drafts[r.test_item_id] ?? 0), 0);
  const maxTotal = results.reduce((s, r) => s + r.max_marks, 0);

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
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {statusLine && (
        <div className="rounded-lg border border-blue-300 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          {statusLine}
        </div>
      )}

      {/* ── Coverage preflight ─────────────────────────────────────────── */}
      {coverage && (
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-gray-900">Mark scheme coverage</h2>
          <p className="mt-1 text-sm text-gray-500">
            How much of this exam the PPQ bank can actually mark against.
          </p>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Questions" value={coverage.total_items} />
            <Stat label="With mark scheme" value={coverage.resolved_items} tone="good" />
            <Stat
              label="Missing"
              value={coverage.unresolved_items}
              tone={coverage.unresolved_items > 0 ? "bad" : "neutral"}
            />
            <Stat
              label="Whole-question only"
              value={coverage.unsegmented_items}
              tone={coverage.unsegmented_items > 0 ? "warn" : "neutral"}
            />
          </div>

          {coverage.warnings.length > 0 && (
            <ul className="mt-4 space-y-1 border-t border-gray-100 pt-3 text-sm text-gray-600">
              {coverage.warnings.map((w, i) => (
                <li key={i} className="flex gap-2">
                  <span aria-hidden>⚠</span>
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ── Students ───────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-5 py-3">
          <h2 className="text-lg font-bold text-gray-900">Students</h2>
        </div>

        {students.length === 0 && (
          <p className="px-5 py-4 text-sm text-gray-500">
            No students are enrolled in this exam&apos;s class.
          </p>
        )}

        <ul className="divide-y divide-gray-100">
          {students.map((s) => {
            const busy = busyStudent === s.student_id;
            const run = s.latest_run;
            return (
              <li
                key={s.student_id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <div>
                  <p className="font-semibold text-gray-900">{s.display_name}</p>
                  <p className="text-xs text-gray-500">
                    {s.has_scan ? `Scan on file: ${s.scan_name}` : "No scan on file"}
                    {run && ` · last run ${run.status}`}
                    {run?.error && ` — ${run.error}`}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      pendingUploadStudent.current = s.student_id;
                      fileInputRef.current?.click();
                    }}
                    className="rounded border border-blue-300 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                  >
                    {busy ? "Working…" : "Upload scan & mark"}
                  </button>

                  {s.has_scan && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => runGrading(s.student_id, null)}
                      className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Mark stored scan
                    </button>
                  )}

                  {run?.status === "complete" && (
                    <button
                      type="button"
                      onClick={() => openReview(s.student_id)}
                      className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
                    >
                      Review →
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── Review table ───────────────────────────────────────────────── */}
      {focusStudent && results.length > 0 && (
        <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-3">
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                Review —{" "}
                {students.find((s) => s.student_id === focusStudent)?.display_name}
              </h2>
              <p className="text-xs text-gray-500">
                Suggested total {suggestedTotal} / {maxTotal}. Edit any value before
                accepting.
              </p>
            </div>
            <button
              type="button"
              onClick={acceptSelected}
              disabled={accepting || selected.size === 0}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {accepting
                ? "Writing…"
                : `Accept ${selected.size} into Clev's Marks`}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-2 font-semibold">
                    <span className="sr-only">Accept</span>
                  </th>
                  <th className="px-2 py-2 font-semibold">Question</th>
                  <th className="px-2 py-2 font-semibold">Suggested</th>
                  <th className="px-2 py-2 font-semibold">Max</th>
                  <th className="px-2 py-2 font-semibold">Confidence</th>
                  <th className="px-2 py-2 font-semibold">Mark scheme</th>
                  <th className="px-2 py-2 font-semibold">Clev&apos;s Marks</th>
                  <th className="px-2 py-2 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {results.map((r) => {
                  const meta = itemById.get(r.test_item_id);
                  const label = meta
                    ? `Q${meta.question_number}${meta.part_label ? `(${meta.part_label})` : ""}`
                    : "—";
                  const isOpen = expanded === r.test_item_id;
                  return (
                    <Fragment key={r.test_item_id}>
                      <tr className="border-b border-gray-100">
                        <td className="px-4 py-2">
                          <input
                            type="checkbox"
                            checked={selected.has(r.test_item_id)}
                            onChange={() => toggle(r.test_item_id)}
                            aria-label={`Accept ${label}`}
                          />
                        </td>
                        <td className="px-2 py-2 font-medium text-gray-900">{label}</td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            min={0}
                            max={r.max_marks}
                            value={drafts[r.test_item_id] ?? 0}
                            onChange={(e) =>
                              setDrafts((prev) => ({
                                ...prev,
                                [r.test_item_id]: Math.max(
                                  0,
                                  Math.min(r.max_marks, Number(e.target.value))
                                ),
                              }))
                            }
                            className="w-16 rounded border border-gray-300 px-2 py-1 text-sm focus:ring-2 focus:ring-blue-400"
                          />
                        </td>
                        <td className="px-2 py-2 text-gray-500">{r.max_marks}</td>
                        <td className="px-2 py-2">
                          <span
                            className={`rounded border px-2 py-0.5 text-xs font-medium ${CONFIDENCE_STYLE[r.confidence]}`}
                          >
                            {r.confidence}
                          </span>
                          {!r.work_found && (
                            <span className="ml-2 text-xs text-gray-500">
                              no attempt found
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-xs text-gray-500">
                          {SOURCE_LABEL[r.markscheme_source]}
                        </td>
                        <td className="px-2 py-2">
                          {r.current_marks === null ? (
                            <span className="text-gray-400">—</span>
                          ) : (
                            <span className="font-semibold text-gray-900">
                              {r.current_marks}
                            </span>
                          )}
                          {r.accepted && (
                            <span className="ml-2 text-xs text-green-700">accepted</span>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          <button
                            type="button"
                            onClick={() => setExpanded(isOpen ? null : r.test_item_id)}
                            className="text-xs text-blue-600 hover:underline"
                          >
                            {isOpen ? "Hide" : "Why?"}
                          </button>
                        </td>
                      </tr>

                      {isOpen && (
                        <tr className="bg-gray-50">
                          <td colSpan={8} className="px-6 py-4">
                            <div className="space-y-3">
                              {r.mark_breakdown.length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                  {r.mark_breakdown.map((b, i) => (
                                    <span
                                      key={i}
                                      className={`rounded border px-2 py-0.5 text-xs ${
                                        b.awarded
                                          ? "border-green-300 bg-green-50 text-green-800"
                                          : "border-gray-300 bg-white text-gray-500 line-through"
                                      }`}
                                      title={b.note}
                                    >
                                      {b.code}
                                    </span>
                                  ))}
                                </div>
                              )}

                              {r.evidence && (
                                <div>
                                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    Student&apos;s work
                                  </p>
                                  <div className="mt-1 rounded border border-gray-200 bg-white p-3">
                                    <LatexRenderer latex={r.evidence} />
                                  </div>
                                </div>
                              )}

                              {r.reasoning && (
                                <div>
                                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    Examiner reasoning
                                  </p>
                                  <div className="mt-1 rounded border border-gray-200 bg-white p-3">
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
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "text-green-700"
      : tone === "warn"
      ? "text-amber-700"
      : tone === "bad"
      ? "text-red-700"
      : "text-gray-900";
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`font-serif text-2xl font-bold ${toneClass}`}>{value}</p>
    </div>
  );
}
