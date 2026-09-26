"use client";

import { useId, type ReactNode } from "react";
import type { ExplanationDiagram as Diagram } from "@/lib/mark-scheme-explanation";
import { plainText } from "@/lib/math-text";
import { renderMathTextHtml, renderTex } from "@/lib/tex-render";
import { formatTick, niceTicks, parseExpression, stepValues, traceCurve } from "@/lib/diagram-math";

/**
 * The diagram on one step of a worked explanation (lib/mark-scheme-explanation.ts
 * lists the kinds). Every kind is drawn here from its data, with the app's own
 * colours, rather than accepted as a picture: the data was checked before it
 * was stored, so what a student sees is what was checked, and nothing in it
 * can carry markup or script.
 *
 * Written to be read, not decoded:
 *
 *  - labels are HTML laid over the drawing, not text inside the SVG, so they
 *    stay a readable size on a phone while the drawing scales down;
 *  - colour is never the only signal: new tiles are striped, shaded bar
 *    segments are hatched, graph curves differ in dash pattern too, and
 *    every line of working says in words what was done to reach it;
 *  - every diagram carries its caption, visible, and as the accessible name
 *    of the drawing for a screen reader.
 */
export function ExplanationDiagram({ diagram }: { diagram: Diagram }) {
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, "");
  let body: ReactNode = null;
  try {
    body = diagramBody(diagram, uid);
  } catch {
    // A diagram is an aid. One that cannot be drawn leaves its caption, and
    // the words of the step, rather than taking the slide down with it.
    body = null;
  }
  return (
    <figure className="space-y-2 rounded-md border border-da-border/50 bg-da-bg/60 p-3">
      {body && <div className="max-w-full overflow-x-auto">{body}</div>}
      <figcaption className="text-sm leading-snug text-da-muted" dangerouslySetInnerHTML={{ __html: renderMathTextHtml(diagram.caption) }} />
    </figure>
  );
}

function diagramBody(d: Diagram, uid: string): ReactNode {
  const label = plainText(d.caption);
  switch (d.kind) {
    case "working":
      return <Working lines={d.lines} />;
    case "area_model":
      return <AreaModel rowHeads={d.rowHeads} colHeads={d.colHeads} cells={d.cells} />;
    case "number_line":
      return <NumberLine d={d} label={label} uid={uid} />;
    case "bar_model":
      return <BarModel bars={d.bars} />;
    case "table":
      return <DataTable header={d.header} rows={d.rows} />;
    case "sequence":
      return <Sequence terms={d.terms} jumps={d.jumps} />;
    case "graph":
      return <Graph d={d} label={label} uid={uid} />;
    case "tiles":
      return <Tiles figures={d.figures} uid={uid} />;
  }
}

function Tex({ tex, className = "" }: { tex: string; className?: string }) {
  return <span className={className} dangerouslySetInnerHTML={{ __html: renderTex(tex, false) }} />;
}

function MathText({ src, className = "" }: { src: string; className?: string }) {
  return <span className={className} dangerouslySetInnerHTML={{ __html: renderMathTextHtml(src) }} />;
}

// ---- working -------------------------------------------------------------------

function Working({ lines }: { lines: { math: string; note: string }[] }) {
  return (
    <ol className="space-y-0.5">
      {lines.map((line, i) => (
        <li key={i}>
          {i > 0 && (
            <div className="flex items-center gap-2 py-0.5 pl-3 text-sm text-da-info">
              <span aria-hidden="true" className="text-base">
                ↓
              </span>
              {line.note.trim() && <MathText src={line.note} />}
            </div>
          )}
          <div className="w-fit max-w-full overflow-x-auto rounded bg-da-surface px-2.5 py-1 text-lg">
            <Tex tex={`\\displaystyle ${line.math}`} />
          </div>
        </li>
      ))}
    </ol>
  );
}

// ---- area model ----------------------------------------------------------------

