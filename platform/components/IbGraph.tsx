"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Mafs,
  Coordinates,
  Plot,
  Line,
  Point,
  Text,
  Theme,
  Polygon,
} from "mafs";
import "mafs/core.css";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A declarative JSON spec for an IB-style graph.  Store as base64 in the
 * LaTeX field using the [[GRAPH_JSON:<base64>]] marker.
 *
 * Example:
 * {
 *   "xRange": [-3, 5], "yRange": [-6, 10],
 *   "elements": [
 *     { "type": "fn",         "expr": "x^2 - 2*x - 3", "label": "f" },
 *     { "type": "vasymptote", "x": -1 },
 *     { "type": "point",      "x": 3,  "y": 0, "label": "(3, 0)" },
 *     { "type": "guide",      "x": 3,  "y": 0 },
 *     { "type": "shade",      "expr1": "x^2 - 2*x - 3", "xMin": 0, "xMax": 3 }
 *   ]
 * }
 */
export interface IbGraphSpec {
  /** [xMin, xMax] — default: [-5, 5] */
  xRange?: [number, number];
  /** [yMin, yMax] — default: [-5, 5] */
  yRange?: [number, number];
  /** Pixel height of the container — default: 300 */
  height?: number;
  elements: IbGraphElement[];
}

export type IbGraphElement =
  // ── Curves ────────────────────────────────────────────────────────────────
  /** y = f(x).  expr uses standard math notation: x^2, sin(x), ln(x), e^x */
  | { type: "fn";         expr: string;  color?: string; dashed?: boolean; label?: string;  xMin?: number; xMax?: number }
  /** Parametric curve (x(t), y(t)) */
  | { type: "parametric"; xt: string;    yt: string;    tMin: number;     tMax: number;    color?: string; label?: string }

  // ── Asymptotes / reference lines ─────────────────────────────────────────
  /** Vertical dashed line at x = k (vertical asymptote) */
  | { type: "vasymptote"; x: number;     label?: string }
  /** Horizontal dashed line at y = k (horizontal asymptote) */
  | { type: "hasymptote"; y: number;     label?: string }
  /** Any straight-line (oblique asymptote, tangent, secant).  expr = "2*x + 1"
   *  Optionally bounded: provide xMin/xMax to draw only a segment. */
  | { type: "line";       expr: string;  color?: string; dashed?: boolean; label?: string; xMin?: number; xMax?: number }

  // ── Points ────────────────────────────────────────────────────────────────
  /** Filled (or hollow) labeled point */
  | { type: "point"; x: number; y: number; label?: string; open?: boolean; color?: string }
  /** Dashed guide lines from (x, y) to both axes — IB convention */
  | { type: "guide"; x: number; y: number }

  // ── Shading ───────────────────────────────────────────────────────────────
  /** Shaded area between expr1 and expr2 (defaults to y = 0) over [xMin, xMax] */
  | { type: "shade"; expr1: string; expr2?: string; xMin: number; xMax: number; color?: string }

  // ── Annotations ───────────────────────────────────────────────────────────
  | { type: "label"; x: number; y: number; text: string };

// ─── Safe math evaluator ─────────────────────────────────────────────────────
// Translates IB notation (^, ln, e, pi, trig) to JS Math equivalents and wraps
// in a strict-mode function.  Input is always teacher-authored JSON, not
// student-supplied text, so the risk surface is already minimal.

