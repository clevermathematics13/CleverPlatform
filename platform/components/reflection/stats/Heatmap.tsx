"use client";

import { useEffect, useRef, useState } from "react";
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
  const [menuForStudentId, setMenuForStudentId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Get unique students and subtopics
  const students = Array.from(
    new Map(
      cells.map((c) => [c.student_id, { id: c.student_id, name: c.display_name, hidden: c.hidden }])
    ).values()
  ).sort((a, b) => a.name.localeCompare(b.name));
  const subtopics = [
    ...new Set(cells.map((c) => c.subtopic_code)),
  ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const cellMap = new Map<string, number>();
  for (const c of cells) {
    cellMap.set(`${c.student_id}:${c.subtopic_code}`, c.percentage);
  }

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setMenuForStudentId(null);
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  if (cells.length === 0) {
    return (
      <p className="rounded-xl border border-da-border bg-da-bg/60 px-4 py-5 text-sm text-da-muted">
        No mastery data available yet.
      </p>
    );
  }

  return (
    <div className="space-y-5" ref={containerRef}>
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
              <tr key={student.id}>
                <td className="sticky left-0 z-10 border-b border-da-border bg-da-surface px-3 py-1.5 font-medium whitespace-nowrap text-da-text">
                  <div className="relative inline-block">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuForStudentId((prev) => (prev === student.id ? null : student.id));
                      }}
                      className="text-left hover:text-da-amber hover:underline"
                    >
                      {student.name}
                    </button>
                    {student.hidden && (
                      <span className="ml-1 text-xs font-normal text-da-muted">(hidden)</span>
                    )}
                    {menuForStudentId === student.id && (
                      <div className="absolute left-0 top-full z-30 mt-1 min-w-45 rounded-lg border border-da-border bg-da-surface py-1 shadow-lg">
                        <a
                          href={`/dashboard/mastery?studentId=${student.id}`}
                          className="block px-3 py-2 text-sm text-da-text hover:bg-da-hover"
                        >
                          View student&apos;s mastery
                        </a>
                      </div>
                    )}
                  </div>
                </td>
                {subtopics.map((st) => {
                  const pct = cellMap.get(`${student.id}:${st}`);
                  return (
                    <td
                      key={st}
                      className={`border-b border-da-border px-1 py-1.5 text-center font-semibold cursor-pointer transition-opacity hover:opacity-85 ${
                        pct !== undefined ? getColor(pct) : "bg-da-bg/70 text-da-muted"
                      }`}
                      onClick={() =>
                        pct !== undefined &&
                        setSelectedCell({ student: student.name, subtopic: st })
                      }
                      title={
                        pct !== undefined
                          ? `${student.name} — ${st}: ${pct}%`
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