function AreaModel({ rowHeads, colHeads, cells }: { rowHeads: string[]; colHeads: string[]; cells: string[][] }) {
  return (
    <table className="border-collapse text-lg">
      <thead>
        <tr>
          <th className="px-2 py-1 text-base font-normal text-da-muted">
            <span aria-hidden="true">×</span>
            <span className="sr-only">times</span>
          </th>
          {colHeads.map((h, c) => (
            <th key={c} scope="col" className="border border-da-border bg-da-info/15 px-3 py-2 font-normal">
              <Tex tex={h} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rowHeads.map((h, r) => (
          <tr key={r}>
            <th scope="row" className="border border-da-border bg-da-info/15 px-3 py-2 font-normal">
              <Tex tex={h} />
            </th>
            {colHeads.map((_, c) => (
              <td key={c} className="min-w-16 border border-da-border px-3 py-2 text-center">
                {cells[r]?.[c]?.trim() ? <Tex tex={cells[r][c]} /> : <span className="sr-only">empty</span>}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---- number line ---------------------------------------------------------------

const NL_W = 600;
const NL_H = 120;
const NL_Y = 70;
const NL_PAD = 32;

function Overlay({ x, y, w, h, children, className = "" }: { x: number; y: number; w: number; h: number; children: ReactNode; className?: string }) {
  return (
    <span
      className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap ${className}`}
      style={{ left: `${(x / w) * 100}%`, top: `${(y / h) * 100}%` }}
    >
      {children}
    </span>
  );
}

function NumberLine({ d, label, uid }: { d: Extract<Diagram, { kind: "number_line" }>; label: string; uid: string }) {
  const span = d.max - d.min;
  const X = (v: number) => NL_PAD + ((v - d.min) / span) * (NL_W - 2 * NL_PAD);
  const ticks = stepValues(d.min, d.max, d.step);
  const count = ticks.length - 1;
  const labelEvery = count <= 12 ? 1 : count <= 24 ? 2 : 5;
  const arrow = `nl-arrow-${uid}`;

  return (
    <div className="relative w-full min-w-[260px] max-w-2xl" style={{ aspectRatio: `${NL_W} / ${NL_H}` }}>
      <svg viewBox={`0 0 ${NL_W} ${NL_H}`} className="absolute inset-0 h-full w-full text-da-muted" role="img" aria-label={label}>
        <defs>
          <marker id={arrow} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
          </marker>
        </defs>
        <line x1={8} y1={NL_Y} x2={NL_W - 8} y2={NL_Y} stroke="currentColor" strokeWidth={2} markerStart={`url(#${arrow})`} markerEnd={`url(#${arrow})`} />
        {ticks.map((v, k) => (
          <line key={k} x1={X(v)} y1={NL_Y - 7} x2={X(v)} y2={NL_Y + 7} stroke="currentColor" strokeWidth={1.5} />
        ))}
        {d.ranges.map((r, i) => {
          const from = r.from ?? d.min - d.step * 0.6;
          const to = r.to ?? d.max + d.step * 0.6;
          return (
            <g key={`r${i}`} className="text-da-success">
              <line x1={X(from)} y1={NL_Y} x2={X(to)} y2={NL_Y} stroke="currentColor" strokeWidth={6} strokeLinecap="round" />
              {r.from !== null && <circle cx={X(r.from)} cy={NL_Y} r={7} fill={r.includeFrom ? "currentColor" : "var(--color-da-bg)"} stroke="currentColor" strokeWidth={2.5} />}
              {r.to !== null && <circle cx={X(r.to)} cy={NL_Y} r={7} fill={r.includeTo ? "currentColor" : "var(--color-da-bg)"} stroke="currentColor" strokeWidth={2.5} />}
            </g>
          );
        })}
        {d.jumps.map((j, i) => {
          const x1 = X(j.from);
          const x2 = X(j.to);
          const lift = Math.min(38, 12 + Math.abs(x2 - x1) * 0.35);
          return (
            <path
              key={`j${i}`}
              d={`M ${x1} ${NL_Y - 4} Q ${(x1 + x2) / 2} ${NL_Y - 4 - lift * 2} ${x2} ${NL_Y - 4}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="text-da-info"
              markerEnd={`url(#${arrow})`}
            />
          );
        })}
        {d.points.map((p, i) => (
          <circle
            key={`p${i}`}
            cx={X(p.value)}
            cy={NL_Y}
            r={7}
            className="text-da-warning"
            fill={p.open ? "var(--color-da-bg)" : "currentColor"}
            stroke="currentColor"
            strokeWidth={2.5}
          />
        ))}
      </svg>
      {ticks.map((v, k) =>
        k % labelEvery === 0 || k === count ? (
          <Overlay key={`t${k}`} x={X(v)} y={NL_Y + 22} w={NL_W} h={NL_H} className="text-xs text-da-muted">
            {formatTick(v)}
          </Overlay>
        ) : null,
      )}
      {d.jumps.map((j, i) => {
        const x1 = X(j.from);
        const x2 = X(j.to);
        const lift = Math.min(38, 12 + Math.abs(x2 - x1) * 0.35);
        return j.label.trim() ? (
          <Overlay key={`jl${i}`} x={(x1 + x2) / 2} y={NL_Y - 4 - lift - 8} w={NL_W} h={NL_H} className="text-sm text-da-info">
            <Tex tex={j.label} />
          </Overlay>
        ) : null;
      })}
      {d.points.map((p, i) =>
        p.label.trim() ? (
          <Overlay key={`pl${i}`} x={X(p.value)} y={d.jumps.length > 0 ? NL_Y + 40 : NL_Y - 24} w={NL_W} h={NL_H} className="text-sm font-semibold text-da-warning">
            <Tex tex={p.label} />
          </Overlay>
        ) : null,
      )}
    </div>
  );
}

// ---- bar model -----------------------------------------------------------------

const HATCH = "repeating-linear-gradient(45deg, rgba(124, 196, 255, 0.45) 0 6px, rgba(124, 196, 255, 0.15) 6px 12px)";

function BarModel({ bars }: { bars: Extract<Diagram, { kind: "bar_model" }>["bars"] }) {
  const totals = bars.map((b) => b.segments.reduce((sum, s) => sum + Math.max(0, s.value), 0));
  const widest = Math.max(...totals, 1);
  return (
    <div className="w-full min-w-[220px] max-w-2xl space-y-3">
      {bars.map((bar, b) => (
        <div key={b} className="space-y-1">
          {bar.label.trim() && <MathText src={bar.label} className="block text-sm text-da-muted" />}
          <div className="flex h-11" style={{ width: `${(totals[b] / widest) * 100}%` }}>
            {bar.segments.map((s, i) => (
              <div
                key={i}
                className="flex min-w-0 items-center justify-center overflow-hidden border border-da-info/70 px-1 text-center text-sm leading-tight first:rounded-l-md last:rounded-r-md"
                style={{ width: `${(Math.max(0, s.value) / (totals[b] || 1)) * 100}%`, backgroundImage: s.shaded ? HATCH : undefined }}
              >
                {s.label.trim() && <MathText src={s.label} />}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- table ---------------------------------------------------------------------

function DataTable({ header, rows }: { header: string[]; rows: string[][] }) {
  return (
    <table className="border-collapse text-base">
      <thead>
        <tr>
          {header.map((h, i) => (
            <th key={i} scope="col" className="border border-da-border bg-da-info/15 px-3 py-1.5 text-left font-semibold">
              <MathText src={h} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, r) => (
          <tr key={r} className="odd:bg-da-surface/60">
            {row.map((cell, c) => (
              <td key={c} className="border border-da-border px-3 py-1.5">
                <MathText src={cell} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---- sequence ------------------------------------------------------------------

function Sequence({ terms, jumps }: { terms: string[]; jumps: string[] }) {
  return (
    <ol className="flex flex-wrap items-end gap-y-3">
      {terms.map((t, i) => (
        <li key={i} className="flex items-end">
          <span className="rounded-md border-2 border-da-info/60 bg-da-surface px-3 py-1.5 text-lg">
            <Tex tex={t} />
          </span>
          {i < terms.length - 1 && (
            <span className="flex min-w-10 flex-col items-center px-1 pb-1.5 text-da-info">
              <span className="text-sm">{jumps[i]?.trim() ? <Tex tex={jumps[i]} /> : null}</span>
              <span aria-hidden="true" className="text-xl leading-none">
                →
              </span>
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

// ---- graph ---------------------------------------------------------------------

const G_W = 400;
const G_H = 300;
const CURVE_STYLES = [
  { className: "text-da-info", dash: undefined },
  { className: "text-da-warning", dash: "9 6" },
  { className: "text-da-success", dash: "2 5" },
];

function Graph({ d, label, uid }: { d: Extract<Diagram, { kind: "graph" }>; label: string; uid: string }) {
  const view = { xMin: d.xMin, xMax: d.xMax, yMin: d.yMin, yMax: d.yMax };
  const X = (x: number) => ((x - d.xMin) / (d.xMax - d.xMin)) * G_W;
  const Y = (y: number) => G_H - ((y - d.yMin) / (d.yMax - d.yMin)) * G_H;
  const xTicks = niceTicks(d.xMin, d.xMax, 8);
  const yTicks = niceTicks(d.yMin, d.yMax, 6);
  // The axes cross at the origin when it is in view, else along the edge.
  const axisY = d.yMin <= 0 && d.yMax >= 0 ? Y(0) : G_H;
  const axisX = d.xMin <= 0 && d.xMax >= 0 ? X(0) : 0;
  const clip = `graph-clip-${uid}`;

  const curves = d.curves.flatMap((c, i) => {
    const parsed = parseExpression(c.expr);
    if (!parsed.ok) return [];
    const paths = traceCurve(parsed.expr, view).map((pts) =>
      pts.map((p, k) => `${k === 0 ? "M" : "L"} ${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join(" "),
    );
    return [{ ...CURVE_STYLES[i % CURVE_STYLES.length], d: paths.join(" "), label: c.label }];
  });

  return (
    <div className="w-full min-w-[220px] max-w-md space-y-2">
      <div className="relative w-full" style={{ aspectRatio: `${G_W} / ${G_H}` }}>
        <svg viewBox={`0 0 ${G_W} ${G_H}`} className="absolute inset-0 h-full w-full overflow-visible text-da-muted" role="img" aria-label={label}>
          <defs>
            <clipPath id={clip}>
              <rect x={0} y={0} width={G_W} height={G_H} />
            </clipPath>
          </defs>
          <rect x={0} y={0} width={G_W} height={G_H} fill="none" stroke="currentColor" strokeOpacity={0.35} />
          {xTicks.map((t) => (
            <line key={`gx${t}`} x1={X(t)} y1={0} x2={X(t)} y2={G_H} stroke="currentColor" strokeOpacity={0.15} />
          ))}
          {yTicks.map((t) => (
            <line key={`gy${t}`} x1={0} y1={Y(t)} x2={G_W} y2={Y(t)} stroke="currentColor" strokeOpacity={0.15} />
          ))}
          <line x1={0} y1={axisY} x2={G_W} y2={axisY} stroke="currentColor" strokeWidth={1.5} />
          <line x1={axisX} y1={0} x2={axisX} y2={G_H} stroke="currentColor" strokeWidth={1.5} />
          <g clipPath={`url(#${clip})`}>
            {curves.map((c, i) => (
              <path key={i} d={c.d} fill="none" stroke="currentColor" strokeWidth={2.5} strokeDasharray={c.dash} className={c.className} strokeLinejoin="round" />
            ))}
          </g>
          {d.points.map((p, i) => (
            <circle
              key={`pt${i}`}
              cx={X(p.x)}
              cy={Y(p.y)}
              r={5}
              className="text-da-text"
              fill={p.open ? "var(--color-da-bg)" : "currentColor"}
              stroke="currentColor"
              strokeWidth={2}
            />
          ))}
        </svg>
        {/* A tick on the window's own edge is left unlabelled: its label
            would be cut in half by the frame. */}
        {xTicks.map((t) =>
          (t === 0 && axisX > 0) || X(t) < G_W * 0.03 || X(t) > G_W * 0.97 ? null : (
            <Overlay
              key={`lx${t}`}
              x={X(t)}
              y={Math.min(G_H - 8, axisY + 12)}
              w={G_W}
              h={G_H}
              className="rounded bg-da-bg/70 px-0.5 text-[11px] leading-tight text-da-muted"
            >
              {formatTick(t)}
            </Overlay>
          ),
        )}
        {yTicks.map((t) =>
          t === 0 || Y(t) < G_H * 0.04 || Y(t) > G_H * 0.96 ? null : (
            <Overlay
              key={`ly${t}`}
              x={Math.max(10, axisX - 14)}
              y={Y(t)}
              w={G_W}
              h={G_H}
              className="rounded bg-da-bg/70 px-0.5 text-[11px] leading-tight text-da-muted"
            >
              {formatTick(t)}
            </Overlay>
          ),
        )}
        {d.points.map((p, i) => {
          if (!p.label.trim()) return null;
          // Labels sit up and to the right of their point, or to the left
          // near the right edge, so they stay inside the frame.
          const left = X(p.x) > G_W * 0.7;
          return (
            <span
              key={`pl${i}`}
              className={`pointer-events-none absolute whitespace-nowrap rounded bg-da-bg/80 px-1 text-sm text-da-text ${
                left ? "-translate-x-full -translate-y-full" : "-translate-y-full"
              }`}
              style={{
                left: `calc(${(X(p.x) / G_W) * 100}% ${left ? "- 6px" : "+ 6px"})`,
                top: `calc(${(Y(p.y) / G_H) * 100}% - 4px)`,
              }}
            >
              <Tex tex={p.label} />
            </span>
          );
        })}
      </div>
      {curves.some((c) => c.label.trim()) && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {curves.map((c, i) =>
            c.label.trim() ? (
              <li key={i} className="flex items-center gap-1.5">
                <svg width={28} height={10} aria-hidden="true" className={c.className}>
                  <line x1={0} y1={5} x2={28} y2={5} stroke="currentColor" strokeWidth={2.5} strokeDasharray={c.dash} />
                </svg>
                <Tex tex={c.label} />
              </li>
            ) : null,
          )}
        </ul>
      )}
    </div>
  );
}

// ---- tiles ---------------------------------------------------------------------

const TILE = 18;

function Tiles({ figures, uid }: { figures: Extract<Diagram, { kind: "tiles" }>["figures"]; uid: string }) {
  const hatch = `tiles-new-${uid}`;
  const anyNew = figures.some((f) => f.tiles.some((t) => t.isNew));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
        {figures.map((f, i) => {
          const rows = Math.max(...f.tiles.map((t) => t.row)) + 1;
          const cols = Math.max(...f.tiles.map((t) => t.col)) + 1;
          const added = f.tiles.filter((t) => t.isNew).length;
          return (
            <div key={i} className="flex flex-col items-center gap-1">
              <svg
                width={cols * TILE + 2}
                height={rows * TILE + 2}
                viewBox={`-1 -1 ${cols * TILE + 2} ${rows * TILE + 2}`}
                role="img"
                aria-label={`${f.label}: ${f.tiles.length} tiles${added ? `, ${added} of them new` : ""}`}
              >
                <defs>
                  <pattern id={`${hatch}-${i}`} patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
                    <rect width={6} height={6} fill="rgba(124, 196, 255, 0.25)" />
                    <line x1={0} y1={0} x2={0} y2={6} stroke="#7cc4ff" strokeWidth={2.5} />
                  </pattern>
                </defs>
                {f.tiles.map((t, k) => (
                  <rect
                    key={k}
                    x={t.col * TILE}
                    y={t.row * TILE}
                    width={TILE}
                    height={TILE}
                    fill={t.isNew ? `url(#${hatch}-${i})` : "rgba(201, 177, 184, 0.18)"}
                    stroke={t.isNew ? "#7cc4ff" : "#c9b1b8"}
                    strokeWidth={t.isNew ? 2 : 1.25}
                  />
                ))}
              </svg>
              <span className="text-sm text-da-muted">{f.label}</span>
            </div>
          );
        })}
      </div>
      {anyNew && (
        <p className="flex items-center gap-2 text-sm text-da-muted">
          <svg width={16} height={16} aria-hidden="true">
            <defs>
              <pattern id={`${hatch}-key`} patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
                <rect width={6} height={6} fill="rgba(124, 196, 255, 0.25)" />
                <line x1={0} y1={0} x2={0} y2={6} stroke="#7cc4ff" strokeWidth={2.5} />
              </pattern>
            </defs>
            <rect x={1} y={1} width={14} height={14} fill={`url(#${hatch}-key)`} stroke="#7cc4ff" strokeWidth={2} />
          </svg>
          Striped tiles are the ones added since the figure before.
        </p>
      )}
    </div>
  );
}