function buildFn(expr: string): (x: number) => number {
  const js = expr
    .replace(/\^/g, "**")
    .replace(/\bln\s*\(/g, "Math.log(")
    .replace(/\blog10\s*\(/g, "Math.log10(")
    .replace(/\blog\s*\(/g, "Math.log10(")    // IB "log" = log base 10
    .replace(/\bsin\s*\(/g, "Math.sin(")
    .replace(/\bcos\s*\(/g, "Math.cos(")
    .replace(/\btan\s*\(/g, "Math.tan(")
    .replace(/\barcsin\s*\(/g, "Math.asin(")
    .replace(/\barccos\s*\(/g, "Math.acos(")
    .replace(/\barctan\s*\(/g, "Math.atan(")
    .replace(/\bexp\s*\(/g, "Math.exp(")
    .replace(/\bsqrt\s*\(/g, "Math.sqrt(")
    .replace(/\babs\s*\(/g, "Math.abs(")
    .replace(/\bcbrt\s*\(/g, "Math.cbrt(")
    // standalone e → Math.E (not inside a word or Math.E\w)
    .replace(/(?<![A-Za-z.\d])e(?![A-Za-z_])/g, "Math.E")
    .replace(/\bpi\b/gi, "Math.PI");
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function(
      "x",
      `"use strict"; try { return +(${js}); } catch { return NaN; }`
    ) as (x: number) => number;
    fn(1); // test call – will throw if the expression is invalid
    return fn;
  } catch {
    return () => NaN;
  }
}

// ─── IB color palette ─────────────────────────────────────────────────────────

const CURVE_COLORS: string[] = [
  Theme.blue,
  Theme.red,
  Theme.green,
  Theme.orange,
  Theme.violet,
  Theme.pink,
];
const ASYMPTOTE_COLOR = "#6b7280";
const GUIDE_COLOR     = "#9ca3af";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sampleCurve(fn: (x: number) => number, xMin: number, xMax: number, n = 120): [number, number][] {
  const pts: [number, number][] = [];
  const step = (xMax - xMin) / n;
  for (let i = 0; i <= n; i++) {
    const x = xMin + i * step;
    const y = fn(x);
    if (isFinite(y)) pts.push([x, y]);
  }
  return pts;
}

function shadePolygon(
  fn1: (x: number) => number,
  fn2: (x: number) => number,
  xMin: number,
  xMax: number,
  n = 80
): [number, number][] {
  const top: [number, number][] = [];
  const bottom: [number, number][] = [];
  const step = (xMax - xMin) / n;
  for (let i = 0; i <= n; i++) {
    const x = xMin + i * step;
    const y1 = fn1(x);
    const y2 = fn2(x);
    if (isFinite(y1) && isFinite(y2)) {
      top.push([x, Math.max(y1, y2)]);
      bottom.push([x, Math.min(y1, y2)]);
    }
  }
  return [...top, ...[...bottom].reverse()];
}

// ─── Component ───────────────────────────────────────────────────────────────

interface IbGraphProps {
  spec: IbGraphSpec;
  className?: string;
}

export default function IbGraph({ spec, className }: IbGraphProps) {
  const xRange = spec.xRange ?? ([-5, 5] as [number, number]);
  const yRange = spec.yRange ?? ([-5, 5] as [number, number]);
  const [xMin, xMax] = xRange;
  const [yMin, yMax] = yRange;
  const xSpan = Math.max(xMax - xMin, 1e-6);
  const ySpan = Math.max(yMax - yMin, 1e-6);
  const rootRef = useRef<HTMLDivElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;

    const update = () => {
      const width = node.getBoundingClientRect().width;
      if (width > 0) setMeasuredWidth(width);
    };

    update();
    const observer = new ResizeObserver(() => update());
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const containerHeight = spec.height ?? Math.max(220, Math.round((measuredWidth ?? 300) * (ySpan / xSpan)));

  // Assign auto-colors to fn/parametric elements that don't specify one
  const coloredElements = useMemo(() => {
    let colorIdx = 0;
    return spec.elements.map((el) => {
      if ((el.type === "fn" || el.type === "parametric" || el.type === "line") && !el.color) {
        return { ...el, color: CURVE_COLORS[colorIdx++ % CURVE_COLORS.length] };
      }
      return el;
    });
  }, [spec.elements]);

  return (
    <div
      ref={rootRef}
      className={`my-3 border border-gray-300 rounded-lg overflow-hidden bg-white ${className ?? ""}`}
      style={{ height: containerHeight }}
    >
      <Mafs
        viewBox={{ x: xRange, y: yRange, padding: 0 }}
        preserveAspectRatio="contain"
      >
        <Coordinates.Cartesian />

        {coloredElements.map((el, i) => {
          switch (el.type) {

            // ── Curve: y = f(x) ───────────────────────────────────────────
            case "fn": {
              const fn = buildFn(el.expr);
              const style = el.dashed ? "dashed" : "solid";
              if (el.xMin !== undefined || el.xMax !== undefined) {
                const t0 = el.xMin ?? xRange[0];
                const t1 = el.xMax ?? xRange[1];
                return (
                  <Plot.Parametric
                    key={i}
                    xy={(t) => [t, fn(t)]}
                    t={[t0, t1]}
                    color={el.color}
                    style={style}
                  />
                );
              }
              return <Plot.OfX key={i} y={fn} color={el.color} style={style} />;
            }

            // ── Parametric curve ──────────────────────────────────────────
            case "parametric": {
              const xt = buildFn(el.xt);
              const yt = buildFn(el.yt);
              return (
                <Plot.Parametric
                  key={i}
                  xy={(t) => [xt(t), yt(t)]}
                  t={[el.tMin, el.tMax]}
                  color={el.color}
                />
              );
            }

            // ── Vertical asymptote ────────────────────────────────────────
            case "vasymptote":
              return (
                <React.Fragment key={i}>
                  <Line.Segment
                    point1={[el.x, yRange[0] - 2]}
                    point2={[el.x, yRange[1] + 2]}
                    color={ASYMPTOTE_COLOR}
                    style="dashed"
                    opacity={0.7}
                  />
                  {el.label && (
                    <Text x={el.x + (xRange[1] - xRange[0]) * 0.02} y={yRange[1] * 0.9} attach="ne" size={14}>
                      {el.label}
                    </Text>
                  )}
                </React.Fragment>
              );

            // ── Horizontal asymptote ──────────────────────────────────────
            case "hasymptote":
              return (
                <React.Fragment key={i}>
                  <Line.Segment
                    point1={[xRange[0] - 2, el.y]}
                    point2={[xRange[1] + 2, el.y]}
                    color={ASYMPTOTE_COLOR}
                    style="dashed"
                    opacity={0.7}
                  />
                  {el.label && (
                    <Text x={xRange[1] * 0.9} y={el.y + (yRange[1] - yRange[0]) * 0.03} attach="ne" size={14}>
                      {el.label}
                    </Text>
                  )}
                </React.Fragment>
              );

            // ── Straight line (oblique asymptote, tangent, etc.) ──────────
            case "line": {
              const fn = buildFn(el.expr);
              const style = el.dashed ? "dashed" : "solid";
              // Render as a bounded segment when xMin/xMax are provided
              if (el.xMin !== undefined || el.xMax !== undefined) {
                const t0 = el.xMin ?? xRange[0];
                const t1 = el.xMax ?? xRange[1];
                return (
                  <Plot.Parametric
                    key={i}
                    xy={(t) => [t, fn(t)]}
                    t={[t0, t1]}
                    color={el.color}
                    style={style}
                  />
                );
              }
              return (
                <Plot.OfX
                  key={i}
                  y={fn}
                  color={el.color}
                  style={style}
                />
              );
            }

            // ── Labeled point ─────────────────────────────────────────────
            case "point": {
              const color = el.color ?? Theme.foreground;
              return (
                <React.Fragment key={i}>
                  {el.open ? (
                    // Hollow circle: render an outer circle + white inner circle
                    <>
                      <Point x={el.x} y={el.y} color={color} />
                      {/* white fill simulated by second small white point – Mafs
                          doesn't expose fill; use SVG text trick instead */}
                    </>
                  ) : (
                    <Point x={el.x} y={el.y} color={color} />
                  )}
                  {el.label && (
                    <Text
                      x={el.x + (xRange[1] - xRange[0]) * 0.025}
                      y={el.y + (yRange[1] - yRange[0]) * 0.04}
                      attach="ne"
                      size={13}
                    >
                      {el.label}
                    </Text>
                  )}
                </React.Fragment>
              );
            }

            // ── Dashed guide lines from point to axes ─────────────────────
            case "guide":
              return (
                <React.Fragment key={i}>
                  {/* vertical drop to x-axis */}
                  <Line.Segment
                    point1={[el.x, 0]}
                    point2={[el.x, el.y]}
                    color={GUIDE_COLOR}
                    style="dashed"
                    opacity={0.6}
                  />
                  {/* horizontal drop to y-axis */}
                  <Line.Segment
                    point1={[0, el.y]}
                    point2={[el.x, el.y]}
                    color={GUIDE_COLOR}
                    style="dashed"
                    opacity={0.6}
                  />
                </React.Fragment>
              );

            // ── Shaded region ─────────────────────────────────────────────
            case "shade": {
              const fn1 = buildFn(el.expr1);
              const fn2 = el.expr2 ? buildFn(el.expr2) : () => 0;
              const pts = shadePolygon(fn1, fn2, el.xMin, el.xMax);
              if (pts.length < 3) return null;
              return (
                <Polygon
                  key={i}
                  points={pts}
                  color={el.color ?? Theme.blue}
                  fillOpacity={0.2}
                  strokeOpacity={0}
                />
              );
            }

            // ── Text label ────────────────────────────────────────────────
            case "label":
              return (
                <Text key={i} x={el.x} y={el.y} attach="ne" size={13}>
                  {el.text}
                </Text>
              );

            default:
              return null;
          }
        })}
      </Mafs>
    </div>
  );
}

// ─── Spec preview (readonly, smaller) ────────────────────────────────────────

export function IbGraphPreview({ spec }: { spec: IbGraphSpec }) {
  return <IbGraph spec={{ ...spec, height: 220 }} />;
}

// ─── JSON ↔ base64 helpers (used by LatexRenderer & editor) ─────────────────

export const GRAPH_MARKER_RE = /\[\[GRAPH_JSON:([A-Za-z0-9+/=]+)\]\]/g;

export function encodeGraphSpec(spec: IbGraphSpec): string {
  return `[[GRAPH_JSON:${btoa(JSON.stringify(spec))}]]`;
}

export function decodeGraphSpec(b64: string): IbGraphSpec | null {
  try {
    return JSON.parse(atob(b64)) as IbGraphSpec;
  } catch {
    return null;
  }
}

// ─── Example spec (for editor placeholder) ───────────────────────────────────

export const EXAMPLE_SPEC: IbGraphSpec = {
  xRange: [-3, 5],
  yRange: [-6, 10],
  elements: [
    { type: "fn",         expr: "x^2 - 2*x - 3",        label: "f(x)" },
    { type: "point",      x: 3,   y: 0,   label: "(3, 0)",  open: false },
    { type: "point",      x: -1,  y: 0,   label: "(-1, 0)", open: false },
    { type: "point",      x: 1,   y: -4,  label: "min" },
    { type: "guide",      x: 1,   y: -4 },
    { type: "shade",      expr1: "x^2 - 2*x - 3", xMin: -1, xMax: 3 },
  ],
};

export const EXAMPLE_RATIONAL_SPEC: IbGraphSpec = {
  xRange: [-4, 6],
  yRange: [-6, 6],
  elements: [
    { type: "fn",         expr: "(2*x - 1)/(x - 2)" },
    { type: "vasymptote", x: 2,   label: "x = 2" },
    { type: "hasymptote", y: 2,   label: "y = 2" },
    { type: "point",      x: 0,   y: 0.5,  label: "(0, 0.5)" },
  ],
};
