"use client";

import { useState } from "react";
import type { HeatmapCell } from "@/lib/reflection-types";

interface HeatmapProps {
  cells: HeatmapCell[];
}

function getColor(pct: number): string {
  if (pct >= 80) return "bg-emerald-500 text-white";
  if (pct >= 60) return "bg-emerald-300 text-emerald-950";
  if (pct >= 40) return "bg-amber-300 text-amber-950";
  if (pct >= 20) return "bg-orange-300 text-orange-950";
  return "bg-rose-500 text-white";
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
      <p className="rounded-xl border border-da-border bg-da-bg/60 px-4 py-5 text-sm text-da-muted">
        No mastery data available yet.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="overflow-x-auto rounded-xl border border-da-border bg-da-bg/65 shadow-inner shadow-black/30">
        <table className="min-w-full border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 border-b border-da-border bg-da-bg px-3 py-2 text-left font-semibold text-da-text">
                Student
              </th>
              {subtopics.map((st) => (
                <th
                  key={st}
                  className="sticky top-0 z-20 border-b border-da-border bg-da-bg px-1.5 py-2 text-center font-semibold text-da-muted"
                  style={{ writingMode: "vertical-rl", minWidth: "24px" }}
                >
                  {st}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {students.map((student) => (
              <tr key={student}>
                <td className="sticky left-0 z-10 border-b border-da-border bg-da-surface px-3 py-1.5 font-medium whitespace-nowrap text-da-text">
                  {student}
                  {hiddenSet.has(student) && <span className="ml-1 text-xs font-normal text-da-muted">(hidden)</span>}
                </td>
                {subtopics.map((st) => {
                  const pct = cellMap.get(`${student}:${st}`);
                  return (
                    <td
                      key={st}
                      className={`border-b border-da-border px-1 py-1.5 text-center font-semibold cursor-pointer transition-opacity hover:opacity-85 ${
                        pct !== undefined ? getColor(pct) : "bg-da-bg/70 text-da-muted"
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
      <div className="flex flex-wrap items-center gap-2 text-xs text-da-text">
        <span className="mr-1 font-medium text-da-muted">Legend</span>
        <span className="rounded-md bg-emerald-500 px-2 py-1 font-semibold text-white">
          80%+
        </span>
        <span className="rounded-md bg-emerald-300 px-2 py-1 font-semibold text-emerald-950">
          60–79%
        </span>
        <span className="rounded-md bg-amber-300 px-2 py-1 font-semibold text-amber-950">
          40–59%
        </span>
        <span className="rounded-md bg-orange-300 px-2 py-1 font-semibold text-orange-950">
          20–39%
        </span>
        <span className="rounded-md bg-rose-500 px-2 py-1 font-semibold text-white">
          &lt;20%
        </span>
      </div>

      {/* Drill-down */}
      {selectedCell && (
        <div className="rounded-xl border border-da-border bg-da-bg/70 p-4">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-da-text">
              {selectedCell.student} — {selectedCell.subtopic}
            </h4>
            <button
              type="button"
              onClick={() => setSelectedCell(null)}
              className="text-da-muted hover:text-da-text"
            >
              ✕
            </button>
          </div>
          <p className="mt-1 text-sm text-da-muted">
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
