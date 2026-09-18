import {
  ACTIVITY_OUTCOMES,
  activityOutcomeLabel,
  activityOutcomeShort,
  type ActivityOutcome,
  type ActivityReport,
} from "@/lib/activity-rubric";

/**
 * One student's learning targets on an Exploration or homework: a row per
 * target with the outcome, and the parts behind it. No hooks, so it renders
 * on the server (the activity report page) and in the client (the AI-grade
 * review panel, where it follows the marks the teacher is editing).
 */

export const OUTCOME_STYLE: Record<ActivityOutcome, string> = {
  got_it: "border-green-400/40 bg-green-500/15 text-green-300",
  almost: "border-amber-400/40 bg-amber-500/15 text-amber-300",
  not_yet: "border-red-400/40 bg-red-500/15 text-red-300",
};

export function OutcomeChip({
  outcome,
  short = false,
  provisional = false,
}: {
  outcome: ActivityOutcome | null;
  /** "G" rather than "Got it", for a dense grid. */
  short?: boolean;
  /** Not every part is marked yet: shown faded, with a title saying so. */
  provisional?: boolean;
}) {
  if (!outcome) return <span className="text-xs text-da-muted">—</span>;
  return (
    <span
      className={`inline-block rounded border px-2 py-0.5 text-xs font-medium ${OUTCOME_STYLE[outcome]} ${
        provisional ? "opacity-60" : ""
      }`}
      title={
        provisional
          ? `${activityOutcomeLabel(outcome)} so far -- not every part is marked yet`
          : activityOutcomeLabel(outcome)
      }
    >
      {short ? activityOutcomeShort(outcome) : activityOutcomeLabel(outcome)}
    </span>
  );
}

export function ActivityReportTable({ report, compact = false }: { report: ActivityReport; compact?: boolean }) {
  const cell = compact ? "px-2 py-1" : "px-3 py-1.5";
  return (
    <table className="text-sm">
      <thead>
        <tr className="text-left text-xs uppercase tracking-wide text-da-muted">
          <th className={`${cell} font-semibold`}>Target</th>
          <th className={`${cell} font-semibold`}>Outcome</th>
          <th className={`${cell} font-semibold`}>Parts</th>
        </tr>
      </thead>
      <tbody>
        {report.targets.map((t) => {
          const provisional = t.markedParts > 0 && t.markedParts < t.totalParts;
          return (
            <tr key={t.code} className="border-t border-da-border/50">
              <td className={`${cell} text-da-text`}>
                <span className="font-semibold">{t.code}</span>{" "}
                <span className="text-da-muted">{t.name}</span>
              </td>
              <td className={cell}>
                <OutcomeChip outcome={t.outcome} provisional={provisional} />
              </td>
              <td className={`${cell} text-xs text-da-muted`}>
                {t.parts
                  .map((p) => `${p.label}${p.marks === null ? "" : ` ${p.marks}/${p.max}`}`)
                  .join(", ")}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** The outcomes in order, for a legend or a tally header. */
export { ACTIVITY_OUTCOMES };
