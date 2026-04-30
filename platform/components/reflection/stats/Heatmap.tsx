"use client";

import { useState } from "react";
import type { HeatmapCell } from "@/lib/reflection-types";

interface HeatmapProps {
  cells: HeatmapCell[];
}

function getColor(pct: number): string {
  if (pct >= 80) return "bg-green-500 text-white";
  if (pct >= 60) return "bg-green-300 text-green-900";
  if (pct >= 40) return "bg-yellow-300 text-yellow-900";
  if (pct >= 20) return "bg-orange-300 text-orange-900";
  return "bg-red-400 text-white";
}

export function Heatmap({ cells }: HeatmapProps) {
  const [selectedCell, setSelectedCell] = useState<{
    student: string;
    subtopic: string;
  } | null>(null);

  // Get unique students and subtopics
  const students = [...new Set(cells.map((c) => c.display_name))].sort();
  const subtopics = [
    ...new Set(cells.map((c) => c.subtopic_code)),
  ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const hiddenSet = new Set(cells.filter((c) => c.hidden).map((c) => c.display_name));

  const cellMap = new Map<string, number>();
  for (const c of cells) {
    cellMap.set(`${c.display_name}:${c.subtopic_code}`, c.percentage);
  }

  if (cells.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No mastery data available yet.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white px-2 py-1 text-left">
                Student
              </th>
              {subtopics.map((st) => (
                <th
                  key={st}
                  className="px-1 py-1 text-center"
                  style={{ writingMode: "vertical-rl", minWidth: "24px" }}
                >
                  {st}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {students.map((student) => (
              <tr key={student} className="border-t">
                <td className="sticky left-0 bg-white px-2 py-1 font-medium whitespace-nowrap">
                  {student}
                  {hiddenSet.has(student) && <span className="ml-1 text-xs font-normal text-gray-400">(hidden)</span>}
                </td>
                {subtopics.map((st) => {
                  const pct = cellMap.get(`${student}:${st}`);
                  return (
                    <td
                      key={st}
                      className={`px-1 py-1 text-center cursor-pointer ${
                        pct !== undefined ? getColor(pct) : "bg-gray-100"
                      }`}
                      onClick={() =>
                        pct !== undefined &&
                        setSelectedCell({ student, subtopic: st })
                      }
                      title={
                        pct !== undefined
                          ? `${student} — ${st}: ${pct}%`
                          : "No data"
                      }
                    >
                      {pct !== undefined ? `${pct}` : ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 text-xs">
        <span className="font-medium">Legend:</span>
        <span className="rounded bg-green-500 px-2 py-0.5 text-white">
          80%+
        </span>
        <span className="rounded bg-green-300 px-2 py-0.5 text-green-900">
          60–79%
        </span>
        <span className="rounded bg-yellow-300 px-2 py-0.5 text-yellow-900">
          40–59%
        </span>
        <span className="rounded bg-orange-300 px-2 py-0.5 text-orange-900">
          20–39%
        </span>
        <span className="rounded bg-red-400 px-2 py-0.5 text-white">
          &lt;20%
        </span>
      </div>

      {/* Drill-down */}
      {selectedCell && (
        <div className="rounded-lg border bg-gray-50 p-4">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold">
              {selectedCell.student} — {selectedCell.subtopic}
            </h4>
            <button
              type="button"
              onClick={() => setSelectedCell(null)}
              className="text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          </div>
          <p className="mt-1 text-sm text-gray-600">
            Mastery:{" "}
            {cellMap.get(
              `${selectedCell.student}:${selectedCell.subtopic}`
            ) ?? 0}
            %
          </p>
        </div>
      )}
    </div>
  );
}
