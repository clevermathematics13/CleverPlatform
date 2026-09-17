import type { SequencePlot } from "@/lib/lessons/types";

/** Plots the terms of a sequence against their term numbers.
 *
 *  Hand-drawn SVG rather than components/IbGraph.tsx, deliberately. IbGraph
 *  hardcodes `bg-white` with `border-gray-300`, and globals.css forces
 *  `.MafsView { --mafs-bg: #ffffff !important }` because Mafs sets black on
 *  that element itself -- so an IbGraph here is a bright white rectangle in
 *  the middle of a dark lesson, and the stylesheet's own comment says
 *  theming it from a parent does not work. It also calls ResizeObserver in
 *  an effect, so both existing consumers mount it with dynamic({ssr:false}).
 *  That is a client boundary and a white card for what is, here, four points
 *  and two axes. This renders on the server in the page's own palette.
 *
 *  The point of the figure is the SHAPE: geometric terms curve away, while
 *  arithmetic terms sit on a straight line. Points are drawn without a
 *  joining curve on purpose -- a sequence is defined only at whole term
 *  numbers, and a smooth curve through them invites reading off a value at
 *  term $2.5$, which does not exist. */
export function SequencePlotFigure({ plot }: { plot: SequencePlot }) {
  // ---- Geometry. A fixed viewBox scaled by CSS, so it stays crisp and
  // needs no measurement pass.
  const width = 520;
  const height = 320;
  const padLeft = 58;
  const padBottom = 46;
  const padTop = 18;
  const padRight = 18;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const x = (n: number) => padLeft + (n / plot.xMax) * plotW;
  const y = (v: number) => padTop + plotH - (v / plot.yMax) * plotH;

  const yTicks: number[] = [];
  for (let v = 0; v <= plot.yMax + 1e-9; v += plot.yStep) yTicks.push(Number(v.toFixed(6)));
  const xTicks = Array.from({ length: plot.xMax + 1 }, (_, i) => i);

  // Two series at most in practice; the second is the contrast case.
  const seriesColor = (kind: SequencePlot["series"][number]["kind"], index: number) =>
    index === 0 ? (kind === "geometric" ? "#e0405f" : "#7cc4ff") : kind === "geometric" ? "#e0405f" : "#7cc4ff";

  return (
    <figure className="mt-5 rounded-lg border border-da-border bg-da-bg/60 p-4">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label={plot.caption}
      >
        {/* ---- Grid */}
        {yTicks.map((v) => (
          <line
            key={`gy-${v}`}
            x1={padLeft}
            y1={y(v)}
            x2={width - padRight}
            y2={y(v)}
            stroke="#4a3038"
            strokeWidth={v === 0 ? 1.5 : 0.6}
          />
        ))}
        {xTicks.map((n) => (
          <line
            key={`gx-${n}`}
            x1={x(n)}
            y1={padTop}
            x2={x(n)}
            y2={padTop + plotH}
            stroke="#4a3038"
            strokeWidth={n === 0 ? 1.5 : 0.6}
          />
        ))}

        {/* ---- Tick labels */}
        {yTicks.map((v) => (
          <text
            key={`ty-${v}`}
            x={padLeft - 8}
            y={y(v) + 4}
            textAnchor="end"
            fontSize={11}
            fill="#c9b1b8"
            fontFamily="ui-monospace, monospace"
          >
            {v}
          </text>
        ))}
        {xTicks.map((n) => (
          <text
            key={`tx-${n}`}
            x={x(n)}
            y={padTop + plotH + 17}
            textAnchor="middle"
            fontSize={11}
            fill="#c9b1b8"
            fontFamily="ui-monospace, monospace"
          >
            {n}
          </text>
        ))}

        {/* ---- Axis labels */}
        <text
          x={padLeft + plotW / 2}
          y={height - 8}
          textAnchor="middle"
          fontSize={12}
          fill="#f5eef0"
        >
          {plot.xLabel}
        </text>
        <text
          x={14}
          y={padTop + plotH / 2}
          textAnchor="middle"
          fontSize={12}
          fill="#f5eef0"
          transform={`rotate(-90 14 ${padTop + plotH / 2})`}
        >
          {plot.yLabel}
        </text>

        {/* ---- The terms */}
        {plot.series.map((s, si) => (
          <g key={s.label}>
            {s.points.map(([n, v]) => (
              <circle
                key={`${s.label}-${n}`}
                cx={x(n)}
                cy={y(v)}
                r={5}
                fill={seriesColor(s.kind, si)}
                stroke="#0f0b0d"
                strokeWidth={1.5}
              />
            ))}
          </g>
        ))}
      </svg>

      <figcaption className="mt-3 text-xs leading-relaxed text-da-muted">
        {plot.caption}
        {plot.series.length > 1 && (
          <span className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
            {plot.series.map((s, si) => (
              <span key={s.label} className="inline-flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: seriesColor(s.kind, si) }}
                />
                {s.label}
              </span>
            ))}
          </span>
        )}
      </figcaption>
    </figure>
  );
}
