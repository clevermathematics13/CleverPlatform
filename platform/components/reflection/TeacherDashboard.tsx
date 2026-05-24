"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { ReflectionTest, StudentReflectionRow, ReflectionItem } from "@/lib/reflection-types";
import { computeDisagreement } from "@/lib/reflection-utils";
import { ScoreTable } from "@/components/reflection/ScoreTable";

interface TeacherDashboardProps {
  tests: ReflectionTest[];
}

interface ClassData {
  items: {
    id: string;
    question_number: number;
    part_label: string;
    max_marks: number;
    subtopic_codes: string[];
    subtopic_labels: string[];
  }[];
  rows: StudentReflectionRow[];
}

type CellKey = `${string}:${string}`;

interface Course {
  id: string;
  name: string;
}

export function TeacherDashboard({ tests }: TeacherDashboardProps) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<string>("");
  const [selectedTest, setSelectedTest] = useState<string>(
    tests[0]?.id ?? ""
  );
  const [data, setData] = useState<ClassData | null>(null);
  const [loading, setLoading] = useState(false);
  const [editingCell, setEditingCell] = useState<CellKey | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState<CellKey | null>(null);
  const [savedCells, setSavedCells] = useState<Set<CellKey>>(new Set());
  const [selectedStudentId, setSelectedStudentId] = useState<string>("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch courses for filter
  useEffect(() => {
    fetch("/api/courses")
      .then((r) => r.json())
      .then((d: Course[]) => {
        setCourses(d ?? []);
        if (d?.length > 0) setSelectedCourse(d[0].id);
      })
      .catch(() => {});
  }, []);

  // Filter tests by selected course
  const filteredTests = selectedCourse
    ? tests.filter((t) => t.course_id === selectedCourse)
    : tests;

  // Auto-select first test when course changes — deferred to avoid cascade error
  useEffect(() => {
    const first = filteredTests[0]?.id ?? "";
    const timer = setTimeout(() => setSelectedTest(first), 0);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCourse]);

  useEffect(() => {
    if (!selectedTest) {
      return;
    }
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setLoading(true);
      setEditingCell(null);
      setSavedCells(new Set());
      setSelectedStudentId("");
    });
    fetch(`/api/reflection/class-data?testId=${encodeURIComponent(selectedTest)}`)
      .then((r) => r.json())
      .then((d: ClassData) => {
        if (!active) return;
        setData(d);
      })
      .catch(() => {
        if (!active) return;
        setData(null);
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selectedTest]);

  const saveCell = useCallback(
    async (studentId: string, testItemId: string, newMarks: number) => {
      const key: CellKey = `${studentId}:${testItemId}`;
      setSaving(key);
      try {
        const res = await fetch("/api/reflection/update-mark", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ testItemId, studentId, newMarks }),
        });
        const result = await res.json();
        if (res.ok) {
          setData((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              rows: prev.rows.map((row) =>
                row.student_id === studentId
                  ? {
                      ...row,
                      items: row.items.map((cell) =>
                        cell.test_item_id === testItemId
                          ? { ...cell, marks_awarded: result.marks_awarded }
                          : cell
                      ),
                    }
                  : row
              ),
            };
          });
          setSavedCells((prev) => new Set(prev).add(key));
          setTimeout(() => {
            setSavedCells((prev) => {
              const next = new Set(prev);
              next.delete(key);
              return next;
            });
          }, 1500);
        }
      } finally {
        setSaving(null);
        setEditingCell(null);
      }
    },
    []
  );

  const handleCellClick = (studentId: string, testItemId: string, currentMarks: number | null) => {
    const key: CellKey = `${studentId}:${testItemId}`;
    setEditingCell(key);
    setEditValue(currentMarks !== null ? String(currentMarks) : "0");
  };

  const handleCellBlur = (studentId: string, testItemId: string, maxMarks: number) => {
    const raw = parseInt(editValue) || 0;
    const clamped = Math.max(0, Math.min(raw, maxMarks));
    saveCell(studentId, testItemId, clamped);
  };

  const handleCellKeyDown = (
    e: React.KeyboardEvent,
    studentId: string,
    testItemId: string,
    maxMarks: number
  ) => {
    if (e.key === "Enter") { e.preventDefault(); handleCellBlur(studentId, testItemId, maxMarks); }
    else if (e.key === "Escape") setEditingCell(null);
  };

  const visibleRows = data?.rows.filter((r) => !r.hidden) ?? [];
  const firstName = (fullName: string) => fullName.trim().split(/\s+/)[0] ?? fullName;

  const classAverageByItem = data?.items.map((item) => {
    const idx = data.items.findIndex((i) => i.id === item.id);
    const teacherVals = visibleRows
      .map((r) => r.items[idx]?.marks_awarded)
      .filter((v): v is number => v !== null && v !== undefined);
    const selfVals = visibleRows
      .map((r) => r.items[idx]?.self_marks)
      .filter((v): v is number => v !== null && v !== undefined);
    const teacherAvg = teacherVals.length
      ? teacherVals.reduce((a, b) => a + b, 0) / teacherVals.length
      : null;
    const selfAvg = selfVals.length
      ? selfVals.reduce((a, b) => a + b, 0) / selfVals.length
      : null;
    return { teacherAvg, selfAvg };
  }) ?? [];

  const classAverageDisagreement = (() => {
    const vals = visibleRows
      .map((r) => r.disagreement)
      .filter((v): v is number => v !== null && v !== undefined);
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  })();

  const disagreementColor = (d: number | null) => {
    if (d === null) return "text-da-muted";
    if (d === 0) return "text-green-400 font-bold";
    if (d <= 10) return "text-yellow-400 font-semibold";
    return "text-red-400 font-bold";
  };

  return (
    <div className="space-y-4" ref={containerRef}>
      {/* Course + Test selectors */}
      <div className="flex items-center gap-4 flex-wrap">
        {courses.length > 1 && (
          <>
            <label className="text-base font-semibold text-da-amber">Class:</label>
            <select
              value={selectedCourse}
              onChange={(e) => {
                setData(null);
                setSelectedStudentId("");
                setSelectedCourse(e.target.value);
              }}
              className="rounded border border-da-border px-3 py-1.5 text-sm font-semibold text-da-text bg-da-surface focus:ring-2 focus:ring-da-accent"
            >
              <option value="">All classes</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </>
        )}

        <label htmlFor="test-select" className="text-base font-semibold text-da-amber">
          Test:
        </label>
        <select
          id="test-select"
          value={selectedTest}
          onChange={(e) => setSelectedTest(e.target.value)}
          className="rounded border border-da-border px-3 py-1.5 text-base font-semibold text-da-text bg-da-surface focus:ring-2 focus:ring-da-accent"
        >
          {filteredTests.length === 0 && (
            <option value="">— no tests for this class —</option>
          )}
          {filteredTests.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>

        <a
          href="/dashboard/tests"
          className="ml-auto da-btn-link text-sm"
        >
          + Manage Tests
        </a>
      </div>

      {loading && <p className="text-sm text-da-muted">Loading…</p>}

      {data && data.items.length > 0 && (
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-da-border/40 bg-da-surface">
                <th className="sticky left-0 bg-da-surface px-3 py-2 text-left font-bold text-da-amber min-w-45">
                  Student
                </th>
                {data.items.map((item) => (
                  <th key={item.id} className="px-3 py-2 text-center font-bold text-da-amber whitespace-nowrap">
                    Q{item.question_number}{item.part_label}
                    <span className="block text-xs font-normal text-da-muted">/{item.max_marks}</span>
                    {item.subtopic_labels.length > 0 && (
                      <span className="block text-[10px] font-normal text-da-muted">[{item.subtopic_labels.join(", ")}]</span>
                    )}
                  </th>
                ))}
                <th className="px-3 py-2 text-center font-bold text-da-amber whitespace-nowrap">Disagree %</th>
                <th className="px-3 py-2 text-center font-bold text-da-amber">PDF</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr
                  key={row.student_id}
                  className="border-b border-da-border/20"
                >
                  {/* Name cell */}
                  <td
                    className="sticky left-0 z-10 bg-da-bg px-3 py-2 font-medium text-da-text"
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedStudentId(row.student_id)}
                      className="text-left hover:text-da-amber hover:underline"
                    >
                      {row.display_name}
                    </button>
                  </td>

                  {/* Mark cells */}
                  {row.items.map((cell, i) => {
                    const item = data.items[i];
                    const key: CellKey = `${row.student_id}:${item.id}`;
                    const isEditing = editingCell === key;
                    const isSaving = saving === key;
                    const justSaved = savedCells.has(key);
                    const diff =
                      cell.marks_awarded !== null && cell.self_marks !== null
                        ? cell.self_marks - cell.marks_awarded
                        : null;
                    const hasAny = cell.marks_awarded !== null || cell.self_marks !== null;
                    return (
                      <td
                        key={item.id}
                        className={`px-3 py-2 text-center text-da-text cursor-pointer transition-colors ${
                          justSaved
                            ? "bg-green-900/40"
                            : isSaving
                              ? "bg-da-surface"
                              : diff === null
                                ? "hover:bg-da-hover"
                                : diff === 0
                                  ? "bg-green-900/25 hover:bg-green-800/40"
                                  : Math.abs(diff) <= 1
                                    ? "bg-yellow-900/25 hover:bg-yellow-800/40"
                                    : "bg-red-900/25 hover:bg-red-800/40"
                        }`}
                        title={
                          hasAny
                            ? `Teacher: ${cell.marks_awarded ?? "—"}, Self: ${cell.self_marks ?? "—"} (click to edit)`
                            : "Click to enter marks"
                        }
                        onClick={() =>
                          !isEditing && handleCellClick(row.student_id, item.id, cell.marks_awarded)
                        }
                      >
                        {isEditing ? (
                          <input
                            type="number"
                            min={0}
                            max={item.max_marks}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => handleCellBlur(row.student_id, item.id, item.max_marks)}
                            onKeyDown={(e) => handleCellKeyDown(e, row.student_id, item.id, item.max_marks)}
                            className="w-12 rounded border border-da-accent bg-da-surface px-1 py-0.5 text-center text-sm text-da-text focus:outline-none focus:ring-2 focus:ring-da-accent"
                            autoFocus
                          />
                        ) : isSaving ? (
                          <span className="text-da-accent">…</span>
                        ) : hasAny ? (
                          <span>
                            <span className="font-semibold text-da-text">
                              {cell.marks_awarded ?? "—"}
                            </span>
                            {cell.self_marks !== null && (
                              <span className="text-xs text-da-muted ml-0.5">
                                /{cell.self_marks}
                                {diff !== null && diff !== 0 && (
                                  <span className={diff > 0 ? "text-yellow-400" : "text-red-400"}>
                                    ({diff > 0 ? "+" : ""}{diff})
                                  </span>
                                )}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-da-muted">—</span>
                        )}
                      </td>
                    );
                  })}

                  {/* Disagreement % */}
                  <td className={`px-3 py-2 text-center ${disagreementColor(row.disagreement)}`}>
                    {row.disagreement !== null ? `${row.disagreement.toFixed(1)}%` : "—"}
                  </td>

                  {/* PDF link */}
                  <td className="px-3 py-2 text-center">
                    {row.pdf_url ? (
                      <a
                        href={row.pdf_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline text-lg"
                        title="View corrected work"
                      >
                        📎
                      </a>
                    ) : (
                      <span className="text-da-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}

              {/* Class average row */}
              <tr className="border-t-2 border-da-border/60 bg-da-surface/70">
                <td className="sticky left-0 z-10 bg-da-surface/70 px-3 py-2 font-bold text-da-amber">
                  Class Average
                </td>
                {classAverageByItem.map((avg, idx) => {
                  const diff = avg.teacherAvg !== null && avg.selfAvg !== null
                    ? avg.selfAvg - avg.teacherAvg
                    : null;
                  return (
                    <td key={`avg-${data.items[idx].id}`} className="px-3 py-2 text-center text-da-text">
                      {avg.teacherAvg !== null ? (
                        <span>
                          <span className="font-semibold">{avg.teacherAvg.toFixed(1)}</span>
                          {avg.selfAvg !== null && (
                            <span className="ml-1 text-xs text-da-muted">
                              /{avg.selfAvg.toFixed(1)}
                              {diff !== null && diff !== 0 && (
                                <span className={diff > 0 ? "text-yellow-400" : "text-red-400"}>
                                  ({diff > 0 ? "+" : ""}{diff.toFixed(1)})
                                </span>
                              )}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-da-muted">—</span>
                      )}
                    </td>
                  );
                })}
                <td className={`px-3 py-2 text-center font-semibold ${disagreementColor(classAverageDisagreement)}`}>
                  {classAverageDisagreement !== null ? `${classAverageDisagreement.toFixed(1)}%` : "—"}
                </td>
                <td className="px-3 py-2 text-center text-da-muted">—</td>
              </tr>
            </tbody>
          </table>
          </div>

          {/* Right-side first-name quick menu */}
          <aside className="w-40 shrink-0 rounded-lg border border-da-border bg-da-surface p-2">
            <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-da-muted">Students</p>
            <div className="max-h-130 space-y-1 overflow-y-auto">
              {visibleRows
                .slice()
                .sort((a, b) => a.display_name.localeCompare(b.display_name))
                .map((row) => (
                  <button
                    key={`menu-${row.student_id}`}
                    type="button"
                    onClick={() => setSelectedStudentId(row.student_id)}
                    className={`w-full rounded px-2 py-1 text-left text-sm ${
                      selectedStudentId === row.student_id
                        ? "bg-da-accent text-da-bg font-semibold"
                        : "text-da-text hover:bg-da-hover"
                    }`}
                  >
                    {firstName(row.display_name)}
                  </button>
                ))}
            </div>
          </aside>
        </div>
      )}

      {/* ── Student preview panel ────────────────────────────────────────── */}
      {selectedStudentId && data && (() => {
        const row = visibleRows.find((r) => r.student_id === selectedStudentId);
        if (!row) return null;

        // Build ReflectionItem[] by merging test items with the student's marks
        const reflectionItems: ReflectionItem[] = data.items.map((item) => {
          const mark = row.items.find((m) => m.test_item_id === item.id);
          return {
            id: item.id,
            test_item_id: item.id,
            question_number: item.question_number,
            part_label: item.part_label,
            max_marks: item.max_marks,
            subtopic_codes: item.subtopic_codes ?? [],
            subtopic_labels: item.subtopic_labels ?? [],
            marks_awarded: mark?.marks_awarded ?? null,
            self_marks: mark?.self_marks ?? null,
          };
        });

        const hasSelf = reflectionItems.some((i) => i.self_marks !== null);
        const hasTeacher = reflectionItems.some((i) => i.marks_awarded !== null);
        const disagreement = computeDisagreement(reflectionItems);

        const stepLabel = !hasSelf
          ? "Step 1 — Awaiting self-assessment"
          : !hasTeacher
            ? "Step 2 — Awaiting teacher marks"
            : disagreement !== 0
              ? `Step 2 — Resolving disagreement (${disagreement !== null ? disagreement.toFixed(1) + "%" : "pending"})`
              : row.pdf_url
                ? "Step 4 — Corrections uploaded ✅"
                : "Step 3 — Ready to upload";

        return (
          <div className="mt-4 rounded-xl border-2 border-da-border bg-da-surface space-y-4 p-5">
            {/* Header */}
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-da-muted mb-0.5">
                  Viewing as student
                </p>
                <h3 className="text-xl font-bold text-da-text">{row.display_name}</h3>
                <p className="text-sm text-da-muted mt-0.5">{stepLabel}</p>
              </div>
              <div className="flex items-center gap-3">
                {row.pdf_url && (
                  <a
                    href={row.pdf_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="da-btn"
                  >
                    📎 View corrections PDF
                  </a>
                )}
                <a
                  href={`/dashboard/reflection?testId=${selectedTest}&viewStudent=${selectedStudentId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="da-btn"
                >
                  ↗ Open full student view
                </a>
                <button
                  type="button"
                  onClick={() => setSelectedStudentId("")}
                  className="da-btn da-btn-ghost"
                >
                  ✕ Close
                </button>
              </div>
            </div>

            {/* Disagreement status */}
            {hasSelf && hasTeacher && (
              <div className={`rounded-lg border px-4 py-3 text-sm font-semibold flex items-center gap-3 ${
                disagreement === 0
                  ? "border-green-700 bg-green-900/30 text-green-300"
                  : disagreement !== null && disagreement <= 10
                    ? "border-yellow-700 bg-yellow-900/30 text-yellow-300"
                    : "border-red-700 bg-red-900/30 text-red-300"
              }`}>
                <span className="text-base">
                  {disagreement === 0 ? "✅" : disagreement !== null && disagreement <= 10 ? "⚠️" : "🔴"}
                </span>
                <span>
                  Judgement Disagreement:{" "}
                  <strong>{disagreement !== null ? `${disagreement.toFixed(1)}%` : "pending"}</strong>
                  {disagreement === 0 ? " — ready to upload corrections" : ""}
                </span>
              </div>
            )}

            {!hasSelf && (
              <div className="rounded-lg border border-da-border/50 bg-da-bg px-4 py-3 text-sm text-da-muted">
                ⏳ This student has not yet submitted their self-assessment marks.
              </div>
            )}

            {hasSelf && !hasTeacher && (
              <div className="rounded-lg border border-orange-700 bg-orange-900/25 px-4 py-3 text-sm text-orange-300">
                ⏳ Self-marks submitted — waiting for you to enter teacher marks above.
              </div>
            )}

            {/* Score table (read-only) */}
            {hasSelf && reflectionItems.length > 0 && (
              <ScoreTable items={reflectionItems} editable={false} />
            )}

            {/* Upload status */}
            {!row.pdf_url && hasSelf && hasTeacher && (
              <div className={`rounded-lg border px-4 py-3 text-sm ${
                disagreement === 0
                  ? "border-da-border bg-da-hover text-da-accent"
                  : "border-orange-700 bg-orange-900/25 text-orange-300"
              }`}>
                {disagreement === 0
                  ? "📤 Disagreement is 0% — student can now upload their corrections."
                  : "🔒 Upload locked until disagreement reaches 0%."}
              </div>
            )}
          </div>
        );
      })()}

      {data && data.items.length === 0 && (
        <p className="text-sm text-da-muted">
          No items found for this test.{" "}
          <a href="/dashboard/tests" className="text-da-accent hover:underline">
            Add questions →
          </a>
        </p>
      )}

      {!selectedTest && !loading && (
        <p className="text-sm text-da-muted">
          No tests available.{" "}
          <a href="/dashboard/tests" className="text-da-accent hover:underline">
            Create your first test →
          </a>
        </p>
      )}
    </div>
  );
}
