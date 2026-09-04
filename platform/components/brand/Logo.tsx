"use client";

/**
 * CleverMathematics brand mark and wordmark.
 *
 * The mark is a tesseract - a four-dimensional hypercube - turning slowly.
 * Its 16 vertices, 32 edges and 24 square faces are rotated in two planes of
 * 4-space, projected to 3-space with perspective (which is what nests the
 * inner cube inside the outer one: the far side in W shrinks), tilted, and
 * projected again to the page. The nested-cube figure it makes is the
 * hypercube's own shadow, the same one the old hexagonal frustum mark was a
 * flat sketch of.
 *
 * Material. The logo is made of the same stuff as the lattice sphere on the
 * sign-in page - polished steel lit from above, maroon light from below -
 * but with a different geometry: cells instead of a weave. Each edge is a
 * steel rod shaded as a cylinder: its own gradient runs ACROSS the rod,
 * oriented so the bright band always faces the light, from a soft edge
 * through the specular peak to the dark underside, where a trace of crimson
 * is the floor light catching the metal - exactly as on the sphere's bars.
 * Rods are then dimmed and thinned by depth: near ones bright and thick,
 * far ones dark and thin. The faces are smoked panes tinted maroon, lit
 * from upper-left-front and darkening as they turn away, painted far to
 * near so the cells read as volumes. A pool of maroon light sits behind
 * the figure. The wordmark is brushed steel: a soft chrome gradient that
 * passes through a dark horizon into a maroon reflection, with a fine
 * horizontal grain and a specular bevel from an SVG lighting filter, so the
 * letters catch light along their edges like machined metal rather than
 * being painted with a gradient.
 *
 * Motion. Two things move, both gently. The rotation is a requestAnimation-
 * Frame loop, throttled to ~30 fps, that writes the projected geometry (and
 * each rod's gradient axis) straight onto the SVG elements - React renders
 * the figure once, at t = 0 (so server HTML carries a proper static
 * tesseract), and never re-renders for it. The clock is wall time, so every
 * instance on a page turns in phase. Independently, the lockup swells and
 * settles by a few percent on a slow ease-in-out loop (CSS, globals.css)
 * while the light behind the mark brightens with each swell. Both are off
 * under prefers-reduced-motion; `rotate={false}` and `breathe={false}` hold
 * them still individually.
 *
 * `variant="embossed"` adds the relief - a faint highlight cast up-left, a
 * deeper shadow cast down-right - that presses the logo up out of whatever
 * surface it sits on.
 *
 * Sizing. Two ways to size the logo, and they must not be mixed:
 *   - `size`: the mark's height in px; the wordmark follows at 0.48x. Use it
 *     where the container is comfortably wider than the logo.
 *   - `width`: the TOTAL width the logo may occupy. Every dimension is derived
 *     from it and the wordmark is an SVG text fitted to its exact box, so the
 *     logo can never overflow or clip, whatever font is loaded. Use it in
 *     constrained chrome (the navigation rail), where the first version of
 *     this component was cut off at "CleverMathematic".
 *
 * Gradient and filter ids are made unique per instance with useId, because
 * the rail and a page can both render the logo and SVG ids are document-wide.
 */

import { useEffect, useId, useRef, type CSSProperties, type SVGProps } from "react";

// ---------------------------------------------------------------------------
// Tesseract geometry
// ---------------------------------------------------------------------------

type V4 = [number, number, number, number];

// Vertex i has coordinate k = +1 where bit k of i is set, else -1.
const VERTICES: V4[] = Array.from({ length: 16 }, (_, i) => [
  i & 1 ? 1 : -1,
  i & 2 ? 1 : -1,
  i & 4 ? 1 : -1,
  i & 8 ? 1 : -1,
]);

// An edge joins two vertices that differ in exactly one coordinate.
const EDGES: [number, number][] = [];
for (let i = 0; i < 16; i++) {
  for (let k = 0; k < 4; k++) {
    const j = i ^ (1 << k);
    if (i < j) EDGES.push([i, j]);
  }
}

