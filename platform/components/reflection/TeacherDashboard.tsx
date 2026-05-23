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
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
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

  // Close menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMenuFor(null);
      }
    };
    if (menuFor) document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [menuFor]);

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
    if (!selectedTest) { setData(null); return; }
    setLoading(true);
    setEditingCell(null);
    setSavedCells(new Set());
    setMenuFor(null);
    setSelectedStudentId("");
    fetch(`/api/reflection/class-data?testId=${encodeURIComponent(selectedTest)}`)
      .then((r) => r.json())
      .then((d: ClassData) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
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

  const toggleStudent = useCallback(async (studentProfileId: string, hidden: boolean) => {
    setMenuFor(null);
    const res = await fetch("/api/reflection/toggle-student", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentProfileId, hidden }),
    });
    if (res.ok) {
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          rows: prev.rows.map((row) =>
            row.student_id === studentProfileId ? { ...row, hidden } : row
          ),
        };
      });
    }
  }, []);

  const visibleRows = data?.rows.filter((r) => showHidden || !r.hidden) ?? [];
  const hiddenCount = data?.rows.filter((r) => r.hidden).length ?? 0;

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
              onChange={(e) => setSelectedCourse(e.target.value)}
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
          className="ml-auto text-sm text-da-accent hover:underline"
        >
          + Manage Tests
        </a>

        {hiddenCount > 0 && (
          <label className="flex items-center gap-1.5 text-sm text-da-muted">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
              className="rounded"
            />
            Show hidden ({hiddenCount})
          </label>
        )}

        {/* Student selector — appears once class data is loaded */}
        {data && data.rows.length > 0 && (
          <>
            <span className="text-da-muted">|</span>
            <label htmlFor="student-select" className="text-base font-semibold text-da-amber">
              Student:
            </label>
            <select
              id="student-select"
              value={selectedStudentId}
              onChange={(e) => setSelectedStudentId(e.target.value)}
              className="rounded border border-da-border px-3 py-1.5 text-sm font-semibold text-da-text bg-da-surface focus:ring-2 focus:ring-da-accent"
            >
              <option value="">— select to preview —</option>
              {[...data.rows]
                .sort((a, b) => a.display_name.localeCompare(b.display_name))
                .map((row) => (
                  <option key={row.student_id} value={row.student_id}>
                    {row.display_name}
                  </option>
                ))}
            </select>
            {selectedStudentId && (
              <a
                href={`/dashboard/reflection?testId=${selectedTest}&viewStudent=${selectedStudentId}`}
                className="text-sm text-da-accent hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                ↗ Open full view
              </a>
            )}
          </>
        )}
      </div>

      {loading && <p className="text-sm text-da-muted">Loading…</p>}

      {data && data.items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-da-border/40 bg-da-surface">
                <th className="sticky left-0 bg-da-surface px-3 py-2 text-left font-bold text-da-amber min-w-[180px]">
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
                  className={`border-b border-da-border/20 ${row.hidden ? "opacity-50" : ""}`}
                >
                  {/* Name cell */}
                  <td
                    className={`sticky left-0 bg-da-bg px-3 py-2 font-medium text-da-text ${
                      menuFor === row.student_id ? "z-30" : "z-10"
                    }`}
                  >
                    <div className="relative">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuFor(menuFor === row.student_id ? null : row.student_id);
                        }}
                        className="text-left hover:text-da-amber hover:underline"
                      >
                        {row.display_name}
                        {row.hidden && <span className="ml-1 text-xs text-da-muted">(hidden)</span>}
                      </button>
                      {menuFor === row.student_id && (
                        <div className="absolute left-0 top-full z-20 mt-1 w-52 rounded-lg border border-da-border bg-da-surface py-1 shadow-lg">
                          <a
                            href={`/dashboard/reflection?testId=${selectedTest}&viewStudent=${row.student_id}`}
                            className="flex items-center gap-2 px-3 py-2 text-sm text-da-text hover:bg-da-hover"
                          >
                            👤 View student reflection
                          </a>
                          <button
                            type="button"
                            onClick={() => toggleStudent(row.student_id, !row.hidden)}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-da-text hover:bg-da-hover"
                          >
                            {row.hidden ? "👁 Unhide student" : "🙈 Hide student"}
                          </button>
                        </div>
                      )}
                    </div>
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
            </tbody>
          </table>
        </div>
      )}

      {/* ── Student preview panel ────────────────────────────────────────── */}
      {selectedStudentId && data && (() => {
        const row = data.rows.find((r) => r.student_id === selectedStudentId);
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
                    className="flex items-center gap-1.5 rounded-lg border border-green-700 bg-green-900/30 px-3 py-1.5 text-sm font-medium text-green-300 hover:bg-green-900/50"
                  >
                    📎 View corrections PDF
                  </a>
                )}
                <a
                  href={`/dashboard/reflection?testId=${selectedTest}&viewStudent=${selectedStudentId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-lg border border-da-border bg-da-hover px-3 py-1.5 text-sm font-medium text-da-accent hover:opacity-80"
                >
                  ↗ Open full student view
                </a>
                <button
                  type="button"
                  onClick={() => setSelectedStudentId("")}
                  className="rounded-lg border border-da-border bg-da-bg px-3 py-1.5 text-sm text-da-muted hover:bg-da-hover"
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
