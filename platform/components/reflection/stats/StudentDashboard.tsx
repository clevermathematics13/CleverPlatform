"use client";

import type { SubtopicMastery } from "@/lib/reflection-types";

interface StudentDashboardProps {
  mastery: SubtopicMastery[];
  studentName: string;
  studentId?: string | null;
}

function getBarColor(pct: number): string {
  if (pct >= 80) return "bg-emerald-500";
  if (pct >= 60) return "bg-emerald-300";
  if (pct >= 40) return "bg-amber-400";
  if (pct >= 20) return "bg-orange-400";
  return "bg-rose-500";
}

export function StudentDashboard({
  mastery,
  studentName,
  studentId,
}: StudentDashboardProps) {
  if (mastery.length === 0) {
    return (
      <div className="rounded-xl border border-da-border bg-da-bg/60 py-8 text-center text-da-muted">
        <p className="text-lg text-da-text">No mastery data yet</p>
        <p className="mt-1 text-sm">
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
        <h2 className="text-xl font-bold text-da-text">{studentName}&apos;s Mastery</h2>
        <div className="rounded-lg border border-da-border bg-da-bg/60 px-4 py-2 text-right">
          <p className="text-2xl font-bold text-da-amber">{avgPct}%</p>
          <p className="text-xs text-da-muted">Average Mastery</p>
        </div>
      </div>

      <div className="space-y-2.5">
        {mastery.map((m) => (
          <a
            key={m.code}
            href={`/dashboard/mastery/subtopic?code=${encodeURIComponent(m.code)}${studentId ? `&studentId=${encodeURIComponent(studentId)}` : ""}`}
            className="flex items-center gap-3 rounded-lg border border-da-border/70 bg-da-bg/45 px-3 py-2 transition-colors hover:bg-da-hover"
          >
            <div className="w-16 shrink-0 text-xs font-mono text-da-muted">
              {m.code}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <div className="h-5 flex-1 overflow-hidden rounded-full border border-da-border bg-da-bg/70">
                  <div
                    className={`h-full rounded-full ${getBarColor(m.percentage)}`}
                    style={{ width: `${m.percentage}%` }}
                  />
                </div>
                <span className="w-10 text-right text-xs font-semibold text-da-text">
                  {m.percentage}%
                </span>
              </div>
              <p className="truncate text-[10px] text-da-muted">
                {m.descriptor}
              </p>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