// A face is the four vertices free in two coordinates (a, b) with the other
// two fixed; listed in cyclic order so it draws as a quad.
const FACES: number[][] = [];
for (let a = 0; a < 4; a++) {
  for (let b = a + 1; b < 4; b++) {
    const others = [0, 1, 2, 3].filter((k) => k !== a && k !== b);
    for (let fixed = 0; fixed < 4; fixed++) {
      const base = (fixed & 1 ? 1 << others[0] : 0) | (fixed & 2 ? 1 << others[1] : 0);
      FACES.push([base, base | (1 << a), base | (1 << a) | (1 << b), base | (1 << b)]);
    }
  }
}

// Seconds per revolution in each of the two rotating planes: about three
// degrees a second. Unequal and not in a simple ratio, so the figure never
// quite repeats a pose.
const PERIOD_XW = 120;
const PERIOD_YZ = 200;
// Fixed tilt of the projected 3-space, so the cube is seen from above and
// to the side rather than face-on.
const TILT_X = (22 * Math.PI) / 180;
const TILT_Y = (-28 * Math.PI) / 180;
// Perspective distances. 4D->3D is what nests the inner cube; 3D->2D is
// kept mild so the figure's size stays steady as it turns.
const D4 = 3.4;
const D3 = 7;
// Half-width of the box the figure is fitted into (of 50).
const FIT = 47;
const FRAME_RATE = 30;

interface Projected {
  x: number;
  y: number;
  /** 0 (farthest) .. 1 (nearest) within this pose, for shading and paint order. */
  depth: number;
  /** Position in the tilted 3-space, for face normals. */
  p3: [number, number, number];
}

/** The 16 vertices for rotation angles a (XW plane) and b (YZ plane). */
function project(a: number, b: number, scale: number): Projected[] {
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  const cx = Math.cos(TILT_X), sx = Math.sin(TILT_X), cy = Math.cos(TILT_Y), sy = Math.sin(TILT_Y);
  const raw = VERTICES.map(([x0, y0, z0, w0]) => {
    // Rotate in the XW and YZ planes of 4-space.
    const x1 = x0 * ca - w0 * sa;
    const w1 = x0 * sa + w0 * ca;
    const y1 = y0 * cb - z0 * sb;
    const z1 = y0 * sb + z0 * cb;
    // Perspective 4D -> 3D.
    const s4 = D4 / (D4 - w1);
    let x = x1 * s4, y = y1 * s4, z = z1 * s4;
    // Tilt in 3-space: about X, then about Y.
    const ty = y * cx - z * sx, tz = y * sx + z * cx;
    y = ty; z = tz;
    const ux = x * cy + z * sy, uz = -x * sy + z * cy;
    x = ux; z = uz;
    // Perspective 3D -> 2D; z toward the viewer. Depth blends how near a
    // vertex is in 3-space with how near it was in 4-space, so the inner
    // cube reads as farther even where the tilt brings part of it forward.
    const s3 = D3 / (D3 - z);
    return { x: 50 + x * s3 * scale, y: 50 + y * s3 * scale, key: z + 0.6 * w1, p3: [x, y, z] as [number, number, number] };
  });
  let lo = Infinity, hi = -Infinity;
  for (const v of raw) { lo = Math.min(lo, v.key); hi = Math.max(hi, v.key); }
  return raw.map((v) => ({ x: v.x, y: v.y, p3: v.p3, depth: (v.key - lo) / (hi - lo || 1) }));
}

const angles = (t: number) => [(2 * Math.PI * t) / PERIOD_XW, (2 * Math.PI * t) / PERIOD_YZ] as const;

// Fit the figure to the box once, over a full sweep of both rotations, so
// its size is decided by its largest pose rather than by whatever pose it
// happens to be in when a page loads.
const SCALE = (() => {
  let extent = 0;
  const steps = 48;
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < steps; j++) {
      for (const v of project((2 * Math.PI * i) / steps, (2 * Math.PI * j) / steps, 1)) {
        extent = Math.max(extent, Math.abs(v.x - 50), Math.abs(v.y - 50));
      }
    }
  }
  return FIT / extent;
})();

