export interface RasterVertex {
  x: number;
  y: number;
  confidence?: number;
}

export interface RasterSnapResult {
  applied: boolean;
  vertices: RasterVertex[];
  diagnostics: string[];
}

type RasterGraphElement =
  | { type: "line"; expr: string; xMin?: number; xMax?: number; [k: string]: unknown }
  | { type: "fn"; expr: string; xMin?: number; xMax?: number; [k: string]: unknown }
  | { type: "point"; x: number; y: number; [k: string]: unknown }
  | { type: string; [k: string]: unknown };

export interface RasterGraphSpec {
  elements: RasterGraphElement[];
  [k: string]: unknown;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function findAxis(signal: number[]): number {
  const len = signal.length;
  const lo = Math.floor(len * 0.15);
  const hi = Math.floor(len * 0.85);
  let bestIdx = Math.floor(len / 2);
  let bestScore = -Infinity;
  for (let i = lo; i <= hi; i++) {
    const centerBias = 1 - Math.abs(i - len / 2) / (len / 2);
    const score = signal[i] + centerBias * 0.2 * signal[i];
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function findGridSpacing(signal: number[], origin: number): number | null {
  if (signal.length < 10) return null;
  const mean = signal.reduce((s, v) => s + v, 0) / signal.length;
  const variance = signal.reduce((s, v) => s + (v - mean) * (v - mean), 0) / signal.length;
  const std = Math.sqrt(Math.max(variance, 0));
  const threshold = mean + std * 0.45;

  const peaks: number[] = [];
  for (let i = 2; i < signal.length - 2; i++) {
    if (
      signal[i] > threshold &&
      signal[i] >= signal[i - 1] &&
      signal[i] >= signal[i + 1] &&
      signal[i] >= signal[i - 2] &&
      signal[i] >= signal[i + 2]
    ) {
      if (peaks.length === 0 || i - peaks[peaks.length - 1] >= 6) peaks.push(i);
    }
  }

  const near = peaks.filter((p) => Math.abs(p - origin) < signal.length * 0.45).sort((a, b) => a - b);
  const diffs: number[] = [];
  for (let i = 1; i < near.length; i++) {
    const d = near[i] - near[i - 1];
    if (d >= 8 && d <= 120) diffs.push(d);
  }

  if (diffs.length === 0) return null;
  return median(diffs);
}

function snapCoord(v: number): number {
  const intV = Math.round(v);
  if (Math.abs(v - intV) <= 0.18) return intV;

  const halfV = Math.round(v * 2) / 2;
  return halfV;
}

function formatNum(n: number): string {
  const fixed = Number(n.toFixed(10));
  if (Math.abs(fixed) < 1e-10) return "0";
  return String(fixed);
}

function toMathExpr(expr: string): string {
  return expr
    .replace(/\^/g, "**")
    .replace(/\bln\s*\(/g, "Math.log(")
    .replace(/\blog\s*\(/g, "Math.log10(")
    .replace(/\bsin\s*\(/g, "Math.sin(")
    .replace(/\bcos\s*\(/g, "Math.cos(")
    .replace(/\btan\s*\(/g, "Math.tan(")
    .replace(/\barcsin\s*\(/g, "Math.asin(")
    .replace(/\barccos\s*\(/g, "Math.acos(")
    .replace(/\barctan\s*\(/g, "Math.atan(")
    .replace(/\bsqrt\s*\(/g, "Math.sqrt(")
    .replace(/\babs\s*\(/g, "Math.abs(")
    .replace(/\bcbrt\s*\(/g, "Math.cbrt(")
    .replace(/(?<![A-Za-z.\d])e(?![A-Za-z_])/g, "Math.E")
    .replace(/\bpi\b/gi, "Math.PI");
}

function evaluateAtX(expr: string, x: number): number | null {
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function("x", `return (${toMathExpr(expr)});`) as (x: number) => number;
    const y = fn(x);
    return Number.isFinite(y) ? y : null;
  } catch {
    return null;
  }
}

async function readRasterGeometry(imageBase64: string): Promise<{
  data: Buffer;
  width: number;
  height: number;
  channels: number;
  xAxisPx: number;
  yAxisPx: number;
  spacingX: number;
  spacingY: number;
} | null> {
  let sharpMod: typeof import("sharp") | null = null;
  try {
    sharpMod = (await import("sharp")).default;
  } catch {
    return null;
  }

  const input = Buffer.from(imageBase64, "base64");
  const { data, info } = await sharpMod(input)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width;
  const height = info.height;
  const channels = info.channels;
  if (!width || !height || !channels) return null;

  const luminance = (x: number, y: number): number => {
    const xx = clamp(x, 0, width - 1);
    const yy = clamp(y, 0, height - 1);
    const idx = (yy * width + xx) * channels;
    return data[idx];
  };

  const colSignal = new Array<number>(width).fill(0);
  const rowSignal = new Array<number>(height).fill(0);

  const yLo = Math.floor(height * 0.08);
  const yHi = Math.floor(height * 0.92);
  const xLo = Math.floor(width * 0.08);
  const xHi = Math.floor(width * 0.92);

  for (let x = xLo; x <= xHi; x++) {
    let score = 0;
    for (let y = yLo; y <= yHi; y++) score += 255 - luminance(x, y);
    colSignal[x] = score;
  }

  for (let y = yLo; y <= yHi; y++) {
    let score = 0;
    for (let x = xLo; x <= xHi; x++) score += 255 - luminance(x, y);
    rowSignal[y] = score;
  }

  const xAxisPx = findAxis(colSignal);
  const yAxisPx = findAxis(rowSignal);
  const xSpacing = findGridSpacing(colSignal, xAxisPx);
  const ySpacing = findGridSpacing(rowSignal, yAxisPx);
  const spacingX = xSpacing ?? ySpacing;
  const spacingY = ySpacing ?? xSpacing;
  if (!spacingX || !spacingY || spacingX < 6 || spacingY < 6) return null;

  return { data, width, height, channels, xAxisPx, yAxisPx, spacingX, spacingY };
}

export async function rasterSnapVerticesFromBase64(
  imageBase64: string,
  vertices: RasterVertex[]
): Promise<RasterSnapResult | null> {
  if (!imageBase64 || vertices.length === 0) return null;

  const geometry = await readRasterGeometry(imageBase64);
  if (!geometry) return null;
  const { data, width, height, channels, xAxisPx, yAxisPx, spacingX, spacingY } = geometry;

  const luminance = (x: number, y: number): number => {
    const xx = clamp(x, 0, width - 1);
    const yy = clamp(y, 0, height - 1);
    const idx = (yy * width + xx) * channels;
    return data[idx];
  };

  const diagnostics = [
    `Raster snap axes: x0_px=${xAxisPx}, y0_px=${yAxisPx}`,
    `Raster snap spacing: dx_px=${spacingX.toFixed(2)}, dy_px=${spacingY.toFixed(2)}`,
  ];

  const snapped = vertices.map((v) => {
    const xPx = Math.round(xAxisPx + v.x * spacingX);
    const expectedYPx = yAxisPx - v.y * spacingY;
    const yMin = Math.floor(clamp(expectedYPx - spacingY * 1.2, 0, height - 1));
    const yMax = Math.ceil(clamp(expectedYPx + spacingY * 1.2, 0, height - 1));

    let bestY = Math.round(clamp(expectedYPx, 0, height - 1));
    let bestInk = -Infinity;

    for (let yy = yMin; yy <= yMax; yy++) {
      let ink = 0;
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const val = luminance(xPx + dx, yy + dy);
          ink += 255 - val;
        }
      }
      if (ink > bestInk) {
        bestInk = ink;
        bestY = yy;
      }
    }

    const yWorld = (yAxisPx - bestY) / spacingY;
    return {
      ...v,
      y: snapCoord(yWorld),
    };
  });

  const deltas = snapped.map((s, i) => s.y - vertices[i].y);
  const absDeltas = deltas.map((d) => Math.abs(d));
  const maxAbsDelta = absDeltas.length > 0 ? Math.max(...absDeltas) : 0;
  const medAbsDelta = median(absDeltas);

  let horizontalBreaks = 0;
  for (let i = 0; i < vertices.length - 1; i++) {
    const a0 = vertices[i];
    const b0 = vertices[i + 1];
    if (Math.abs(a0.y - b0.y) <= 0.05 && Math.abs(b0.x - a0.x) >= 0.9) {
      const a1 = snapped[i];
      const b1 = snapped[i + 1];
      if (Math.abs(a1.y - b1.y) > 0.35) horizontalBreaks += 1;
    }
  }

  const quantViolations = snapped.filter((v) => Math.abs(v.y * 2 - Math.round(v.y * 2)) > 1e-6).length;

  const accepted = quantViolations === 0 && maxAbsDelta <= 1.0 && medAbsDelta <= 0.45 && horizontalBreaks <= 4;
  diagnostics.push(
    `Raster snap quality: accepted=${accepted} maxDelta=${maxAbsDelta.toFixed(2)} medDelta=${medAbsDelta.toFixed(2)} horizontalBreaks=${horizontalBreaks} quantViolations=${quantViolations}`
  );

  if (!accepted) {
    diagnostics.push("Raster snap rejected by quality gate; preserving vision-derived vertices.");
    return { applied: false, vertices, diagnostics };
  }

  return { applied: true, vertices: snapped, diagnostics };
}

export async function rasterRefineHorizontalSegmentsFromBase64(
  imageBase64: string,
  spec: RasterGraphSpec
): Promise<{ spec: RasterGraphSpec; diagnostics: string[] } | null> {
  if (!imageBase64 || !spec?.elements?.length) return null;

  const geometry = await readRasterGeometry(imageBase64);
  if (!geometry) return null;
  const { data, width, height, channels, xAxisPx, yAxisPx, spacingX, spacingY } = geometry;

  const luminance = (x: number, y: number): number => {
    const xx = clamp(x, 0, width - 1);
    const yy = clamp(y, 0, height - 1);
    const idx = (yy * width + xx) * channels;
    return data[idx];
  };

  const diagnostics: string[] = [];
  const nextElements = [...spec.elements];

  for (let i = 0; i < nextElements.length; i++) {
    const el = nextElements[i];
    if ((el.type !== "line" && el.type !== "fn") || typeof el.expr !== "string") continue;
    if (typeof el.xMin !== "number" || typeof el.xMax !== "number" || el.xMax <= el.xMin) continue;
    const xMin = el.xMin;
    const xMax = el.xMax;

    const yLeft = evaluateAtX(el.expr, xMin);
    const yRight = evaluateAtX(el.expr, xMax);
    if (yLeft === null || yRight === null) continue;
    if (Math.abs(yLeft - yRight) > 0.08) continue;

    const yBase = (yLeft + yRight) / 2;
    const nearestInt = Math.round(yBase);
    if (Math.abs(yBase - nearestInt) < 0.2) continue;

    const candidates = Array.from(new Set([Math.floor(yBase), Math.ceil(yBase), nearestInt]));
    if (candidates.length < 2) continue;

    const sampleCount = Math.max(4, Math.min(8, Math.round((xMax - xMin) * 2)));
    const sampleXs = Array.from({ length: sampleCount }, (_, k) =>
      xMin + ((xMax - xMin) * k) / (sampleCount - 1)
    );

    const scoreCandidate = (yCandidate: number): number => {
      const yPx = Math.round(yAxisPx - yCandidate * spacingY);
      let score = 0;
      for (const xWorld of sampleXs) {
        const xPx = Math.round(xAxisPx + xWorld * spacingX);
        for (let dx = -2; dx <= 2; dx++) {
          for (let dy = -2; dy <= 2; dy++) {
            const lum = luminance(xPx + dx, yPx + dy);
            const darkness = 255 - lum;
            const deep = lum < 95 ? 1.8 : 1.0;
            score += darkness * deep;
          }
        }
      }
      return score;
    };

    const scored = candidates.map((c) => ({ y: c, score: scoreCandidate(c) })).sort((a, b) => b.score - a.score);
    if (scored.length < 2) continue;

    const best = scored[0];
    const second = scored[1];
    const improvement = second.score > 0 ? (best.score - second.score) / second.score : 0;
    if (improvement < 0.08) continue;

    if (best.y !== nearestInt) continue;

    diagnostics.push(
      `Raster horizontal refinement: [${xMin},${xMax}] y ${formatNum(yBase)} -> ${formatNum(best.y)} (gain ${(improvement * 100).toFixed(1)}%)`
    );

    nextElements[i] = { ...el, expr: formatNum(best.y) };
    for (let j = 0; j < nextElements.length; j++) {
      const p = nextElements[j];
      if (p.type !== "point") continue;
      if (typeof p.x !== "number" || typeof p.y !== "number") continue;
      if (p.x < xMin - 1e-6 || p.x > xMax + 1e-6) continue;
      if (Math.abs(p.y - yBase) > 0.8) continue;
      nextElements[j] = { ...p, y: best.y };
    }
  }

  if (diagnostics.length === 0) return { spec, diagnostics: [] };
  return { spec: { ...spec, elements: nextElements }, diagnostics };
}
