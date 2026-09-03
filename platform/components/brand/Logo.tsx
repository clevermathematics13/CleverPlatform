"use client";

/**
 * CleverMathematics brand mark and wordmark.
 *
 * The mark is a tesseract - a four-dimensional hypercube - turning very
 * slowly. Its 16 vertices, 32 edges and 24 square faces are rotated in two
 * planes of 4-space on a clock that takes minutes per revolution, projected
 * to 3-space with perspective (which is what nests the inner cube inside the
 * outer one: the far side in W shrinks), tilted, and projected again to the
 * page. The nested-cube figure it makes is the hypercube's own shadow, the
 * same one the old hexagonal frustum mark was a flat sketch of.
 *
 * Material. The logo is made of the same stuff as the lattice sphere on the
 * sign-in page - polished steel lit from above, maroon-to-crimson light from
 * below - but with a different geometry: cells instead of a weave. Each edge
 * is a rounded steel rod drawn as four strokes (a shadow, a chrome body, a
 * white specular along its upper edge, a crimson rim light along its lower
 * edge - the floor light catching the underside of the metal, as on the
 * sphere's bars), and each is shaded by depth: near rods are bright, thick
 * and sharply lit, far rods dark, thin and dim. The faces are panes of
 * maroon glass lit from upper-left-front, darkening as they turn away, and
 * painted far to near so the cells read as volumes. A pool of maroon light
 * sits behind the whole figure. The wordmark takes one vertical gradient:
 * chrome down to a dark horizon, then maroon warming to crimson and back -
 * the sphere's steel-above, crimson-below split in a single fill.
 *
 * Motion. Two things move, both gently. The rotation is a requestAnimation-
 * Frame loop, throttled to ~30 fps, that writes the projected geometry
 * straight onto the SVG elements - React renders the figure once, at t = 0
 * (so server HTML carries a proper static tesseract), and never re-renders
 * for it. The clock is wall time, so every instance on a page turns in
 * phase. Independently, the lockup swells and settles by a few percent on a
 * slow ease-in-out loop (CSS, globals.css) while the light behind the mark
 * brightens with each swell. Both are off under prefers-reduced-motion:
 * `rotate={false}` and `breathe={false}` hold them still individually.
 *
 * `variant="embossed"` adds the relief - a faint highlight cast up-left, a
 * deeper shadow cast down-right - that presses the logo up out of whatever
 * surface it sits on.
 *
 * Sizing. Two ways to size the logo, and they must not be mixed:
 *   - `size`: the mark's height in px; the wordmark follows at 0.62x. Use it
 *     where the container is comfortably wider than the logo (sign-in card).
 *   - `width`: the TOTAL width the logo may occupy. Every dimension is derived
 *     from it and the wordmark is an SVG text fitted to its exact box, so the
 *     logo can never overflow or clip, whatever font is loaded. Use it in
 *     constrained chrome (the navigation rail), where the first version of
 *     this component was cut off at "CleverMathematic".
 *
 * Gradient ids are made unique per instance with useId, because the rail
 * and a page can both render the logo and SVG ids are document-wide.
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

// Seconds per revolution in each of the two rotating planes: about two
// degrees a second, so the turn is felt rather than watched. Unequal and not
// in a simple ratio, so the figure never quite repeats a pose.
const PERIOD_XW = 190;
const PERIOD_YZ = 310;
// Fixed tilt of the projected 3-space, so the cube is seen from above and
// to the side rather than face-on.
const TILT_X = (22 * Math.PI) / 180;
const TILT_Y = (-28 * Math.PI) / 180;
// Perspective distances. 4D->3D is what nests the inner cube; 3D->2D is
// kept mild so the figure's size stays steady as it turns.
const D4 = 3.4;
const D3 = 7;
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
  return 44 / extent;
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

const STEEL_FAR: [number, number, number] = [0x2b, 0x2e, 0x34];
const STEEL_NEAR: [number, number, number] = [0xf0, 0xf2, 0xf5];
const MAROON_FAR: [number, number, number] = [0x2a, 0x04, 0x10];
const MAROON_LIT: [number, number, number] = [0xe0, 0x40, 0x5f];

interface FaceDraw { points: string; fill: string; opacity: number }
interface EdgeDraw { x1: number; y1: number; x2: number; y2: number; depth: number }

function frame(t: number): { faces: FaceDraw[]; edges: EdgeDraw[] } {
  const [a, b] = angles(t);
  const v = project(a, b, SCALE);
  const faces = FACES.map((idx) => {
    const p = idx.map((i) => v[i]);
    const [a, b, c] = [p[0].p3, p[1].p3, p[3].p3];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const nl = Math.hypot(n[0], n[1], n[2]) || 1;
    // Two-sided: a pane lit from behind still glows, just less.
    const lit = 0.5 + 0.5 * Math.abs((n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]) / nl);
    const depth = p.reduce((s, q) => s + q.depth, 0) / 4;
    return {
      depth,
      points: p.map((q) => `${q.x.toFixed(2)},${q.y.toFixed(2)}`).join(" "),
      fill: mix(MAROON_FAR, MAROON_LIT, lit * (0.35 + 0.65 * depth)),
      opacity: 0.18 + 0.3 * depth,
    };
  });
  faces.sort((f, g) => f.depth - g.depth);
  const edges = EDGES.map(([i, j]) => ({
    x1: v[i].x, y1: v[i].y, x2: v[j].x, y2: v[j].y,
    depth: (v[i].depth + v[j].depth) / 2,
  }));
  edges.sort((e, f) => e.depth - f.depth);
  return { faces, edges };
}

/** The four strokes of one rod, given its depth and the base weight. */
function rodStyle(depth: number, weight: number) {
  const d = Math.max(0, Math.min(1, depth));
  const w = weight * (0.55 + 0.6 * d);
  return {
    width: w,
    body: mix(STEEL_FAR, STEEL_NEAR, Math.pow(d, 1.15)),
    highlight: 0.12 + 0.7 * d,
    rim: 0.15 + 0.4 * d,
    shadow: 0.25 + 0.35 * d,
  };
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
//   mark height = f / 0.62, gap = 0.32 x mark, wordmark width ~ 10.6 f (Audiowide).
const MARK_PER_F = 1 / 0.62;
const GAP_PER_F = 0.32 * MARK_PER_F;
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

/**
 * Shared gradients. Rendered inside each SVG that uses them (a `<defs>` in
 * one SVG is not visible to another), keyed by the instance id.
 */
function SteelDefs({ id }: { id: string }) {
  return (
    <defs>
      {/* Pool of crimson light behind the figure, fading to nothing. */}
      <radialGradient id={`${id}-glow`} gradientUnits="userSpaceOnUse" cx="50" cy="60" r="50">
        <stop offset="0" stopColor={MAROON} />
        <stop offset="0.55" stopColor={MAROON_DEEP} stopOpacity="0.8" />
        <stop offset="1" stopColor={MAROON_DEEP} stopOpacity="0" />
      </radialGradient>
      {/* The brighter pulse layered over it while the logo breathes in. */}
      <radialGradient id={`${id}-pulse`} gradientUnits="userSpaceOnUse" cx="50" cy="58" r="42">
        <stop offset="0" stopColor="#ff6b86" stopOpacity="0.9" />
        <stop offset="0.5" stopColor={CRIMSON} stopOpacity="0.4" />
        <stop offset="1" stopColor={CRIMSON} stopOpacity="0" />
      </radialGradient>
      {/* Wordmark: chrome above a dark horizon, maroon warming to crimson below. */}
      <linearGradient id={`${id}-text`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fafbfc" />
        <stop offset="0.2" stopColor="#d9dce1" />
        <stop offset="0.42" stopColor="#868c94" />
        <stop offset="0.5" stopColor="#3d4046" />
        <stop offset="0.54" stopColor={MAROON} />
        <stop offset="0.72" stopColor="#d42a4e" />
        <stop offset="0.88" stopColor="#8e1233" />
        <stop offset="1" stopColor="#4a0819" />
      </linearGradient>
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
  const facesRef = useRef<SVGGElement>(null);
  const edgesRef = useRef<SVGGElement>(null);
  const relief: CSSProperties = variant === "embossed" ? { filter: EMBOSS_FILTER } : {};
  const initial = frame(0);

  useEffect(() => {
    if (!rotate || reducedMotion()) return;
    const faces = facesRef.current;
    const edges = edgesRef.current;
    if (!faces || !edges) return;
    const polygons = Array.from(faces.children) as SVGPolygonElement[];
    const rods = Array.from(edges.children) as SVGGElement[];
    let last = 0;
    let handle = 0;
    const tick = (now: number) => {
      handle = requestAnimationFrame(tick);
      if (now - last < 1000 / FRAME_RATE) return;
      last = now;
      const f = frame(Date.now() / 1000);
      f.faces.forEach((face, i) => {
        const el = polygons[i];
        el.setAttribute("points", face.points);
        el.setAttribute("fill", face.fill);
        el.setAttribute("fill-opacity", face.opacity.toFixed(3));
      });
      f.edges.forEach((edge, i) => {
        const s = rodStyle(edge.depth, weight);
        const lines = rods[i].children as HTMLCollectionOf<SVGLineElement>;
        for (let k = 0; k < 4; k++) {
          const l = lines[k];
          l.setAttribute("x1", edge.x1.toFixed(2));
          l.setAttribute("y1", edge.y1.toFixed(2));
          l.setAttribute("x2", edge.x2.toFixed(2));
          l.setAttribute("y2", edge.y2.toFixed(2));
        }
        lines[0].setAttribute("stroke-width", s.width.toFixed(2));
        lines[0].setAttribute("stroke-opacity", s.shadow.toFixed(3));
        lines[1].setAttribute("stroke-width", s.width.toFixed(2));
        lines[1].setAttribute("stroke", s.body);
        lines[2].setAttribute("stroke-width", (s.width * 0.26).toFixed(2));
        lines[2].setAttribute("stroke-opacity", s.highlight.toFixed(3));
        lines[3].setAttribute("stroke-width", (s.width * 0.2).toFixed(2));
        lines[3].setAttribute("stroke-opacity", s.rim.toFixed(3));
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
      <SteelDefs id={id} />
      <circle cx="50" cy="60" r="50" fill={`url(#${id}-glow)`} />
      <circle cx="50" cy="58" r="42" fill={`url(#${id}-pulse)`} className="logo-glow" />

      {/* Faces, far to near. */}
      <g ref={facesRef} stroke="none">
        {initial.faces.map((face, i) => (
          <polygon key={i} points={face.points} fill={face.fill} fillOpacity={face.opacity} />
        ))}
      </g>

      {/* Rods, far to near: shadow, chrome body, specular upper edge, crimson lower edge. */}
      <g ref={edgesRef} fill="none" strokeLinecap="round">
        {initial.edges.map((edge, i) => {
          const s = rodStyle(edge.depth, weight);
          const xy = { x1: edge.x1, y1: edge.y1, x2: edge.x2, y2: edge.y2 };
          return (
            <g key={i}>
              <line {...xy} stroke="#000000" strokeOpacity={s.shadow} strokeWidth={s.width} transform="translate(0.9 1.3)" />
              <line {...xy} stroke={s.body} strokeWidth={s.width} />
              <line {...xy} stroke="#ffffff" strokeOpacity={s.highlight} strokeWidth={s.width * 0.26} transform="translate(-0.6 -0.8)" />
              <line {...xy} stroke={CRIMSON} strokeOpacity={s.rim} strokeWidth={s.width * 0.2} transform="translate(0.6 0.9)" />
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
  const f = width !== undefined && !markOnly ? width / LOCKUP_PER_F : size * 0.62;
  const mark = width !== undefined && !markOnly ? f * MARK_PER_F : size;
  const gap = mark * 0.32;
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
          <SteelDefs id={id} />
          <text
            x="0"
            y={f}
            fontFamily={WORDMARK_FONT}
            fontSize={f}
            fontWeight={400}
            fill={`url(#${id}-text)`}
            stroke="#000000"
            strokeOpacity="0.35"
            strokeWidth={f * 0.018}
            paintOrder="stroke fill"
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
