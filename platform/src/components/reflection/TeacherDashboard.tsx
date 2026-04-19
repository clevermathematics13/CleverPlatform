"use client";

import { useState, useEffect } from "react";
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

export function TeacherDashboard({ tests }: TeacherDashboardProps) {
  const [selectedTest, setSelectedTest] = useState<string>(
    tests[0]?.id ?? ""
  );
  const [data, setData] = useState<ClassData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedTest) return;
    setLoading(true);
    fetch(`/api/reflection/class-data?testId=${encodeURIComponent(selectedTest)}`)
      .then((r) => r.json())
      .then((d: ClassData) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [selectedTest]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
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
              {data.rows.map((row) => (
                <tr key={row.student_id} className="border-b">
                  <td className="sticky left-0 bg-white px-3 py-2 font-medium text-gray-900">
                    {row.display_name}
                  </td>
                  {row.items.map((cell, i) => {
                    const diff =
                      cell.marks_awarded !== null && cell.self_marks !== null
                        ? cell.self_marks - cell.marks_awarded
                        : null;
                    const hasAny =
                      cell.marks_awarded !== null || cell.self_marks !== null;
                    return (
                      <td
                        key={data.items[i].id}
                        className={`px-3 py-2 text-center text-gray-800 ${
                          diff === null
                            ? ""
                            : diff === 0
                              ? "bg-green-50"
                              : Math.abs(diff) <= 1
                                ? "bg-yellow-50"
                                : "bg-red-50"
                        }`}
                        title={
                          hasAny
                            ? `Teacher: ${cell.marks_awarded ?? "—"}, Self: ${cell.self_marks ?? "—"}`
                            : "No marks"
                        }
                      >
                        {hasAny ? (
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
