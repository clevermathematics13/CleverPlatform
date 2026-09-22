/**
 * The two bar marks the Standard Level stats page draws.
 *
 * Deliberately small and server-rendered: no hooks, no client bundle, and a
 * `title` for the hover layer, the same way LevelChip carries its tooltip.
 *
 * Both are SEQUENTIAL marks -- one hue, teal, which is the colour this app
 * already puts on anything Standard Level. A class mean is a magnitude, not a
 * performance level, so it deliberately does NOT wear the green / blue /
 * amber / red the level chips wear: those four mean "Exceeding / Meeting /
 * Approaching / Beginning" for a STUDENT everywhere else in the platform,
 * and a 62% class average is not a student at Approaching.
 *
 * Every meter prints its number beside it, so nothing is encoded by colour
 * alone.
 */

/** A magnitude from 0 to 100, as a thin bar with rounded ends. */
export function ScoreMeter({
  percent,
  title,
  width = "w-24",
}: {
  percent: number;
  title?: string;
  /** Tailwind width class, so a dense table can run narrower than a summary. */
  width?: string;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <span
      className={`inline-block h-1.5 ${width} overflow-hidden rounded-full bg-da-hover align-middle`}
      title={title ?? `${clamped.toFixed(0)}%`}
      role="img"
      aria-label={title ?? `${clamped.toFixed(0)} per cent`}
    >
      <span
        className="block h-full rounded-full bg-teal-400/80"
        style={{ width: `${clamped}%` }}
      />
    </span>
  );
}

/**
 * How a part's marks fell: nothing / part of them / all of them, as three
 * segments of one hue with a 2px gap between them. Recessive to prominent
 * left to right, which is the direction the marks go.
 */
export function DistributionMeter({
  zero,
  partial,
  full,
  total,
  label,
}: {
  zero: number;
  partial: number;
  full: number;
  total: number;
  label?: string;
}) {
  if (total <= 0) return <span className="text-xs text-da-muted">—</span>;
  const pct = (n: number) => (n / total) * 100;
  const segments = [
    { n: zero, className: "bg-da-border", what: "scored nothing" },
    { n: partial, className: "bg-teal-500/45", what: "scored some of the marks" },
    { n: full, className: "bg-teal-400", what: "scored full marks" },
  ].filter((s) => s.n > 0);
  const title =
    label ??
    segments.map((s) => `${s.n} of ${total} ${s.what}`).join(" · ");
  return (
    <span
      className="inline-flex h-1.5 w-24 gap-[2px] overflow-hidden rounded-full align-middle"
      title={title}
      role="img"
      aria-label={title}
    >
      {segments.map((s, i) => (
        <span
          key={i}
          className={`block h-full rounded-full ${s.className}`}
          style={{ width: `${pct(s.n)}%` }}
        />
      ))}
    </span>
  );
}
