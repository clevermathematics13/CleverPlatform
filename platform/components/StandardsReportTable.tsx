import {
  PERFORMANCE_LEVELS,
  performanceLevelLabel,
  performanceLevelShort,
  type PerformanceLevel,
  type StandardsReport,
} from "@/lib/standards-report";

/**
 * One student's strand levels, as the teacher rubric's score record lays
 * them out: a row per strand with marks out of the strand's max and the
 * level, then the overall. No hooks, so it renders on the server (the
 * standards report page) and in the client (the AI-grade review panel,
 * where it follows the marks the teacher is editing).
 */

export const LEVEL_STYLE: Record<PerformanceLevel, string> = {
  exceeding: "border-green-400/40 bg-green-500/15 text-green-300",
  meeting: "border-blue-400/40 bg-blue-500/15 text-blue-300",
  approaching: "border-amber-400/40 bg-amber-500/15 text-amber-300",
  beginning: "border-red-400/40 bg-red-500/15 text-red-300",
};

export function LevelChip({
  level,
  short = false,
  provisional = false,
}: {
  level: PerformanceLevel | null;
  /** "M" rather than "Meeting", for a dense grid. */
  short?: boolean;
  /** Not every part is marked yet: shown faded, with a title saying so. */
  provisional?: boolean;
}) {
  if (!level) return <span className="text-xs text-da-muted">—</span>;
  return (
    <span
      className={`inline-block rounded border px-2 py-0.5 text-xs font-medium ${LEVEL_STYLE[level]} ${
        provisional ? "opacity-60" : ""
      }`}
      title={
        provisional
          ? `${performanceLevelLabel(level)} so far -- not every part is marked yet`
          : performanceLevelLabel(level)
      }
    >
      {short ? performanceLevelShort(level) : performanceLevelLabel(level)}
    </span>
  );
}

export function StandardsReportTable({ report, compact = false }: { report: StandardsReport; compact?: boolean }) {
  const cell = compact ? "px-2 py-1" : "px-3 py-1.5";
  return (
    <table className="text-sm">
      <thead>
        <tr className="text-left text-xs uppercase tracking-wide text-da-muted">
          <th className={`${cell} font-semibold`}>Strand</th>
          <th className={`${cell} font-semibold`}>Marks</th>
          <th className={`${cell} font-semibold`}>Level</th>
          {!compact && <th className={`${cell} font-semibold`}>Bands</th>}
        </tr>
      </thead>
      <tbody>
        {report.strands.map((s) => {
          const provisional = s.markedParts > 0 && s.markedParts < s.totalParts;
          return (
            <tr key={s.code} className="border-t border-da-border/50">
              <td className={`${cell} text-da-text`}>
                <span className="font-semibold">{s.code}</span>
                {!compact && <span className="ml-2 text-da-muted">{s.name}</span>}
              </td>
              <td className={`${cell} tabular-nums text-da-text`}>
                {s.markedParts > 0 ? s.marks : "—"}/{s.max}
                {provisional && (
                  <span className="ml-1 text-xs text-da-muted" title="Parts marked so far">
                    ({s.markedParts}/{s.totalParts})
                  </span>
                )}
              </td>
              <td className={cell}>
                <LevelChip level={s.level} short={compact} provisional={provisional} />
              </td>
              {!compact && (
                <td className={`${cell} text-xs text-da-muted`}>
                  {PERFORMANCE_LEVELS.map((l) => `${l.short} ${bandRange(l.value, s.thresholds, s.max)}`).join(" · ")}
                </td>
              )}
            </tr>
          );
        })}
        <tr className="border-t border-da-border">
          <td className={`${cell} font-semibold text-da-text`}>Overall</td>
          <td className={`${cell} tabular-nums font-semibold text-da-text`}>
            {report.overall.markedParts > 0 ? report.overall.marks : "—"}/{report.overall.max}
          </td>
          <td className={cell}>
            <LevelChip level={report.overall.level} short={compact} provisional={!report.complete && report.overall.markedParts > 0} />
          </td>
          {!compact && (
            <td className={`${cell} text-xs text-da-muted`}>
              {PERFORMANCE_LEVELS.map(
                (l) => `${l.short} ${bandRange(l.value, report.overall.thresholds, report.overall.max)}`
              ).join(" · ")}
            </td>
          )}
        </tr>
      </tbody>
    </table>
  );
}

function bandRange(
  level: PerformanceLevel,
  t: { exceeding: number; meeting: number; approaching: number },
  max: number
): string {
  const range = (lo: number, hi: number) => (lo > hi ? "-" : lo === hi ? `${lo}` : `${lo}-${hi}`);
  switch (level) {
    case "exceeding":
      return range(t.exceeding, max);
    case "meeting":
      return range(t.meeting, t.exceeding - 1);
    case "approaching":
      return range(t.approaching, t.meeting - 1);
    default:
      return range(0, t.approaching - 1);
  }
}
