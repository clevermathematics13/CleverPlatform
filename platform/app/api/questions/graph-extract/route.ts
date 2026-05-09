/**
 * POST /api/questions/graph-extract
 * Body: { questionId: string }
 *
 * Two-pass graph extraction pipeline:
 *   Pass 1 – Claude vision analyses EVERY graphical element in the question
 *             images and outputs a typed IbGraphSpec JSON + rich metadata.
 *   Pass 2 – Claude reads the existing question & mark-scheme draft LaTeX
 *             alongside the Pass-1 spec and verifies / refines it so key
 *             points, labels and curve equations agree with both the image
 *             and the written question/MS context.
 *
 * Returns:
 *   {
 *     graphSpec: IbGraphSpec,          // refined spec (embed with encodeGraphSpec)
 *     graphMeta: GraphMetadata,        // structured facts useful for mark-scheme
 *     warnings:  string[],             // any detected mismatches
 *     sourceImageBase64: string | null // first question image (for UI comparison)
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";
import { rasterRefineHorizontalSegmentsFromBase64, rasterSnapVerticesFromBase64 } from "@/lib/graph-raster-snap";

export const maxDuration = 180;

// ─── Types ─────────────────────────────────────────────────────────────────────

/** Mirrors IbGraphElement from components/IbGraph.tsx (kept local to avoid a
 *  server-side import of a client component). */
type IbGraphElement =
  | { type: "fn";         expr: string;  color?: string; dashed?: boolean; label?: string;  xMin?: number; xMax?: number }
  | { type: "parametric"; xt: string;    yt: string;    tMin: number;     tMax: number;    color?: string; label?: string }
  | { type: "vasymptote"; x: number;     label?: string }
  | { type: "hasymptote"; y: number;     label?: string }
  | { type: "line";       expr: string;  color?: string; dashed?: boolean; label?: string; xMin?: number; xMax?: number }
  | { type: "point"; x: number; y: number; label?: string; open?: boolean; color?: string }
  | { type: "guide"; x: number; y: number }
  | { type: "shade"; expr1: string; expr2?: string; xMin: number; xMax: number; color?: string }
  | { type: "label"; x: number; y: number; text: string };

interface IbGraphSpec {
  xRange?: [number, number];
  yRange?: [number, number];
  height?: number;
  elements: IbGraphElement[];
}

interface GraphMetadata {
  /** Human-readable description of what the graph shows */
  description: string;
  /** Equation(s) of the curve(s) as written in the question */
  equations: string[];
  /** x-intercepts / roots */
  xIntercepts: Array<{ x: number; label?: string }>;
  /** y-intercepts */
  yIntercepts: Array<{ y: number; label?: string }>;
  /** Vertical asymptotes */
  verticalAsymptotes: number[];
  /** Horizontal / oblique asymptotes (expressions) */
  horizontalAsymptotes: string[];
  /** Key labeled points beyond intercepts */
  keyPoints: Array<{ x: number; y: number; label?: string }>;
  /** Visible domain that the curve is drawn over */
  domain?: [number, number];
  /** Mark-scheme relevant facts (maxima, minima, inflections …) */
  markschemeHints: string[];
}

// ─── System prompt for graph extraction ────────────────────────────────────────

