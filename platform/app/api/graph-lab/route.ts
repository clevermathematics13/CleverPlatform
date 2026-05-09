/**
 * POST /api/graph-lab
 *
 * Standalone graph extraction endpoint for the graph-lab playground.
 * Accepts raw base64 image data directly (no questionId / DB lookup needed).
 *
 * Body:
 *   {
 *     images: string[];          // base64-encoded images (PNG or JPEG)
 *     mediaType?: string;        // "image/png" | "image/jpeg"  (default: image/png)
 *     questionLatex?: string;    // optional – improves Pass 2 verification
 *     msLatex?: string;          // optional – improves Pass 2 verification
 *   }
 *
 * Returns:
 *   { graphSpec, graphMeta, warnings, pass1Raw?, pass2Raw? }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";
import { rasterRefineHorizontalSegmentsFromBase64, rasterSnapVerticesFromBase64 } from "@/lib/graph-raster-snap";

export const maxDuration = 180;

// ─── Types (mirror IbGraph.tsx — kept local, server only) ──────────────────────

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
  description: string;
  equations: string[];
  xIntercepts: Array<{ x: number; label?: string }>;
  yIntercepts: Array<{ y: number; label?: string }>;
  verticalAsymptotes: number[];
  horizontalAsymptotes: string[];
  keyPoints: Array<{ x: number; y: number; label?: string }>;
  domain?: [number, number];
  markschemeHints: string[];
}

// ─── Prompts (identical to graph-extract route) ────────────────────────────────

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
  2. Optional question LaTeX text.
  3. Optional mark-scheme LaTeX text.

Your job is to CHECK the spec for consistency with the written question/MS and REFINE it where
necessary. In particular:
  - Calibrate grid spacing from labeled ticks before reading coordinates.
  - Prefer integer lattice coordinates when points sit on labeled intersections.
  - Use half/quarter coordinates only when visually centered between adjacent grid lines.
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

function safeParseJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1].trim() : text.trim();
  return JSON.parse(raw);
}

interface ContinuityCheckResult {
  isValid: boolean;
  errors: string[];
}

type PointLike = { x: number; y: number };
type AuditedVertex = { x: number; y: number; confidence?: number };

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

function formatNum(n: number): string {
  const fixed = Number(n.toFixed(10));
  if (Math.abs(fixed) < 1e-10) return "0";
  return String(fixed);
}

function lineExprFromPoints(a: PointLike, b: PointLike): string | null {
  const dx = b.x - a.x;
  if (Math.abs(dx) < 1e-10) return null;
  const m = (b.y - a.y) / dx;
  const c = a.y - m * a.x;

  if (Math.abs(m) < 1e-10) return formatNum(c);
  if (Math.abs(c) < 1e-10) return `${formatNum(m)}*x`;
  if (c > 0) return `${formatNum(m)}*x + ${formatNum(c)}`;
  return `${formatNum(m)}*x - ${formatNum(Math.abs(c))}`;
}

function sanitizeAuditedVertices(vertices: AuditedVertex[]): AuditedVertex[] {
  if (vertices.length <= 2) return vertices;

  // Resolve duplicate x-values by keeping the highest-confidence candidate.
  const bestByX = new Map<number, AuditedVertex>();
  for (const v of vertices) {
    const existing = bestByX.get(v.x);
    const conf = typeof v.confidence === "number" ? v.confidence : 0.5;
    const existingConf = typeof existing?.confidence === "number" ? existing.confidence : 0.5;
    if (!existing || conf > existingConf) bestByX.set(v.x, v);
  }

  const unique = Array.from(bestByX.values()).sort((a, b) => a.x - b.x);
  if (unique.length <= 2) return unique;

  // Remove interior points that are perfectly collinear with neighbors.
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

function selectRepairBreakpoints(lockedBreakpoints: number[], rawPoints: PointLike[], tol = 1e-6): number[] {
  const pointXs = uniqueSorted(rawPoints.map((p) => p.x), tol);
  if (pointXs.length < 2) {
    return lockedBreakpoints;
  }

  const minPointX = pointXs[0];
  const maxPointX = pointXs[pointXs.length - 1];

  const clampedLocked = uniqueSorted(
    lockedBreakpoints.filter((x) => x >= minPointX - tol && x <= maxPointX + tol),
    tol
  );

  // Always anchor the reconstructed piecewise domains to observed endpoints.
  const merged = uniqueSorted([...clampedLocked, minPointX, maxPointX], tol);
  if (merged.length >= 2) return merged;

  // Fallback: if clamping is too aggressive, prefer observed point x-values.
  if (pointXs.length >= 2) return pointXs;

  return lockedBreakpoints;
}

function findRepresentativePointY(
  points: PointLike[],
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
  const supportedLockedBreakpoints = selectRepairBreakpoints(lockedBreakpoints, rawPoints);
  const breakpoints = supportedLockedBreakpoints.length >= 2
    ? supportedLockedBreakpoints
    : lockedBreakpoints.length >= 2
      ? lockedBreakpoints
      : fallbackBreakpoints;
  if (breakpoints.length < 2) return null;

  const vertices: PointLike[] = [];
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

  feedback.push("Re-check every snapped vertex against the source grid before finalizing the rendered LaTeX graph.");

  const boundedSegments = spec.elements.filter(
    (el): el is Extract<IbGraphElement, { type: "line" | "fn" }> =>
      (el.type === "line" || el.type === "fn") && typeof el.xMin === "number" && typeof el.xMax === "number"
  );
  const unboundedSegments = spec.elements.filter(
    (el): el is Extract<IbGraphElement, { type: "line" | "fn" }> =>
      (el.type === "line" || el.type === "fn") && (typeof el.xMin !== "number" || typeof el.xMax !== "number")
  );

  if (unboundedSegments.length > 0) {
    feedback.push("Add explicit xMin/xMax bounds for every segment so interval edges are unambiguous.");
  }

  const pointElements = spec.elements.filter((el) => el.type === "point").length;
  const keyPoints = Array.isArray(graphMeta.keyPoints) ? graphMeta.keyPoints.length : 0;
  if (pointElements === 0 || keyPoints > pointElements) {
    feedback.push("Include explicit point elements for intercepts/endpoints/corners to make visual QA faster.");
  }

  if (!Array.isArray(spec.xRange) || !Array.isArray(spec.yRange)) {
    feedback.push("Set tight xRange/yRange to prevent scaling from masking slope or intercept mistakes.");
  }

  if (boundedSegments.length > 1) {
    feedback.push("Manually evaluate neighboring segment endpoints at each shared boundary x-value to confirm continuity intent.");
  }

  if (warnings.length > 0) {
    feedback.push("Resolve warnings first, then rerun extraction and compare rendered graph against source image segment-by-segment.");
  } else {
    feedback.push("Even with no warnings, perform one manual pass for slope, domain bounds, and endpoint openness/closedness.");
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

function clampDomainToPointSupport(spec: IbGraphSpec, meta: GraphMetadata): GraphMetadata {
  const pointXs = spec.elements
    .filter((e): e is Extract<IbGraphElement, { type: "point" }> => e.type === "point")
    .map((p) => p.x)
    .filter((x) => Number.isFinite(x));

  if (pointXs.length < 2) return meta;

  const pointDomainMin = Math.min(...pointXs);
  const pointDomainMax = Math.max(...pointXs);

  const segmentDomainMin = meta.domain?.[0];
  const segmentDomainMax = meta.domain?.[1];

  const tol = 1e-6;
  if (
    typeof segmentDomainMin === "number" &&
    typeof segmentDomainMax === "number" &&
    (Math.abs(segmentDomainMin - pointDomainMin) > tol || Math.abs(segmentDomainMax - pointDomainMax) > tol)
  ) {
    return {
      ...meta,
      domain: [pointDomainMin, pointDomainMax],
    };
  }

  return meta;
}

function computeSegmentDomain(spec: IbGraphSpec): [number, number] | null {
  const bounded = spec.elements
    .filter((el): el is Extract<IbGraphElement, { type: "line" | "fn" }> =>
      (el.type === "line" || el.type === "fn") && typeof el.xMin === "number" && typeof el.xMax === "number"
    );

  if (bounded.length === 0) return null;
  return [
    Math.min(...bounded.map((s) => s.xMin as number)),
    Math.max(...bounded.map((s) => s.xMax as number)),
  ];
}

function computePointSupportedDomain(spec: IbGraphSpec): [number, number] | null {
  const points = spec.elements
    .filter((el): el is Extract<IbGraphElement, { type: "point" }> => el.type === "point")
    .map((p) => p.x)
    .filter((x) => Number.isFinite(x));

  if (points.length < 2) return null;
  return [Math.min(...points), Math.max(...points)];
}

function appendDomainConsistencyWarning(spec: IbGraphSpec, warnings: string[], tol = 1e-6): void {
  const seg = computeSegmentDomain(spec);
  const pts = computePointSupportedDomain(spec);
  if (!seg || !pts) return;

  if (Math.abs(seg[0] - pts[0]) > tol || Math.abs(seg[1] - pts[1]) > tol) {
    warnings.push(
      `Domain mismatch detected: segment-derived [${seg[0]}, ${seg[1]}] vs point-supported [${pts[0]}, ${pts[1]}]. Marking extraction as low-confidence; review endpoints manually.`
    );
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

    // Only enforce continuity where segments are intended to meet.
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

  const body = (await request.json()) as {
    images: string[];
    mediaType?: string;
    questionLatex?: string;
    msLatex?: string;
  };

  const { images, mediaType = "image/png", questionLatex = "", msLatex = "" } = body;

  if (!images?.length)
    return NextResponse.json({ error: "At least one image is required" }, { status: 400 });

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const imageContent = images.map((b64) => ({
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: (mediaType === "image/jpeg" ? "image/jpeg" : "image/png") as "image/png" | "image/jpeg",
      data: b64,
    },
  }));

  // ── Pass 1 — visual extraction ──────────────────────────────────────────
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
            text: `Analyse the graph(s) in ${images.length === 1 ? "this image" : "these images"} of an IB Mathematics exam question.
Extract EVERY visible graphical element with full precision and return the structured JSON as described in the system prompt.
Be thorough: include all curves, asymptotes, intercepts, labeled points, guide lines, shaded regions, and annotations.`,
          },
        ],
      },
    ],
  });

  const pass1Raw = pass1Response.content[0].type === "text" ? pass1Response.content[0].text : "";

  let graphSpec: IbGraphSpec;
  let graphMeta: GraphMetadata;
  let warnings: string[] = [];

  try {
    const parsed = safeParseJson(pass1Raw) as { graphSpec: IbGraphSpec; graphMeta: GraphMetadata };
    graphSpec = normalizeLineDomains(parsed.graphSpec);
    graphMeta = parsed.graphMeta;
  } catch {
    return NextResponse.json(
      { error: "Pass 1 JSON parse failed", pass1Raw: pass1Raw.slice(0, 2000) },
      { status: 500 }
    );
  }

  // Preserve Pass 1 spec as authoritative source for point vertices
  const pass1Spec = graphSpec;

  // ── Pass 2 — verify against optional context ────────────────────────────
  let pass2Raw: string | undefined;

  if (questionLatex.trim() || msLatex.trim()) {
    const contextParts: string[] = [];
    if (questionLatex.trim()) contextParts.push(`=== Question LaTeX ===\n${questionLatex}`);
    if (msLatex.trim()) contextParts.push(`=== Mark Scheme LaTeX ===\n${msLatex}`);

    try {
      const pass2Response = await anthropic.messages.create({
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
                text: `=== IbGraphSpec from image analysis (Pass 1) ===
${JSON.stringify(graphSpec, null, 2)}

${contextParts.join("\n\n")}

Verify the spec against the image and the written context. Return the refined spec + warnings.`,
              },
            ],
          },
        ],
      });

      pass2Raw = pass2Response.content[0].type === "text" ? pass2Response.content[0].text : "";
      const parsed2 = safeParseJson(pass2Raw) as { graphSpec: IbGraphSpec; graphMeta: GraphMetadata; warnings: string[] };
      graphSpec = normalizeLineDomains(parsed2.graphSpec ?? graphSpec);
      graphMeta = parsed2.graphMeta ?? graphMeta;
      if (Array.isArray(parsed2.warnings)) warnings.push(...parsed2.warnings);
    } catch {
      warnings.push("Pass 2 verification failed; using Pass 1 result");
    }
  }

  // ── Pass 3 — automatic continuity gate + self-repair ──────────────────
  // 3a) Optional vertex audit pass to improve coordinate accuracy
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
          const raster = await rasterSnapVerticesFromBase64(images[0], mergedVertices);
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
  const lockedBreakpoints = collectLockedBreakpoints(pass1Spec, graphSpec);

  // Attempt deterministic repair FIRST from point elements before touching LLM repair.
  // This avoids LLM hallucinating new vertex positions that break everything.
  if (!continuity.isValid) {
    // Prefer audited/current points; if audit was not used and current points are sparse, use Pass 1 points.
    let deterministicTarget = graphSpec;
    let deterministicSource = "current extracted";
    const currentPoints = graphSpec.elements.filter((e) => e.type === "point").length;
    const pass1Points = pass1Spec.elements.filter((e) => e.type === "point").length;
    if (!usedAuditedVertices && pass1Points > currentPoints) {
      const nonPoint = graphSpec.elements.filter((e) => e.type !== "point");
      const pass1PointEls = pass1Spec.elements.filter((e) => e.type === "point");
      deterministicTarget = { ...graphSpec, elements: [...nonPoint, ...pass1PointEls] };
      deterministicSource = "pass 1";
    }
    const deterministicResult = deterministicPiecewiseRepair(deterministicTarget, lockedBreakpoints);
    if (deterministicResult) {
      const det = normalizeLineDomains(deterministicResult);
      const detContinuity = validateContinuity(det);
      if (detContinuity.isValid) {
        graphSpec = det;
        continuity = detContinuity;
        warnings.push(`Applied deterministic piecewise repair from ${deterministicSource} point vertices (skipping LLM repair).`);
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
${JSON.stringify(graphSpec, null, 2)}

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

      const repairRaw = repairResponse.content[0].type === "text" ? repairResponse.content[0].text : "";
      const repaired = safeParseJson(repairRaw) as { graphSpec: IbGraphSpec; graphMeta: GraphMetadata; warnings?: string[] };
      if (repaired.graphSpec?.elements?.length) graphSpec = normalizeLineDomains(repaired.graphSpec);
      if (repaired.graphMeta) graphMeta = repaired.graphMeta;
      if (Array.isArray(repaired.warnings)) warnings.push(...repaired.warnings);
      continuity = validateContinuity(graphSpec);
    } catch (e) {
      warnings.push(`Automatic continuity repair failed on attempt ${attempt}: ${e instanceof Error ? e.message : String(e)}`);
      break;
    }
  }

  // Deterministic fallback: if LLM repairs still fail, rebuild line segments from
  // detected point vertices from current spec (last resort).
  if (!continuity.isValid) {
    const fallbackSpec = deterministicPiecewiseRepair(graphSpec, lockedBreakpoints);
    if (fallbackSpec) {
      graphSpec = normalizeLineDomains(fallbackSpec);
      continuity = validateContinuity(graphSpec);
      warnings.push("Applied deterministic piecewise repair from point vertices.");
    }
  }

  if (!continuity.isValid) {
    graphMeta = regenerateGraphMetaFromSpec(graphSpec, graphMeta);
    graphMeta = clampDomainToPointSupport(graphSpec, graphMeta);
    appendDomainConsistencyWarning(graphSpec, warnings);
    const feedback = generateImprovementFeedback(graphSpec, graphMeta, warnings);
    warnings.push(...continuity.errors.map((e) => `Continuity still failing after ${attempt} repair attempt(s): ${e}`));
    return NextResponse.json(
      {
        error: "Continuity validation failed after automatic repair",
        warnings,
        feedback,
        graphSpec,
        graphMeta,
        pass1Raw,
        pass2Raw,
      },
      { status: 422 }
    );
  }

  if (attempt > 0) {
    warnings.push(`Automatic continuity repair applied successfully on attempt ${attempt}.`);
  }

  if (images[0]) {
    try {
      const refined = await rasterRefineHorizontalSegmentsFromBase64(images[0], graphSpec as unknown as Parameters<typeof rasterRefineHorizontalSegmentsFromBase64>[1]);
      if (refined?.diagnostics?.length) {
        graphSpec = refined.spec as IbGraphSpec;
        warnings.push(...refined.diagnostics.map((d) => `Raster diagnostics: ${d}`));
      }
    } catch {
      // Non-fatal: continue with the best available spec.
    }
  }

  graphMeta = regenerateGraphMetaFromSpec(graphSpec, graphMeta);
  graphMeta = clampDomainToPointSupport(graphSpec, graphMeta);
  appendDomainConsistencyWarning(graphSpec, warnings);

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
    graphMeta = clampDomainToPointSupport(graphSpec, graphMeta);
    const feedback = generateImprovementFeedback(graphSpec, graphMeta, warnings);
    return NextResponse.json(
      {
        error: "Extraction uncertain after topology checks; manual review required",
        warnings,
        feedback,
        graphSpec,
        graphMeta,
        pass1Raw,
        pass2Raw,
      },
      { status: 422 }
    );
  }

  return NextResponse.json({
    graphSpec,
    graphMeta,
    warnings,
    feedback: generateImprovementFeedback(graphSpec, graphMeta, warnings),
    pass1Raw,
    pass2Raw,
  });
}
