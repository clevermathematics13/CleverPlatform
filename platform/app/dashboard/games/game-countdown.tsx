"use client";

/** Shared by the host and play screens so the timer reads identically on
 *  both -- a big number plus a shrinking bar, not just small corner text
 *  that's easy to miss mid-question. */
export function GameCountdown({
  secondsLeft,
  totalSeconds,
}: {
  secondsLeft: number;
  totalSeconds: number;
}) {
  const pct = totalSeconds > 0 ? Math.max(0, Math.min(100, (secondsLeft / totalSeconds) * 100)) : 0;
  const urgent = secondsLeft <= 3;

  return (
    <div className="flex items-center gap-3">
      <span
        className={`font-mono text-3xl font-bold tabular-nums ${urgent ? "text-da-danger" : "text-da-accent"}`}
      >
        {secondsLeft}s
      </span>
      <div className="h-2 w-28 overflow-hidden rounded-full bg-da-hover">
        <div
          className={`h-full rounded-full transition-[width] duration-200 ease-linear ${urgent ? "bg-da-danger" : "bg-da-accent"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