const GRAPH_EXTRACT_SYSTEM = `You are an expert IB Mathematics examiner and TikZ/Mafs graph specialist.
When given an image of an IB exam graph, you extract EVERY visual element with mathematical precision
and encode it in the IbGraphSpec JSON format used by the Mafs react library.

IbGraphSpec element types and their required fields:
  { "type": "fn",         "expr": "<y=f(x) expression>", "label": "f", "color": "#hex", "xMin": <n>, "xMax": <n> }
  { "type": "parametric", "xt": "<x(t)>", "yt": "<y(t)>", "tMin": 0, "tMax": 6.28 }
  { "type": "vasymptote", "x": <number>,  "label": "x=k" }
  { "type": "hasymptote", "y": <number>,  "label": "y=k" }
  { "type": "line",       "expr": "<slope*x+intercept>", "dashed": false, "xMin": <n>, "xMax": <n>, "color": "#hex" }
  { "type": "point",      "x": <n>, "y": <n>, "label": "(a,b)", "open": false }
  { "type": "guide",      "x": <n>, "y": <n> }
  { "type": "shade",      "expr1": "<upper fn>", "expr2": "<lower fn or 0>", "xMin": <n>, "xMax": <n> }
  { "type": "label",      "x": <n>, "y": <n>, "text": "A" }

Expression syntax (JavaScript Math-compatible):
  Use ^ for powers (x^2), ln(x), log(x) [=log10], sin(x), cos(x), tan(x),
  arcsin(x), arccos(x), arctan(x), sqrt(x), abs(x), exp(x), e (Euler's number).

**CRITICAL GRAPHING INSTRUCTIONS:**
When converting an image of a piecewise graph into JSON, you must follow this exact sequence to ensure mathematical precision:

STEP 0: Calibrate the grid first.
- Identify axis lines and at least two labeled ticks on each axis.
- Infer numeric spacing of adjacent major grid lines from those labels.
- Treat labeled grid intersections as authoritative anchors.
- Prefer integer coordinates when a vertex lies on a labeled intersection.
- Use half/quarter coordinates only when the vertex is clearly centered between adjacent grid lines.

STEP 1: Extract vertices.
- Identify the exact (x, y) coordinates of every endpoint and every corner/vertex where the graph changes direction.
- Snap these coordinates to the visible grid lines.
- Record these vertices in graphMeta.keyPoints and as point elements when they are visible endpoints/corners.

STEP 2: Map domains.
- For each adjacent pair of vertices, define the strict domain of that segment with xMin and xMax.

STEP 3: Calculate equations.
- Calculate the slope m from each adjacent pair of vertices.
- Derive the exact segment equation from those vertices.
- Prefer exact integers or simple fractions.

STEP 4: Verify continuity.
- Unless the image clearly shows an open circle or jump discontinuity, the output of segment A at xMax must equal the output of segment B at xMin.
- Do not guess visually; compute from the snapped vertices.

**CRITICAL for piecewise functions:**
- DO NOT condense multiple segments into a single "fn" expression with nested ternaries.
- Instead, emit ONE "line" or "fn" element PER VISUALLY DISTINCT SEGMENT.
- Each segment must specify xMin and xMax to define its domain.
- For straight-line segments, prefer "line" elements computed from adjacent vertex pairs.
- Horizontal and vertical placement must come from snapped grid coordinates, not visual estimation of slope.
- Never invent new vertex positions during repair unless the image clearly contradicts the current vertex list.

Other rules:
- Always include xRange and yRange that tightly fit the visible graph.
- For every x-intercept, y-intercept, local max/min or labeled point add a "point" element.
- For every labeled point that should have dashed guide lines to the axes, add a "guide" element too.
- For every labeled coordinate or letter add a "label" element slightly offset.
- For shaded regions add a "shade" element.
- Prefer exact integer or simple fraction coordinates where readable from the image.
- Colors: use CSS hex. Default curve color #2563eb (blue). Asymptotes are gray (#6b7280).

Return ONLY valid JSON with this exact shape (no markdown, no explanation):
{
  "graphSpec": { <IbGraphSpec> },
  "graphMeta": {
    "description": "<one sentence>",
    "equations": ["<equation strings as LaTeX>"],
    "xIntercepts": [{"x": <n>, "label": "(<n>,0)"}],
    "yIntercepts": [{"y": <n>, "label": "(0,<n>)"}],
    "verticalAsymptotes": [<n>],
    "horizontalAsymptotes": ["<expr>"],
    "keyPoints": [{"x":<n>,"y":<n>,"label":""}],
    "domain": [<xMin>,<xMax>],
    "markschemeHints": ["<fact 1>","<fact 2>"]
  }
}`;

const GRAPH_VERIFY_SYSTEM = `You are an expert IB Mathematics examiner.
You will be given:
  1. An IbGraphSpec JSON produced by analysing the source image.
  2. The question's LaTeX text.
  3. The mark-scheme LaTeX text.

Your job is to CHECK the spec for consistency with the written question/MS and REFINE it where
necessary. In particular:
  - Calibrate grid spacing from labeled ticks before reading coordinates.
  - Prefer integer lattice coordinates when points sit on labeled intersections.
  - Use half/quarter coordinates only when visibly centered between adjacent grid lines.
  - Reconstruct the ordered list of visible vertices/endpoints from the image and verify each segment against them.
  - Check that every straight-line segment's xMin/xMax matches the interval between adjacent vertices.
  - Recalculate each segment equation from its vertex pair instead of trusting a visually guessed slope.
  - Verify continuity at shared endpoints unless the image shows an open circle or jump.
  - Correct any curve expression that does not match the written function in the question.
  - Add or correct intercept / asymptote values that appear in the MS.
  - Add any key points (maxima, minima, inflections) mentioned in the MS.
  - Ensure all labels exactly match the question wording.
  - Do NOT remove elements visible in the image unless clearly erroneous.
  - Return any discrepancies as short "warnings" strings.

Return ONLY valid JSON (no markdown, no explanation):
{
  "graphSpec": { <refined IbGraphSpec — FULL spec, not a diff> },
  "graphMeta": { <refined GraphMetadata> },
  "warnings":  ["<warning 1>", ...]
}`;

const GRAPH_VERTEX_AUDIT_SYSTEM = `You are an IB graph coordinate auditor.
Your only job is to read vertex coordinates from the image as accurately as possible.

Rules:
- Calibrate axis/grid spacing from labeled ticks before reading coordinates.
- Prefer integer coordinates when points lie on labeled intersections.
- Use half/quarter values only when clearly centered between adjacent grid lines.
- Return only endpoints/corners where slope changes (true piecewise vertices).
- Do not include helper/intercept points unless they are also endpoints/corners.
- Do not infer equations; only return ordered vertices.
- Return vertices in strictly increasing x-order.
- For function graphs, return at most one y-value per x unless a clear open/closed jump marker is visible.
- Include confidence in [0,1] for each vertex.

Return ONLY valid JSON (no markdown):
{
  "vertices": [{"x": number, "y": number, "confidence": number}],
  "notes": ["..."]
}`;

// ─── Helpers ───────────────────────────────────────────────────────────────────

function safeParseJson(text: string): unknown {
  // Strip markdown fences if Claude accidentally wraps the JSON
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1].trim() : text.trim();
  return JSON.parse(raw);
}

interface ContinuityCheckResult {
  isValid: boolean;
  errors: string[];
}

interface VertexPoint {
  x: number;
  y: number;
}

interface AuditedVertex extends VertexPoint {
  confidence?: number;
}

