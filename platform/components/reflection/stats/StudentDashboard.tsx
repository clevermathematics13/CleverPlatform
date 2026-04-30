"use client";

import type { SubtopicMastery } from "@/lib/reflection-types";

interface StudentDashboardProps {
  mastery: SubtopicMastery[];
  studentName: string;
}

function getBarColor(pct: number): string {
  if (pct >= 80) return "bg-green-500";
  if (pct >= 60) return "bg-green-300";
  if (pct >= 40) return "bg-yellow-400";
  if (pct >= 20) return "bg-orange-400";
  return "bg-red-500";
}

export function StudentDashboard({
  mastery,
  studentName,
}: StudentDashboardProps) {
  if (mastery.length === 0) {
    return (
      <div className="text-center text-gray-500 py-8">
        <p className="text-lg">No mastery data yet</p>
        <p className="text-sm mt-1">
          Complete some reflections to see your progress here.
        </p>
      </div>
    );
  }

  const avgPct =
    mastery.length > 0
      ? Math.round(
          mastery.reduce((sum, m) => sum + m.percentage, 0) / mastery.length
        )
      : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">{studentName}&apos;s Mastery</h2>
        <div className="text-right">
          <p className="text-2xl font-bold text-blue-600">{avgPct}%</p>
          <p className="text-xs text-gray-500">Average Mastery</p>
        </div>
      </div>

      <div className="space-y-2">
        {mastery.map((m) => (
          <div key={m.code} className="flex items-center gap-3">
            <div className="w-16 text-xs font-mono text-gray-600 shrink-0">
              {m.code}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${getBarColor(m.percentage)}`}
                    style={{ width: `${m.percentage}%` }}
                  />
                </div>
                <span className="text-xs font-semibold w-10 text-right">
                  {m.percentage}%
                </span>
              </div>
              <p className="text-[10px] text-gray-400 truncate">
                {m.descriptor}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
