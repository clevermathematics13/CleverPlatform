"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { ReflectionTest, StudentReflectionRow } from "@/lib/reflection-types";

interface TeacherDashboardProps {
  tests: ReflectionTest[];
}

interface ClassData {
  items: {
    id: string;
    question_number: number;
    part_label: string;
    max_marks: number;
  }[];
  rows: StudentReflectionRow[];
}

/** Key for tracking which cell is being edited */
type CellKey = `${string}:${string}`; // studentId:testItemId

export function TeacherDashboard({ tests }: TeacherDashboardProps) {
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
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuFor(null);
      }
    };
    if (menuFor) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuFor]);

  useEffect(() => {
    if (!selectedTest) return;
    setLoading(true);
    setEditingCell(null);
    setSavedCells(new Set());
    setMenuFor(null);
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
          // Update local data
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

  const handleCellClick = (
    studentId: string,
    testItemId: string,
    currentMarks: number | null
  ) => {
    const key: CellKey = `${studentId}:${testItemId}`;
    setEditingCell(key);
    setEditValue(currentMarks !== null ? String(currentMarks) : "0");
  };

  const handleCellBlur = (
    studentId: string,
    testItemId: string,
    maxMarks: number
  ) => {
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
    if (e.key === "Enter") {
      e.preventDefault();
      handleCellBlur(studentId, testItemId, maxMarks);
    } else if (e.key === "Escape") {
      setEditingCell(null);
    }
  };

  const toggleStudent = useCallback(
    async (studentProfileId: string, hidden: boolean) => {
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
              row.student_id === studentProfileId
                ? { ...row, hidden }
                : row
            ),
          };
        });
      }
    },
    []
  );

  const visibleRows = data?.rows.filter((r) => showHidden || !r.hidden) ?? [];
  const hiddenCount = data?.rows.filter((r) => r.hidden).length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 flex-wrap">
        <label htmlFor="test-select" className="text-sm font-medium">
          Select Test:
        </label>
        <select
          id="test-select"
          value={selectedTest}
          onChange={(e) => setSelectedTest(e.target.value)}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm"
        >
          {tests.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        {hiddenCount > 0 && (
          <label className="flex items-center gap-1.5 text-sm text-gray-600 ml-auto">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
              className="rounded"
            />
            Show hidden ({hiddenCount})
          </label>
        )}
      </div>

      {loading && <p className="text-sm text-gray-500">Loading…</p>}

      {data && data.items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="sticky left-0 bg-gray-50 px-3 py-2 text-left font-semibold text-gray-900">
                  Student
                </th>
                {data.items.map((item) => (
                  <th key={item.id} className="px-3 py-2 text-center font-semibold text-gray-900">
                    Q{item.question_number}
                    {item.part_label ? item.part_label : ""}
                  </th>
                ))}
                <th className="px-3 py-2 text-center font-semibold text-gray-900">📄</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr
                  key={row.student_id}
                  className={`border-b ${row.hidden ? "opacity-50" : ""}`}
                >
                  <td className="sticky left-0 bg-white px-3 py-2 font-medium text-gray-900">
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() =>
                          setMenuFor(
                            menuFor === row.student_id
                              ? null
                              : row.student_id
                          )
                        }
                        className="text-left hover:text-blue-600 hover:underline"
                      >
                        {row.display_name}
                        {row.hidden && (
                          <span className="ml-1 text-xs text-gray-400">
                            (hidden)
                          </span>
                        )}
                      </button>
                      {menuFor === row.student_id && (
                        <div
                          ref={menuRef}
                          className="absolute left-0 top-full z-20 mt-1 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
                        >
                          <a
                            href={`/dashboard/reflection?testId=${selectedTest}&viewStudent=${row.student_id}`}
                            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                          >
                            👤 View student page
                          </a>
                          <button
                            type="button"
                            onClick={() =>
                              toggleStudent(row.student_id, !row.hidden)
                            }
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                          >
                            {row.hidden ? "👁 Unhide student" : "🙈 Hide student"}
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
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
                    const hasAny =
                      cell.marks_awarded !== null || cell.self_marks !== null;
                    return (
                      <td
                        key={item.id}
                        className={`px-3 py-2 text-center text-gray-800 cursor-pointer transition-colors ${
                          justSaved
                            ? "bg-green-100"
                            : isSaving
                              ? "bg-blue-50"
                              : diff === null
                                ? "hover:bg-gray-100"
                                : diff === 0
                                  ? "bg-green-50 hover:bg-green-100"
                                  : Math.abs(diff) <= 1
                                    ? "bg-yellow-50 hover:bg-yellow-100"
                                    : "bg-red-50 hover:bg-red-100"
                        }`}
                        title={
                          hasAny
                            ? `Teacher: ${cell.marks_awarded ?? "—"}, Self: ${cell.self_marks ?? "—"} (click to edit)`
                            : "Click to enter marks"
                        }
                        onClick={() =>
                          !isEditing &&
                          handleCellClick(
                            row.student_id,
                            item.id,
                            cell.marks_awarded
                          )
                        }
                      >
                        {isEditing ? (
                          <input
                            type="number"
                            min={0}
                            max={item.max_marks}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() =>
                              handleCellBlur(
                                row.student_id,
                                item.id,
                                item.max_marks
                              )
                            }
                            onKeyDown={(e) =>
                              handleCellKeyDown(
                                e,
                                row.student_id,
                                item.id,
                                item.max_marks
                              )
                            }
                            className="w-12 rounded border border-blue-400 bg-white px-1 py-0.5 text-center text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            autoFocus
                          />
                        ) : isSaving ? (
                          <span className="text-blue-500">…</span>
                        ) : hasAny ? (
                          <span>
                            <span className="font-semibold text-gray-900">
                              {cell.marks_awarded ?? "—"}
                            </span>
                            {cell.self_marks !== null && (
                              <span className="text-xs text-gray-500 ml-0.5">
                                /
                                {cell.self_marks}
                                {diff !== null && diff !== 0 && (
                                  <span
                                    className={
                                      diff > 0
                                        ? "text-yellow-600"
                                        : "text-red-500"
                                    }
                                  >
                                    ({diff > 0 ? "+" : ""}
                                    {diff})
                                  </span>
                                )}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-center">
                    {row.has_upload ? "✅" : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.items.length === 0 && (
        <p className="text-sm text-gray-500">No items found for this test.</p>
      )}
    </div>
  );
}
