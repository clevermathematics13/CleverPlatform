"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import LatexRenderer from "@/components/LatexRenderer";
import { BatchGradeTab } from "./batch-grade-tab";

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
  /** profiles.id — what every AI-grade endpoint expects as studentId. */
  profile_id: string;
  display_name: string;
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
    needsReview?: string[];
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
  high: "bg-green-100 text-green-800 border-green-300",
  medium: "bg-amber-100 text-amber-800 border-amber-300",
  low: "bg-red-100 text-red-800 border-red-300",
};

function itemLabel(item: TestItem | undefined): string {
  if (!item) return "—";
  return item.part_label
    ? `Q${item.question_number}(${item.part_label})`
    : `Q${item.question_number}`;
}

/** Read a File into a base64 string (no data: prefix), as the route expects. */
function fileToBase64(file: File): Promise<{ base64: string; name: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve({ base64, name: file.name });
    };
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });
}

export function AiGradeClient({ testId }: { testId: string }) {
  const [tab, setTab] = useState<"individual" | "batch">("individual");

  const [test, setTest] = useState<TestDetail | null>(null);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [runsByStudent, setRunsByStudent] = useState<Record<string, RunRow>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusLine, setStatusLine] = useState<string | null>(null);

  const [focusStudent, setFocusStudent] = useState<string | null>(null);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [focusRunId, setFocusRunId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, number>>({}); // keyed by result.id
  const [selected, setSelected] = useState<Set<string>>(new Set()); // result ids
  const [expanded, setExpanded] = useState<string | null>(null);

  const [busyStudent, setBusyStudent] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingUploadStudent = useRef<string | null>(null);

  const itemById = new Map((test?.test_items ?? []).map((i) => [i.id, i]));

  // -- Initial load: test detail (for items + course), roster, latest runs --
  const loadOverview = useCallback(async () => {
    setError(null);
    const testRes = await fetch(`/api/tests/${testId}`);
    const testData = await testRes.json();
    if (!testRes.ok) {
      setError(testData.error ?? "Could not load this assessment.");
      return;
    }
    setTest(testData);

    const studentsRes = await fetch(`/api/students?courseId=${testData.course_id}`);
    const studentsData = await studentsRes.json();
    if (!studentsRes.ok) {
      setError(studentsData.error ?? "Could not load the class roster.");
      return;
    }
    const roster: StudentOption[] = (studentsData.students ?? [])
      .filter((s: { profile_id?: string }) => !!s.profile_id)
      .map((s: { profile_id: string; profiles: { display_name: string; nickname: string | null } }) => ({
        profile_id: s.profile_id,
        display_name: s.profiles?.nickname || s.profiles?.display_name || "Unknown",
      }))
      .sort((a: StudentOption, b: StudentOption) => a.display_name.localeCompare(b.display_name));
    setStudents(roster);

    const runsRes = await fetch(`/api/tests/${testId}/ai-grade`);
    const runsData = await runsRes.json();
    if (!runsRes.ok) {
      setError(runsData.error ?? "Could not load grading runs.");
      return;
    }
    const latest: Record<string, RunRow> = {};
    for (const r of (runsData.runs ?? []) as RunRow[]) {
      // runs come back newest-first from the API; keep only the first (latest) per student
      if (!latest[r.student_id]) latest[r.student_id] = r;
    }
    setRunsByStudent(latest);
  }, [testId]);

  useEffect(() => {
    loadOverview().finally(() => setLoading(false));
  }, [loadOverview]);

  // -- Load one student's results for review --
  const loadResultsFor = useCallback(
    async (studentId: string) => {
      const res = await fetch(`/api/tests/${testId}/ai-grade?studentId=${studentId}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not load results for this student.");
        return;
      }
      const runs = (data.runs ?? []) as RunRow[];
      const latestRun = runs[0] ?? null;
      const rows = (data.results ?? []) as ResultRow[];
      const rowsForLatest = latestRun
        ? rows.filter((r) => r.run_id === latestRun.id)
        : rows;

      setFocusRunId(latestRun?.id ?? null);
      setResults(rowsForLatest);
      setDrafts(Object.fromEntries(rowsForLatest.map((r) => [r.id, r.suggested_marks])));
      setSelected(
        new Set(rowsForLatest.filter((r) => !r.accepted && r.work_found).map((r) => r.id))
      );
      if (latestRun) setRunsByStudent((prev) => ({ ...prev, [studentId]: latestRun }));
    },
    [testId]
  );

  const openReview = async (studentId: string) => {
    setFocusStudent(studentId);
    setStatusLine(null);
    setError(null);
    await loadResultsFor(studentId);
  };

  // -- Run grading (fresh upload or re-use stored scan) --
  const runGrading = async (studentId: string, file: File | null) => {
    setBusyStudent(studentId);
    setError(null);
    setStatusLine(
      file
        ? "Uploading scan and marking it against the mark scheme…"
        : "Marking the stored scan against the mark scheme…"
    );
    try {
      const body: Record<string, unknown> = { studentId };
      if (file) {
        const { base64, name } = await fileToBase64(file);
        body.fileBase64 = base64;
        body.fileName = name;
      } else {
        body.reuseExistingScan = true;
      }

      const res = await fetch(`/api/tests/${testId}/ai-grade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusLine(null);
        setError(data.error ?? "Marking failed.");
        return;
      }

      const parts: string[] = [];
      if (typeof data.partsGraded === "number") {
        parts.push(`Marked ${data.partsGraded} of ${data.partsInAssessment ?? data.partsGraded} part(s)`);
      }
      if (data.suggestedTotal !== undefined && data.maxTotal !== undefined) {
        parts.push(`suggested total ${data.suggestedTotal}/${data.maxTotal}`);
      }
      if (Array.isArray(data.needsReview) && data.needsReview.length > 0) {
        parts.push(`${data.needsReview.length} part(s) flagged for review`);
      }
      setStatusLine(parts.length > 0 ? parts.join(", ") + "." : "Marking complete.");

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
      const res = await fetch(`/api/tests/${testId}/ai-grade/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: focusRunId, selections }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not accept these marks.");
        return;
      }
      setStatusLine(`${data.appliedCount} mark(s) written to Clev's Marks.`);
      if (focusStudent) await loadResultsFor(focusStudent);
    } finally {
      setAccepting(false);
    }
  };

  const toggle = (resultId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(resultId)) next.delete(resultId);
      else next.add(resultId);
      return next;
    });

  if (loading) {
    return <p className="text-sm text-gray-500">Loading this assessment…</p>;
  }

  if (!test) {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
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
      {/* -- Tabs ---------------------------------------------------------- */}
      <div className="flex gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1 w-fit">
        <button
          type="button"
          onClick={() => setTab("individual")}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
            tab === "individual" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Individual
        </button>
        <button
          type="button"
          onClick={() => setTab("batch")}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
            tab === "batch" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Batch upload
        </button>
      </div>

      {tab === "batch" && <BatchGradeTab testId={testId} students={students} />}

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
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {statusLine && (
            <div className="rounded-lg border border-blue-300 bg-blue-50 px-4 py-3 text-sm text-blue-800">
              {statusLine}
            </div>
          )}

          {/* -- Assessment summary ------------------------------------------ */}
          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold text-gray-900">{test.name}</h2>
            <p className="mt-1 text-sm text-gray-500">
              {totalItems} part{totalItems === 1 ? "" : "s"} · {maxTotal} marks total. Upload a
              scanned PDF per student — the model marks it against the mark scheme stored in the
              PPQ bank. Nothing reaches Clev&apos;s Marks until you review and accept it below.
            </p>
          </section>

          {/* -- Students ----------------------------------------------------- */}
          <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-5 py-3">
              <h2 className="text-lg font-bold text-gray-900">Students</h2>
            </div>

            {students.length === 0 && (
              <p className="px-5 py-4 text-sm text-gray-500">
                No students are enrolled in this assessment&apos;s class.
              </p>
            )}

            <ul className="divide-y divide-gray-100">
              {students.map((s) => {
                const busy = busyStudent === s.profile_id;
                const run = runsByStudent[s.profile_id];
                return (
                  <li
                    key={s.profile_id}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                  >
                    <div>
                      <p className="font-semibold text-gray-900">{s.display_name}</p>
                      <p className="text-xs text-gray-500">
                        {run ? (
                          <>
                            Last run: {run.status}
                            {run.coverage?.suggestedTotal !== undefined &&
                              run.coverage?.maxTotal !== undefined &&
                              ` · ${run.coverage.suggestedTotal}/${run.coverage.maxTotal} suggested`}
                            {run.error && ` — ${run.error}`}
                          </>
                        ) : (
                          "No scan graded yet"
                        )}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          pendingUploadStudent.current = s.profile_id;
                          fileInputRef.current?.click();
                        }}
                        className="rounded border border-blue-300 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                      >
                        {busy ? "Working…" : "Upload scan & mark"}
                      </button>

                      {run?.source_storage_path && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => runGrading(s.profile_id, null)}
                          className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                        >
                          Re-mark stored scan
                        </button>
                      )}

                      {run?.status === "complete" && (
                        <button
                          type="button"
                          onClick={() => openReview(s.profile_id)}
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

          {/* -- Review table ---------------------------------------------- */}
          {focusStudent && results.length > 0 && (
            <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-3">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">
                    Review — {students.find((s) => s.profile_id === focusStudent)?.display_name}
                  </h2>
                  <p className="text-xs text-gray-500">
                    Suggested total {suggestedTotal} / {maxTotal}. Edit any value before accepting.
                  </p>
                  {focusRun?.coverage?.warnings && focusRun.coverage.warnings.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-xs text-amber-700">
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
                    <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
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
                    {results
                      .slice()
                      .sort((a, b) => {
                        const ia = itemById.get(a.test_item_id);
                        const ib = itemById.get(b.test_item_id);
                        return (ia?.question_number ?? 0) - (ib?.question_number ?? 0);
                      })
                      .map((r) => {
                        const meta = itemById.get(r.test_item_id);
                        const label = itemLabel(meta);
                        const isOpen = expanded === r.id;
                        return (
                          <Fragment key={r.id}>
                            <tr className="border-b border-gray-100">
                              <td className="px-4 py-2">
                                <input
                                  type="checkbox"
                                  checked={selected.has(r.id)}
                                  onChange={() => toggle(r.id)}
                                  aria-label={`Accept ${label}`}
                                />
                              </td>
                              <td className="px-2 py-2 font-medium text-gray-900">{label}</td>
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
                                  <span className="ml-2 text-xs text-gray-500">no attempt found</span>
                                )}
                              </td>
                              <td className="px-2 py-2 text-xs text-gray-500">
                                {SOURCE_LABEL[r.markscheme_source]}
                              </td>
                              <td className="px-2 py-2">
                                {r.accepted ? (
                                  <span className="text-xs text-green-700">accepted</span>
                                ) : (
                                  <span className="text-gray-400">—</span>
                                )}
                              </td>
                              <td className="px-2 py-2">
                                <button
                                  type="button"
                                  onClick={() => setExpanded(isOpen ? null : r.id)}
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
                                            {b.token}
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
        </>
      )}
    </div>
  );
}