// Light from upper-left-front (SVG y points down, so "up" is negative y).
const LIGHT = (() => {
  const v = [-0.45, -0.7, 0.6];
  const n = Math.hypot(...v);
  return v.map((c) => c / n) as [number, number, number];
})();

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const hex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, "0")).join("");
const mix = (c0: [number, number, number], c1: [number, number, number], t: number) =>
  hex(lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t));

// Smoked glass: the far shade and the lit shade of a face.
const PANE_FAR: [number, number, number] = [0x1c, 0x06, 0x0e];
const PANE_LIT: [number, number, number] = [0xa8, 0x2a, 0x46];

interface FaceDraw { points: string; fill: string; opacity: number }
interface EdgeDraw {
  x1: number; y1: number; x2: number; y2: number;
  depth: number;
  /** Stroke width, from depth. */
  width: number;
  /** Gradient axis across the rod, lit side first. */
  gx1: number; gy1: number; gx2: number; gy2: number;
}

/** Rod width for a depth, in box units. */
const rodWidth = (depth: number, weight: number) => weight * (0.5 + 0.65 * Math.max(0, Math.min(1, depth)));

function frame(t: number, weight: number): { faces: FaceDraw[]; edges: EdgeDraw[] } {
  const [a, b] = angles(t);
  const v = project(a, b, SCALE);
  const faces = FACES.map((idx) => {
    const p = idx.map((i) => v[i]);
    const [q, r, s] = [p[0].p3, p[1].p3, p[3].p3];
    const u = [r[0] - q[0], r[1] - q[1], r[2] - q[2]];
    const w = [s[0] - q[0], s[1] - q[1], s[2] - q[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const nl = Math.hypot(n[0], n[1], n[2]) || 1;
    // Two-sided: a pane lit from behind still glows, just less.
    const lit = 0.5 + 0.5 * Math.abs((n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]) / nl);
    const depth = p.reduce((acc, q2) => acc + q2.depth, 0) / 4;
    return {
      depth,
      points: p.map((q2) => `${q2.x.toFixed(2)},${q2.y.toFixed(2)}`).join(" "),
      fill: mix(PANE_FAR, PANE_LIT, lit * (0.3 + 0.7 * depth)),
      opacity: 0.12 + 0.26 * depth,
    };
  });
  faces.sort((f, g) => f.depth - g.depth);
  const edges = EDGES.map(([i, j]) => {
    const depth = (v[i].depth + v[j].depth) / 2;
    const width = rodWidth(depth, weight);
    // Gradient axis: perpendicular to the rod, through its midpoint, the
    // first end on the side that faces the light.
    const dx = v[j].x - v[i].x, dy = v[j].y - v[i].y;
    const len = Math.hypot(dx, dy) || 1;
    let nx = -dy / len, ny = dx / len;
    if (nx * LIGHT[0] + ny * LIGHT[1] < 0) { nx = -nx; ny = -ny; }
    const mx = (v[i].x + v[j].x) / 2, my = (v[i].y + v[j].y) / 2;
    const h = width / 2;
    return {
      x1: v[i].x, y1: v[i].y, x2: v[j].x, y2: v[j].y, depth, width,
      gx1: mx + nx * h, gy1: my + ny * h, gx2: mx - nx * h, gy2: my - ny * h,
    };
  });
  edges.sort((e, f) => e.depth - f.depth);
  return { faces, edges };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export type LogoVariant = "flat" | "embossed";

/** Emboss relief: light cast up-left, shadow cast down-right. */
const EMBOSS_FILTER =
  "drop-shadow(-1px -1px 0 rgba(255,255,255,0.22)) drop-shadow(1px 1px 0 rgba(0,0,0,0.65)) drop-shadow(0 2px 3px rgba(0,0,0,0.35))";

const WORDMARK = "CleverMathematics";
const WORDMARK_FONT = "var(--font-brand), 'Audiowide', 'Orbitron', 'Exo 2', ui-sans-serif, sans-serif";

// Proportions of the lockup, in units of the wordmark font size f:
//   mark height = f / 0.48, gap = 0.28 x mark, wordmark width ~ 10.6 f (Audiowide).
const MARK_PER_F = 1 / 0.48;
const GAP_PER_F = 0.28 * MARK_PER_F;
const WORDMARK_PER_F = 10.6;
const LOCKUP_PER_F = MARK_PER_F + GAP_PER_F + WORDMARK_PER_F;

// The palette's crimson family, as used on the sphere: accent, the deep
// maroon of the lit field, and the near-black maroon of its shadow.
const CRIMSON = "#e0405f";
const MAROON = "#7a0a2a";
const MAROON_DEEP = "#2a0410";

const svgId = (raw: string) => "logo" + raw.replace(/[^a-zA-Z0-9]/g, "");

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Across one rod, lit side to dark side: a machined steel cylinder. */
function RodStops() {
  return (
    <>
      <stop offset="0" stopColor="#c3c8cf" />
      <stop offset="0.2" stopColor="#f7f8fa" />
      <stop offset="0.42" stopColor="#a4aab2" />
      <stop offset="0.64" stopColor="#4b5057" />
      <stop offset="0.86" stopColor="#202328" />
      <stop offset="1" stopColor="#3d1a24" />
    </>
  );
}

/**
 * Wordmark material: brushed steel over a maroon reflection, with grain and
 * a specular bevel. Rendered inside the wordmark's own SVG.
 */
function WordmarkDefs({ id, f }: { id: string; f: number }) {
  return (
    <defs>
      <linearGradient id={`${id}-text`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#e6e8ec" />
        <stop offset="0.12" stopColor="#f6f7f9" />
        <stop offset="0.3" stopColor="#b4b9c1" />
        <stop offset="0.46" stopColor="#676c74" />
        <stop offset="0.5" stopColor="#45494f" />
        <stop offset="0.56" stopColor="#6b1e33" />
        <stop offset="0.7" stopColor="#a4284a" />
        <stop offset="0.84" stopColor="#66142f" />
        <stop offset="1" stopColor="#3a0a1a" />
      </linearGradient>
      <filter id={`${id}-metal`} x="-6%" y="-25%" width="112%" height="150%" colorInterpolationFilters="sRGB">
        {/* Brushed grain: fine horizontal streaks, kept inside the letters. */}
        <feTurbulence type="fractalNoise" baseFrequency="0.02 0.8" numOctaves="2" seed="7" result="noise" />
        <feColorMatrix
          in="noise"
          type="matrix"
          values="0 0 0 0 0.55  0 0 0 0 0.56  0 0 0 0 0.58  0 0 0 0.45 0"
          result="grain"
        />
        <feComposite in="grain" in2="SourceAlpha" operator="in" result="grainIn" />
        <feBlend in="grainIn" in2="SourceGraphic" mode="overlay" result="brushed" />
        {/* Specular bevel: light the letters' rounded alpha from upper-left. */}
        <feGaussianBlur in="SourceAlpha" stdDeviation={(f * 0.028).toFixed(2)} result="relief" />
        <feSpecularLighting
          in="relief"
          surfaceScale={(f * 0.11).toFixed(2)}
          specularConstant="0.85"
          specularExponent="24"
          lightingColor="#ffffff"
          result="spec"
        >
          <feDistantLight azimuth="235" elevation="48" />
        </feSpecularLighting>
        <feComposite in="spec" in2="SourceAlpha" operator="in" result="specIn" />
        <feComposite in="brushed" in2="specIn" operator="arithmetic" k1="0" k2="1" k3="0.9" k4="0" />
      </filter>
    </defs>
  );
}

interface MarkProps extends Omit<SVGProps<SVGSVGElement>, "children" | "rotate"> {
  size?: number;
  variant?: LogoVariant;
  /** Rod weight of the nearest edge, relative to the 100-unit box. */
  weight?: number;
  /** Turn in 4-space. Default on; off under reduced motion regardless. */
  rotate?: boolean;
}

export function LogoMark({ size = 40, variant = "flat", weight = 5, rotate = true, style, ...rest }: MarkProps) {
  const id = svgId(useId());
  const gradsRef = useRef<SVGDefsElement>(null);
  const facesRef = useRef<SVGGElement>(null);
  const edgesRef = useRef<SVGGElement>(null);
  const relief: CSSProperties = variant === "embossed" ? { filter: EMBOSS_FILTER } : {};
  const initial = frame(0, weight);

  useEffect(() => {
    if (!rotate || reducedMotion()) return;
    const grads = gradsRef.current;
    const faces = facesRef.current;
    const edges = edgesRef.current;
    if (!grads || !faces || !edges) return;
    const gradients = Array.from(grads.querySelectorAll("linearGradient"));
    const polygons = Array.from(faces.children) as SVGPolygonElement[];
    const rods = Array.from(edges.children) as SVGGElement[];
    let last = 0;
    let handle = 0;
    const tick = (now: number) => {
      handle = requestAnimationFrame(tick);
      if (now - last < 1000 / FRAME_RATE) return;
      last = now;
      const f = frame(Date.now() / 1000, weight);
      f.faces.forEach((face, i) => {
        const el = polygons[i];
        el.setAttribute("points", face.points);
        el.setAttribute("fill", face.fill);
        el.setAttribute("fill-opacity", face.opacity.toFixed(3));
      });
      f.edges.forEach((edge, i) => {
        const g = gradients[i];
        g.setAttribute("x1", edge.gx1.toFixed(2));
        g.setAttribute("y1", edge.gy1.toFixed(2));
        g.setAttribute("x2", edge.gx2.toFixed(2));
        g.setAttribute("y2", edge.gy2.toFixed(2));
        const lines = rods[i].children as HTMLCollectionOf<SVGLineElement>;
        for (let k = 0; k < 3; k++) {
          const l = lines[k];
          l.setAttribute("x1", edge.x1.toFixed(2));
          l.setAttribute("y1", edge.y1.toFixed(2));
          l.setAttribute("x2", edge.x2.toFixed(2));
          l.setAttribute("y2", edge.y2.toFixed(2));
        }
        lines[0].setAttribute("stroke-width", (edge.width * 1.15).toFixed(2));
        lines[0].setAttribute("stroke-opacity", (0.2 + 0.35 * edge.depth).toFixed(3));
        lines[1].setAttribute("stroke-width", edge.width.toFixed(2));
        lines[2].setAttribute("stroke-width", edge.width.toFixed(2));
        lines[2].setAttribute("stroke-opacity", (0.6 * (1 - edge.depth)).toFixed(3));
      });
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [rotate, weight]);

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      style={{ ...relief, ...style }}
      {...rest}
    >
      <defs>
        {/* Pool of crimson light behind the figure, fading to nothing. */}
        <radialGradient id={`${id}-glow`} gradientUnits="userSpaceOnUse" cx="50" cy="60" r="50">
          <stop offset="0" stopColor={MAROON} />
          <stop offset="0.55" stopColor={MAROON_DEEP} stopOpacity="0.8" />
          <stop offset="1" stopColor={MAROON_DEEP} stopOpacity="0" />
        </radialGradient>
        {/* The brighter pulse layered over it while the logo breathes in. */}
        <radialGradient id={`${id}-pulse`} gradientUnits="userSpaceOnUse" cx="50" cy="58" r="42">
          <stop offset="0" stopColor="#ff6b86" stopOpacity="0.6" />
          <stop offset="0.5" stopColor={CRIMSON} stopOpacity="0.3" />
          <stop offset="1" stopColor={CRIMSON} stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* One gradient per rod, its axis re-aimed every frame. */}
      <defs ref={gradsRef}>
        {initial.edges.map((edge, i) => (
          <linearGradient
            key={i}
            id={`${id}-rod${i}`}
            gradientUnits="userSpaceOnUse"
            x1={edge.gx1.toFixed(2)}
            y1={edge.gy1.toFixed(2)}
            x2={edge.gx2.toFixed(2)}
            y2={edge.gy2.toFixed(2)}
          >
            <RodStops />
          </linearGradient>
        ))}
      </defs>

      <circle cx="50" cy="60" r="50" fill={`url(#${id}-glow)`} />
      <circle cx="50" cy="58" r="42" fill={`url(#${id}-pulse)`} className="logo-glow" />

      {/* Faces, far to near. */}
      <g ref={facesRef} stroke="none">
        {initial.faces.map((face, i) => (
          <polygon key={i} points={face.points} fill={face.fill} fillOpacity={face.opacity} />
        ))}
      </g>

      {/* Rods, far to near: a soft shadow, the cylinder, and a depth veil. */}
      <g ref={edgesRef} fill="none" strokeLinecap="round">
        {initial.edges.map((edge, i) => {
          const xy = { x1: edge.x1, y1: edge.y1, x2: edge.x2, y2: edge.y2 };
          return (
            <g key={i}>
              <line {...xy} stroke="#000000" strokeOpacity={0.2 + 0.35 * edge.depth} strokeWidth={edge.width * 1.15} transform="translate(0.9 1.4)" />
              <line {...xy} stroke={`url(#${id}-rod${i})`} strokeWidth={edge.width} />
              <line {...xy} stroke="#0a0608" strokeOpacity={0.6 * (1 - edge.depth)} strokeWidth={edge.width} />
            </g>
          );
        })}
      </g>
    </svg>
  );
}

interface LogoProps {
  /** Mark height in px. Ignored when `width` is given. */
  size?: number;
  /** Total width in px; every dimension is derived from it. */
  width?: number;
  variant?: LogoVariant;
  /** Hide the wordmark and show the mark alone (collapsed nav, favicons). */
  markOnly?: boolean;
  /** Swell and settle on a slow loop. Default on; off under reduced motion regardless. */
  breathe?: boolean;
  /** Turn the mark in 4-space. Default on; off under reduced motion regardless. */
  rotate?: boolean;
  className?: string;
}

/**
 * Mark plus wordmark. The wordmark uses the brand face declared on
 * `--font-brand` (see app/layout.tsx).
 */
export function Logo({
  size = 40,
  width,
  variant = "flat",
  markOnly = false,
  breathe = true,
  rotate = true,
  className,
}: LogoProps) {
  const id = svgId(useId());
  // Derive the font size either from the requested mark height or from the
  // total width the lockup may take.
  const f = width !== undefined && !markOnly ? width / LOCKUP_PER_F : size / MARK_PER_F;
  const mark = width !== undefined && !markOnly ? f * MARK_PER_F : size;
  const gap = mark * 0.28;
  const wordmarkWidth = f * WORDMARK_PER_F;
  const relief: CSSProperties = variant === "embossed" ? { filter: EMBOSS_FILTER } : {};

  return (
    <span
      className={[breathe ? "logo-breathing" : "", className].filter(Boolean).join(" ") || undefined}
      style={{ display: "inline-flex", alignItems: "center", gap, lineHeight: 1, whiteSpace: "nowrap" }}
    >
      <LogoMark size={mark} variant={variant} rotate={rotate} />
      {!markOnly && (
        // SVG text fitted to an exact box: `textLength` makes the browser lay
        // the word out to precisely this width by adjusting letter spacing
        // only (glyph shapes are never distorted), so a late-loading or
        // fallback font cannot push the wordmark past the container.
        <svg
          width={wordmarkWidth}
          height={f * 1.25}
          viewBox={`0 0 ${wordmarkWidth} ${f * 1.25}`}
          aria-label={WORDMARK}
          role="img"
          style={{ display: "block", overflow: "visible", flexShrink: 0, ...relief }}
        >
          <WordmarkDefs id={id} f={f} />
          <text
            x="0"
            y={f}
            fontFamily={WORDMARK_FONT}
            fontSize={f}
            fontWeight={400}
            fill={`url(#${id}-text)`}
            stroke="#000000"
            strokeOpacity="0.4"
            strokeWidth={f * 0.016}
            paintOrder="stroke fill"
            filter={`url(#${id}-metal)`}
            textLength={wordmarkWidth}
            lengthAdjust="spacing"
          >
            {WORDMARK}
          </text>
        </svg>
      )}
    </span>
  );
}