function toJsExpr(expr: string): string {
  return expr
    .replace(/\^/g, "**")
    .replace(/\bln\s*\(/g, "Math.log(")
    .replace(/\blog10\s*\(/g, "Math.log10(")
    .replace(/\blog\s*\(/g, "Math.log10(")
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
    .replace(/(?<![A-Za-z.\d])e(?![A-Za-z_])/g, "Math.E")
    .replace(/\bpi\b/gi, "Math.PI");
}

function evaluateAtX(expr: string, x: number): number | null {
  try {
    const js = toJsExpr(expr);
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function("x", `"use strict"; return +(${js});`) as (x: number) => number;
    const y = fn(x);
    return Number.isFinite(y) ? y : null;
  } catch {
    return null;
  }
}

function validateContinuity(spec: IbGraphSpec, tolerance = 0.01): ContinuityCheckResult {
  const errors: string[] = [];
  const segs = spec.elements
    .filter((el): el is Extract<IbGraphElement, { type: "line" | "fn" }> => el.type === "line" || el.type === "fn")
    .filter((el) => typeof el.xMin === "number" && typeof el.xMax === "number")
    .sort((a, b) => (a.xMin as number) - (b.xMin as number));

  for (const s of segs) {
    const xMin = s.xMin as number;
    const xMax = s.xMax as number;
    if (!(xMin < xMax)) {
      errors.push(`Invalid domain for '${s.expr}': xMin=${xMin}, xMax=${xMax}`);
    }
  }

  for (let i = 0; i < segs.length - 1; i++) {
    const a = segs[i];
    const b = segs[i + 1];
    const axMax = a.xMax as number;
    const bxMin = b.xMin as number;

    if (bxMin < axMax - tolerance) {
      errors.push(
        `Domain overlap between '${a.expr}' [${a.xMin}, ${a.xMax}] and '${b.expr}' [${b.xMin}, ${b.xMax}]`
      );
      continue;
    }

    if (Math.abs(axMax - bxMin) <= tolerance) {
      const yA = evaluateAtX(a.expr, axMax);
      const yB = evaluateAtX(b.expr, bxMin);
      if (yA === null || yB === null) {
        errors.push(`Expression evaluation failed at boundary x=${axMax} ('${a.expr}' vs '${b.expr}').`);
        continue;
      }
      if (Math.abs(yA - yB) > tolerance) {
        errors.push(
          `Continuity error at x=${axMax}: left '${a.expr}' => ${yA.toFixed(6)}, right '${b.expr}' => ${yB.toFixed(6)}`
        );
      }
    }
  }

  return { isValid: errors.length === 0, errors };
}

function approxEqual(a: number, b: number, tol = 0.01): boolean {
  return Math.abs(a - b) <= tol;
}

function formatNum(n: number): string {
  if (Math.abs(n) < 1e-10) return "0";
  const rounded = Math.round(n * 1000000) / 1000000;
  const s = rounded.toString();
  return s.includes(".") ? s.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1") : s;
}

function lineExprFromPoints(a: VertexPoint, b: VertexPoint): string {
  const dx = b.x - a.x;
  if (Math.abs(dx) < 1e-10) return formatNum(a.y);

  const m = (b.y - a.y) / dx;
  const c = a.y - m * a.x;

  if (Math.abs(m) < 1e-10) return formatNum(a.y);

  const mPart = approxEqual(Math.abs(m), 1, 1e-10)
    ? (m < 0 ? "-x" : "x")
    : `${formatNum(m)}*x`;

  if (Math.abs(c) < 1e-10) return mPart;
  return `${mPart} ${c > 0 ? "+" : "-"} ${formatNum(Math.abs(c))}`;
}

function normalizeLineDomains(spec: IbGraphSpec): IbGraphSpec {
  return {
    ...spec,
    elements: spec.elements.map((el) => {
      if (
        (el.type === "line" || el.type === "fn") &&
        typeof el.xMin === "number" &&
        typeof el.xMax === "number" &&
        el.xMin > el.xMax
      ) {
        return { ...el, xMin: el.xMax, xMax: el.xMin };
      }
      return el;
    }),
  };
}

function sanitizeAuditedVertices(vertices: AuditedVertex[]): AuditedVertex[] {
  if (vertices.length <= 2) return vertices;

  const bestByX = new Map<number, AuditedVertex>();
  for (const v of vertices) {
    const existing = bestByX.get(v.x);
    const conf = typeof v.confidence === "number" ? v.confidence : 0.5;
    const existingConf = typeof existing?.confidence === "number" ? existing.confidence : 0.5;
    if (!existing || conf > existingConf) bestByX.set(v.x, v);
  }

  const unique = Array.from(bestByX.values()).sort((a, b) => a.x - b.x);
  if (unique.length <= 2) return unique;

  const filtered: AuditedVertex[] = [unique[0]];
  for (let i = 1; i < unique.length - 1; i++) {
    const prev = filtered[filtered.length - 1];
    const cur = unique[i];
    const next = unique[i + 1];
    const cross = (cur.x - prev.x) * (next.y - prev.y) - (cur.y - prev.y) * (next.x - prev.x);
    if (Math.abs(cross) <= 1e-6) continue;
    filtered.push(cur);
  }
  filtered.push(unique[unique.length - 1]);
  return filtered;
}

function uniqueSorted(nums: number[], tol = 1e-6): number[] {
  const sorted = [...nums].sort((a, b) => a - b);
  const out: number[] = [];
  for (const n of sorted) {
    if (out.length === 0 || Math.abs(n - out[out.length - 1]) > tol) out.push(n);
  }
  return out;
}

function collectLockedBreakpoints(...specs: IbGraphSpec[]): number[] {
  const xs: number[] = [];
  for (const spec of specs) {
    for (const el of spec.elements) {
      if ((el.type === "line" || el.type === "fn") && typeof el.xMin === "number" && typeof el.xMax === "number") {
        xs.push(el.xMin, el.xMax);
      }
    }
  }
  return uniqueSorted(xs);
}

function findRepresentativePointY(
  points: VertexPoint[],
  xTarget: number,
  intervalLeft: number | null,
  intervalRight: number | null
): number | null {
  const exact = points.filter((p) => Math.abs(p.x - xTarget) <= 1e-6);
  if (exact.length > 0) {
    const ys = exact.map((p) => p.y).sort((a, b) => a - b);
    return ys[Math.floor(ys.length / 2)];
  }

  if (intervalLeft !== null && intervalRight !== null) {
    const inside = points.filter((p) => p.x >= intervalLeft - 1e-6 && p.x <= intervalRight + 1e-6);
    if (inside.length > 0) {
      const nearest = inside.reduce((best, p) =>
        Math.abs(p.x - xTarget) < Math.abs(best.x - xTarget) ? p : best
      );
      return nearest.y;
    }
  }

  return null;
}

function deterministicPiecewiseRepair(spec: IbGraphSpec, lockedBreakpoints: number[]): IbGraphSpec | null {
  const lineCount = spec.elements.filter((e) => e.type === "line").length;
  const hasFnLike = spec.elements.some((e) => e.type === "fn" || e.type === "parametric");
  if (lineCount < 2 || hasFnLike) return null;

  const rawPoints = spec.elements
    .filter((e): e is Extract<IbGraphElement, { type: "point" }> => e.type === "point")
    .map((p) => ({ x: p.x, y: p.y }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

  if (rawPoints.length < 2) return null;

  const lineSegments = spec.elements
    .filter((e): e is Extract<IbGraphElement, { type: "line" | "fn" }> => (e.type === "line" || e.type === "fn") && typeof e.xMin === "number" && typeof e.xMax === "number")
    .sort((a, b) => (a.xMin as number) - (b.xMin as number));

  const fallbackBreakpoints = uniqueSorted(rawPoints.map((p) => p.x));
  const breakpoints = lockedBreakpoints.length >= 2 ? lockedBreakpoints : fallbackBreakpoints;
  if (breakpoints.length < 2) return null;

  const vertices: VertexPoint[] = [];
  for (let i = 0; i < breakpoints.length; i++) {
    const x = breakpoints[i];
    const left = i > 0 ? breakpoints[i - 1] : null;
    const right = i < breakpoints.length - 1 ? breakpoints[i + 1] : null;
    let y = findRepresentativePointY(rawPoints, x, left, right);

    if (y === null) {
      const seg = lineSegments.find((s) => {
        const xMin = s.xMin as number;
        const xMax = s.xMax as number;
        return x >= xMin - 1e-6 && x <= xMax + 1e-6;
      });
      if (seg) y = evaluateAtX(seg.expr, x);
    }

    if (typeof y === "number" && Number.isFinite(y)) {
      vertices.push({ x, y });
    }
  }

  if (vertices.length < 2) return null;

  const templateLine = spec.elements.find((e): e is Extract<IbGraphElement, { type: "line" }> => e.type === "line");

  const rebuilt: Extract<IbGraphElement, { type: "line" }>[] = [];
  for (let i = 0; i < vertices.length - 1; i++) {
    const a = vertices[i];
    const b = vertices[i + 1];
    if (b.x <= a.x) continue;
    const expr = lineExprFromPoints(a, b);
    if (!expr) continue;

    rebuilt.push({
      type: "line",
      expr,
      xMin: a.x,
      xMax: b.x,
      dashed: templateLine?.dashed,
      color: templateLine?.color,
    });
  }

  if (rebuilt.length < 1) return null;

  const nonLineElements = spec.elements.filter((e) => e.type !== "line");
  return {
    ...spec,
    elements: [...rebuilt, ...nonLineElements],
  };
}

function generateImprovementFeedback(spec: IbGraphSpec, graphMeta: GraphMetadata, warnings: string[]): string[] {
  const feedback: string[] = [];

  feedback.push("Re-check every vertex against the source grid and confirm each segment's xMin/xMax exactly matches adjacent snapped vertices.");

  const segments = spec.elements.filter(
    (el): el is Extract<IbGraphElement, { type: "line" | "fn" }> => el.type === "line" || el.type === "fn"
  );
  const unboundedSegments = segments.filter((s) => typeof s.xMin !== "number" || typeof s.xMax !== "number");
  if (unboundedSegments.length > 0) {
    feedback.push("Add explicit xMin/xMax bounds for all visible segments so the rendered graph cannot bleed into neighboring intervals.");
  }

  const pointCount = spec.elements.filter((el) => el.type === "point").length;
  const keyPointCount = Array.isArray(graphMeta.keyPoints) ? graphMeta.keyPoints.length : 0;
  if (keyPointCount > pointCount) {
    feedback.push("Promote key points from graphMeta.keyPoints into explicit point elements to make breakpoints/intercepts visually auditable.");
  } else if (pointCount === 0) {
    feedback.push("Add explicit point elements for endpoints, intercepts, and turning points to tighten visual verification.");
  }

  if (!Array.isArray(spec.xRange) || !Array.isArray(spec.yRange)) {
    feedback.push("Set both xRange and yRange to tight visible bounds so scaling does not hide slope or intercept errors.");
  }

  if (warnings.length > 0) {
    feedback.push("Resolve verification warnings first; then run a second extraction pass and compare segment-by-segment against the image.");
  } else {
    feedback.push("Even without warnings, do a manual continuity audit at each shared boundary x-value and confirm left/right evaluations match.");
  }

  return Array.from(new Set(feedback));
}

function dedupeByKey<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = keyFn(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

function regenerateGraphMetaFromSpec(spec: IbGraphSpec, previous: GraphMetadata): GraphMetadata {
  const bounded = spec.elements
    .filter((el): el is Extract<IbGraphElement, { type: "line" | "fn" }> =>
      (el.type === "line" || el.type === "fn") && typeof el.xMin === "number" && typeof el.xMax === "number"
    )
    .sort((a, b) => (a.xMin as number) - (b.xMin as number));

  const equations = bounded.map((s) => {
    const a = s.xMin as number;
    const b = s.xMax as number;
    return `y = ${s.expr}, ${a} <= x <= ${b}`;
  });

  const explicitPoints = spec.elements
    .filter((el): el is Extract<IbGraphElement, { type: "point" }> => el.type === "point")
    .map((p) => ({ x: p.x, y: p.y, label: p.label }));

  const endpointPoints = bounded.flatMap((s) => {
    const a = s.xMin as number;
    const b = s.xMax as number;
    const ya = evaluateAtX(s.expr, a);
    const yb = evaluateAtX(s.expr, b);
    return [
      ya === null ? null : { x: a, y: ya, label: "" },
      yb === null ? null : { x: b, y: yb, label: "" },
    ].filter((p): p is { x: number; y: number; label: string } => p !== null);
  });

  const keyPoints = dedupeByKey([...explicitPoints, ...endpointPoints], (p) => `${p.x.toFixed(6)}|${p.y.toFixed(6)}`)
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .map((p) => ({ x: Number(p.x.toFixed(6)), y: Number(p.y.toFixed(6)), label: p.label ?? "" }));

  const domainMin = bounded.length > 0 ? Math.min(...bounded.map((s) => s.xMin as number)) : undefined;
  const domainMax = bounded.length > 0 ? Math.max(...bounded.map((s) => s.xMax as number)) : undefined;

  const yIntercepts = bounded
    .filter((s) => (s.xMin as number) <= 0 && 0 <= (s.xMax as number))
    .map((s) => evaluateAtX(s.expr, 0))
    .filter((y): y is number => y !== null && Number.isFinite(y))
    .map((y) => ({ y: Number(y.toFixed(6)), label: `(0,${Number(y.toFixed(6))})` }));
  const uniqueYIntercepts = dedupeByKey(yIntercepts, (p) => p.y.toFixed(6));

  const xInterceptsRaw: Array<{ x: number; label?: string }> = [];
  for (const s of bounded) {
    const a = s.xMin as number;
    const b = s.xMax as number;
    const ya = evaluateAtX(s.expr, a);
    const yb = evaluateAtX(s.expr, b);
    if (ya === null || yb === null) continue;
    if (Math.abs(ya) <= 1e-8) xInterceptsRaw.push({ x: Number(a.toFixed(6)), label: `(${Number(a.toFixed(6))},0)` });
    if (Math.abs(yb) <= 1e-8) xInterceptsRaw.push({ x: Number(b.toFixed(6)), label: `(${Number(b.toFixed(6))},0)` });
    if (ya * yb < 0 && Math.abs(yb - ya) > 1e-8) {
      const x0 = a + ((0 - ya) * (b - a)) / (yb - ya);
      xInterceptsRaw.push({ x: Number(x0.toFixed(6)), label: `(${Number(x0.toFixed(6))},0)` });
    }
  }
  const xIntercepts = dedupeByKey(xInterceptsRaw, (p) => p.x.toFixed(6)).sort((a, b) => a.x - b.x);

  const markschemeHints: string[] = [];
  if (bounded.length > 0) markschemeHints.push(`Piecewise linear reconstruction with ${bounded.length} segment(s).`);
  if (typeof domainMin === "number" && typeof domainMax === "number") markschemeHints.push(`Domain is [${domainMin}, ${domainMax}].`);
  if (xIntercepts.length > 0) markschemeHints.push(`Detected x-intercept(s): ${xIntercepts.map((p) => p.x).join(", ")}.`);
  if (uniqueYIntercepts.length > 0) markschemeHints.push(`Detected y-intercept(s): ${uniqueYIntercepts.map((p) => p.y).join(", ")}.`);

  return {
    description: `Graph reconstructed from ${bounded.length} bounded segment(s).`,
    equations,
    xIntercepts,
    yIntercepts: uniqueYIntercepts,
    verticalAsymptotes: previous.verticalAsymptotes ?? [],
    horizontalAsymptotes: previous.horizontalAsymptotes ?? [],
    keyPoints,
    domain: typeof domainMin === "number" && typeof domainMax === "number" ? [domainMin, domainMax] : previous.domain,
    markschemeHints,
  };
}

// ─── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "teacher")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await request.json()) as { questionId: string };
  const { questionId } = body;
  if (!questionId)
    return NextResponse.json({ error: "questionId is required" }, { status: 400 });

  // ── 1. Fetch question images ─────────────────────────────────────────────
  const { data: imgRows, error: imgErr } = await supabase
    .from("question_images")
    .select("id, storage_path, sort_order, image_type")
    .eq("question_id", questionId)
    .order("sort_order");

  if (imgErr) return NextResponse.json({ error: imgErr.message }, { status: 500 });

  const questionImgRows = (imgRows ?? []).filter((r) => r.image_type === "question");
  if (questionImgRows.length === 0)
    return NextResponse.json(
      { error: "No question images found. Please extract question images first." },
      { status: 404 }
    );

  // Download and base64-encode all question images
  const base64Images: string[] = [];
  let firstImageBase64: string | null = null;

  for (const img of questionImgRows) {
    const { data: signed, error: signErr } = await supabase.storage
      .from("question-images")
      .createSignedUrl(img.storage_path, 300);
    if (signErr || !signed?.signedUrl)
      return NextResponse.json({ error: `Failed to sign URL for ${img.storage_path}` }, { status: 500 });

    const res = await fetch(signed.signedUrl);
    if (!res.ok)
      return NextResponse.json({ error: `Failed to download image: ${res.status}` }, { status: 502 });

    const buf = await res.arrayBuffer();
    const b64 = Buffer.from(buf).toString("base64");
    base64Images.push(b64);
    if (!firstImageBase64) firstImageBase64 = b64;
  }

  // ── 2. Fetch existing draft LaTeX for context ────────────────────────────
  const { data: qRow } = await supabase
    .from("ib_questions")
    .select("parts_draft_latex, parts_draft_markscheme_latex, stem_latex, stem_markscheme_latex, code")
    .eq("id", questionId)
    .single();

  const questionLatex = [qRow?.stem_latex ?? "", qRow?.parts_draft_latex ?? ""].filter(Boolean).join("\n\n").trim();
  const msLatex = [qRow?.stem_markscheme_latex ?? "", qRow?.parts_draft_markscheme_latex ?? ""].filter(Boolean).join("\n\n").trim();

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // ── 3. Pass 1 — visual graph extraction ─────────────────────────────────
  const imageContent = base64Images.map((b64) => ({
    type: "image" as const,
    source: { type: "base64" as const, media_type: "image/png" as const, data: b64 },
  }));

  const pass1Response = await anthropic.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 4096,
    system: GRAPH_EXTRACT_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          ...imageContent,
          {
            type: "text",
            text: `Analyse the graph(s) in ${questionImgRows.length === 1 ? "this image" : "these images"} of an IB Mathematics exam question.
Extract EVERY visible graphical element with full precision and return the structured JSON as described in the system prompt.
Be thorough: include all curves, asymptotes, intercepts, labeled points, guide lines, shaded regions, and annotations.`,
          },
        ],
      },
    ],
  });

  const pass1Text = pass1Response.content[0].type === "text" ? pass1Response.content[0].text : "";

  let graphSpec: IbGraphSpec;
  let graphMeta: GraphMetadata;
  let warnings: string[] = [];

  try {
    const parsed = safeParseJson(pass1Text) as { graphSpec: IbGraphSpec; graphMeta: GraphMetadata };
    graphSpec = parsed.graphSpec;
    graphMeta = parsed.graphMeta;
  } catch {
    return NextResponse.json(
      { error: "Pass 1 JSON parse failed", raw: pass1Text.slice(0, 500) },
      { status: 500 }
    );
  }

  const pass1Spec = graphSpec;

  // ── 4. Pass 2 — verify against question + MS text ──────────────────────
  if (questionLatex || msLatex) {
    const contextSections: string[] = [];
    if (questionLatex) contextSections.push(`=== Question LaTeX ===\n${questionLatex}`);
    if (msLatex) contextSections.push(`=== Mark Scheme LaTeX ===\n${msLatex}`);

    try {
      const pass2Response = await anthropic.messages.create({
        model: "claude-opus-4-5",
        max_tokens: 4096,
        system: GRAPH_VERIFY_SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              // Include the images again so Claude can re-confirm against the original
              ...imageContent,
              {
                type: "text",
                text: `=== IbGraphSpec from image analysis (Pass 1) ===
${JSON.stringify({ graphSpec, graphMeta }, null, 2)}

${contextSections.join("\n\n")}

Cross-check the spec against the written question and mark scheme.
Refine any incorrect or incomplete elements, add any missing key points or annotations,
and list any warnings about discrepancies.`,
              },
            ],
          },
        ],
      });

      const pass2Text = pass2Response.content[0].type === "text" ? pass2Response.content[0].text : "";
      try {
        const refined = safeParseJson(pass2Text) as {
          graphSpec: IbGraphSpec;
          graphMeta: GraphMetadata;
          warnings: string[];
        };
        if (refined.graphSpec?.elements?.length) graphSpec = refined.graphSpec;
        if (refined.graphMeta) graphMeta = refined.graphMeta;
        if (Array.isArray(refined.warnings)) warnings.push(...refined.warnings);
      } catch {
        // Pass 2 parse error is non-fatal; keep Pass 1 result
        warnings.push("Pass 2 verification JSON parse failed — using Pass 1 result.");
      }
    } catch (e) {
      warnings.push(`Pass 2 verification error: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    warnings.push("No existing question/MS LaTeX found — skipped Pass 2 verification. Run OCR extraction first for best results.");
  }

  // ── 5. Automatic continuity gate + self-repair ────────────────────────
  // 5a) Optional vertex audit pass to improve coordinate accuracy
  let usedAuditedVertices = false;
  let rasterSnapApplied = false;
  let auditNormalizationRemoved = 0;
  let auditAverageConfidence: number | null = null;
  try {
    const auditResponse = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 1024,
      system: GRAPH_VERTEX_AUDIT_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            ...imageContent,
            {
              type: "text",
              text: "Extract the ordered list of piecewise graph vertices from left to right with confidence values.",
            },
          ],
        },
      ],
    });

    const auditRaw = auditResponse.content[0].type === "text" ? auditResponse.content[0].text : "";
    const audit = safeParseJson(auditRaw) as {
      vertices?: Array<{ x: number; y: number; confidence?: number }>;
      notes?: string[];
    };

    const rawAuditedVertices = (audit.vertices ?? [])
      .filter((v) => Number.isFinite(v?.x) && Number.isFinite(v?.y))
      .sort((a, b) => a.x - b.x);

    if (rawAuditedVertices.length >= 2) {
      const avgConfidence = rawAuditedVertices.reduce((s, v) => s + (typeof v.confidence === "number" ? v.confidence : 0.5), 0) / rawAuditedVertices.length;
      if (avgConfidence >= 0.75) {
        const existingVertices: AuditedVertex[] = graphSpec.elements
          .filter((e): e is Extract<IbGraphElement, { type: "point" }> => e.type === "point")
          .map((p) => ({ x: p.x, y: p.y, confidence: 0.55 }));

        let mergedVertices: AuditedVertex[] = [...existingVertices, ...rawAuditedVertices];
        try {
          const raster = await rasterSnapVerticesFromBase64(base64Images[0], mergedVertices);
          if (raster?.applied && raster.vertices.length === mergedVertices.length) {
            mergedVertices = raster.vertices;
            rasterSnapApplied = true;
            warnings.push("Applied raster y-level snap from source image.");
            warnings.push(...raster.diagnostics.map((d) => `Raster diagnostics: ${d}`));
          } else {
            if (raster?.diagnostics?.length) {
              warnings.push(...raster.diagnostics.map((d) => `Raster diagnostics: ${d}`));
            }
            warnings.push("Raster y-level snap unavailable or rejected; using vision-derived vertices.");
          }
        } catch (e) {
          warnings.push(`Raster y-level snap failed: ${e instanceof Error ? e.message : String(e)}`);
        }

        const auditedVertices = sanitizeAuditedVertices(mergedVertices);
        const nonPoint = graphSpec.elements.filter((e) => e.type !== "point");
        const auditedPoints = auditedVertices.map((v) => ({
          type: "point" as const,
          x: v.x,
          y: v.y,
          label: "",
          open: false,
        }));
        graphSpec = {
          ...graphSpec,
          elements: [...nonPoint, ...auditedPoints],
        };

        const gm = graphMeta as GraphMetadata & { keyPoints?: Array<{ x: number; y: number; label?: string }> };
        gm.keyPoints = auditedVertices.map((v) => ({ x: v.x, y: v.y, label: "" }));
        graphMeta = gm;
        usedAuditedVertices = true;

        warnings.push(`Applied vertex-audit calibration (avg confidence ${avgConfidence.toFixed(2)}).`);
        auditAverageConfidence = avgConfidence;
        const combinedCount = existingVertices.length + rawAuditedVertices.length;
        if (combinedCount > auditedVertices.length) {
          auditNormalizationRemoved = combinedCount - auditedVertices.length;
          warnings.push(`Vertex-audit normalization removed ${auditNormalizationRemoved} ambiguous/interior point(s).`);
        }
      } else {
        warnings.push(`Vertex-audit confidence low (${avgConfidence.toFixed(2)}); kept existing vertices.`);
      }
    }
  } catch {
    warnings.push("Vertex-audit pass failed; continuing with existing vertices.");
  }

  const MAX_REPAIR_ATTEMPTS = 2;
  let continuity = validateContinuity(graphSpec);
  let attempt = 0;

  // Try deterministic repair from point vertices BEFORE expensive LLM repair.
  // Pass 1 point elements are reliable; LLM repair often hallucinates new vertices.
  if (!continuity.isValid) {
    const currentPoints = graphSpec.elements.filter((e) => e.type === "point");
    const pass1Points = pass1Spec.elements.filter((e) => e.type === "point");
    let sourcePoints = currentPoints;
    let sourceLabel = "current extracted";
    if (!usedAuditedVertices && pass1Points.length >= currentPoints.length) {
      sourcePoints = pass1Points;
      sourceLabel = "pass 1";
    }

    if (sourcePoints.length >= 2) {
      const byX = new Map<number, { x: number; y: number }>();
      for (const p of sourcePoints) {
        if (p.type === "point" && !byX.has(p.x)) byX.set(p.x, { x: p.x, y: p.y });
      }
      const vertices = Array.from(byX.values()).sort((a, b) => a.x - b.x);

      if (vertices.length >= 2) {
        const templateLine = graphSpec.elements.find(
          (e): e is Extract<IbGraphElement, { type: "line" }> => e.type === "line"
        );
        type LineEl = Extract<IbGraphElement, { type: "line" }>;
        const rebuilt: LineEl[] = [];

        for (let i = 0; i < vertices.length - 1; i++) {
          const a = vertices[i];
          const b = vertices[i + 1];
          if (b.x <= a.x) continue;
          const dx = b.x - a.x;
          const m = (b.y - a.y) / dx;
          const c = a.y - m * a.x;
          let expr: string;
          if (Math.abs(m) < 1e-10) {
            expr = String(Math.round(c * 1e9) / 1e9);
          } else {
            const mStr = String(Math.round(m * 1e9) / 1e9);
            const cStr = Math.abs(c) < 1e-10 ? "" : ` ${c > 0 ? "+" : "-"} ${String(Math.round(Math.abs(c) * 1e9) / 1e9)}`;
            expr = `${mStr}*x${cStr}`;
          }
          rebuilt.push({ type: "line", expr, xMin: a.x, xMax: b.x, dashed: templateLine?.dashed, color: templateLine?.color } as LineEl);
        }

        if (rebuilt.length >= 1) {
          const nonLineElements = graphSpec.elements.filter((e) => e.type !== "line");
          const candidate: IbGraphSpec = { ...graphSpec, elements: [...rebuilt, ...nonLineElements] };
          const candContinuity = validateContinuity(candidate);
          if (candContinuity.isValid) {
            graphSpec = candidate;
            continuity = candContinuity;
            warnings.push(`Applied deterministic piecewise repair from ${sourceLabel} point vertices (skipping LLM repair).`);
          }
        }
      }
    }
  }

  while (!continuity.isValid && attempt < MAX_REPAIR_ATTEMPTS) {
    attempt += 1;
    warnings.push(...continuity.errors.map((e) => `Continuity check failed (attempt ${attempt}): ${e}`));
    try {
      const repairResponse = await anthropic.messages.create({
        model: "claude-opus-4-5",
        max_tokens: 4096,
        system: GRAPH_VERIFY_SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              ...imageContent,
              {
                type: "text",
                text: `The current graphSpec failed automatic continuity validation.

Continuity errors:
${continuity.errors.map((e) => `- ${e}`).join("\n")}

Current spec:
${JSON.stringify({ graphSpec, graphMeta }, null, 2)}

${questionLatex ? `=== Question LaTeX ===\n${questionLatex}\n` : ""}
${msLatex ? `=== Mark Scheme LaTeX ===\n${msLatex}\n` : ""}

Repair instructions:
- Re-extract/snap ordered vertices from the image.
- Build one bounded segment per interval with exact xMin/xMax.
- Recompute equations from adjacent vertex pairs.
- Ensure continuity at touching boundaries unless explicit open/jump markers exist.
- You MUST return a continuity-valid graphSpec.

Return ONLY JSON in the verify format (graphSpec, graphMeta, warnings).`,
              },
            ],
          },
        ],
      });

      const repairText = repairResponse.content[0].type === "text" ? repairResponse.content[0].text : "";
      const repaired = safeParseJson(repairText) as {
        graphSpec: IbGraphSpec;
        graphMeta: GraphMetadata;
        warnings?: string[];
      };
      if (repaired.graphSpec?.elements?.length) graphSpec = repaired.graphSpec;
      if (repaired.graphMeta) graphMeta = repaired.graphMeta;
      if (Array.isArray(repaired.warnings)) warnings.push(...repaired.warnings);
      continuity = validateContinuity(graphSpec);
    } catch (e) {
      warnings.push(`Automatic continuity repair failed on attempt ${attempt}: ${e instanceof Error ? e.message : String(e)}`);
      break;
    }
  }

  if (!continuity.isValid) {
    const lockedBreakpoints = collectLockedBreakpoints(pass1Spec, graphSpec);
    const deterministic = deterministicPiecewiseRepair(graphSpec, lockedBreakpoints);
    if (deterministic) {
      const det = normalizeLineDomains(deterministic);
      const deterministicContinuity = validateContinuity(det);
      if (deterministicContinuity.isValid) {
        graphSpec = det;
        continuity = deterministicContinuity;
        warnings.push("Applied deterministic piecewise repair from extracted point vertices (skipping LLM repair).");
      }
    }
  }

  if (!continuity.isValid) {
    graphMeta = regenerateGraphMetaFromSpec(graphSpec, graphMeta);
    const feedback = generateImprovementFeedback(graphSpec, graphMeta, warnings);
    warnings.push(...continuity.errors.map((e) => `Continuity still failing after ${attempt} repair attempt(s): ${e}`));
    return NextResponse.json(
      {
        error: "Continuity validation failed after automatic repair",
        warnings,
        feedback,
        graphSpec,
        graphMeta,
        sourceImageBase64: firstImageBase64,
      },
      { status: 422 }
    );
  }

  if (attempt > 0) {
    warnings.push(`Automatic continuity repair applied successfully on attempt ${attempt}.`);
  }

  if (base64Images[0]) {
    try {
      const refined = await rasterRefineHorizontalSegmentsFromBase64(base64Images[0], graphSpec as unknown as Parameters<typeof rasterRefineHorizontalSegmentsFromBase64>[1]);
      if (refined?.diagnostics?.length) {
        graphSpec = refined.spec as IbGraphSpec;
        warnings.push(...refined.diagnostics.map((d) => `Raster diagnostics: ${d}`));
      }
    } catch {
      // Non-fatal: continue with the best available spec.
    }
  }

  graphMeta = regenerateGraphMetaFromSpec(graphSpec, graphMeta);

  const topologyUncertain =
    usedAuditedVertices &&
    !rasterSnapApplied &&
    auditNormalizationRemoved >= 5 &&
    (auditAverageConfidence ?? 0) >= 0.85;

  if (topologyUncertain) {
    warnings.push(
      "Extraction uncertainty gate triggered: high-confidence audit required heavy point pruning while raster snap was rejected."
    );
    graphMeta = regenerateGraphMetaFromSpec(graphSpec, graphMeta);
    const feedback = generateImprovementFeedback(graphSpec, graphMeta, warnings);
    return NextResponse.json(
      {
        error: "Extraction uncertain after topology checks; manual review required",
        warnings,
        feedback,
        graphSpec,
        graphMeta,
        sourceImageBase64: firstImageBase64,
      },
      { status: 422 }
    );
  }

  return NextResponse.json({
    graphSpec,
    graphMeta,
    warnings,
    feedback: generateImprovementFeedback(graphSpec, graphMeta, warnings),
    sourceImageBase64: firstImageBase64,
  });
}
