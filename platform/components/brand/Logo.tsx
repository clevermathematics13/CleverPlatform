/**
 * CleverMathematics brand mark and wordmark.
 *
 * The mark is rebuilt as vector geometry from the supplied logo: a pointy-top
 * regular hexagon, a concentric inner hexagon, and six radial spokes joining
 * matching vertices - the classic hexagonal-frustum wireframe. Rebuilding it
 * as SVG (rather than embedding the raster) is what makes the material
 * treatment possible: every stroke and fill is drawn here, so the logo can be
 * lit like an object instead of tinted like an icon.
 *
 * Material. The logo is made of the same stuff as the lattice sphere on the
 * sign-in page - polished steel lit from above, maroon-to-crimson light from
 * below - but with a different geometry: where the sphere is a basket weave,
 * the mark's faces are a honeycomb (a hexagonal tessellation, which suits a
 * hexagonal mark) and its frame is rounded steel rods. Each rod is four
 * strokes: a shadow, a chrome-banded body, a white specular along its upper
 * edge and a crimson rim light along its lower edge, the crimson being the
 * floor light catching the underside of the metal exactly as it does on the
 * sphere's bars. The wordmark takes one vertical gradient: chrome down to a
 * dark horizon, then maroon warming to crimson and falling back to maroon -
 * the sphere's steel-above, crimson-below split in a single fill.
 *
 * Breathing. The lockup swells and settles by a few percent on a slow
 * ease-in-out loop, and the crimson glow behind the honeycomb brightens with
 * each swell, so the light appears to come from inside. Transform and
 * opacity only, so it composites off the main thread; off under
 * prefers-reduced-motion (globals.css). `breathe={false}` holds it still.
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
 * Gradient and pattern ids are made unique per instance with useId, because
 * the rail and a page can both render the logo and SVG ids are document-wide.
 */

import { useId, type CSSProperties, type SVGProps } from "react";

// Vertex geometry on a 100x100 box, centre (50,50). Pointy-top hexagon:
// vertices every 60deg starting from straight up.
const OUTER_R = 44;
const INNER_R = 24;

function hexPoints(r: number, cx = 50, cy = 50): [number, number][] {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (-90 + i * 60);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
}

const OUTER = hexPoints(OUTER_R);
const INNER = hexPoints(INNER_R);

const toPath = (pts: [number, number][]) =>
  pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ") + " Z";

const OUTER_PATH = toPath(OUTER);
const INNER_PATH = toPath(INNER);

const SPOKES = OUTER.map(([ox, oy], i) => {
  const [ix, iy] = INNER[i];
  return `M${ox.toFixed(2)} ${oy.toFixed(2)} L${ix.toFixed(2)} ${iy.toFixed(2)}`;
}).join(" ");

// Honeycomb tile. Pointy-top cells of radius CELL_R tile a rectangle of
// width sqrt(3)*R and height 3R with cell centres at (W/2, R) and at the
// tile's left and right edges at 2.5R; the two extra cells at -0.5R are the
// same edge cells wrapping in from the tile above, which the pattern would
// otherwise clip away.
const CELL_R = 4.6;
const CELL_W = Math.sqrt(3) * CELL_R;
const CELL_H = 3 * CELL_R;
const HONEYCOMB_CELLS = [
  [CELL_W / 2, CELL_R],
  [0, 2.5 * CELL_R],
  [CELL_W, 2.5 * CELL_R],
  [0, -0.5 * CELL_R],
  [CELL_W, -0.5 * CELL_R],
]
  .map(([cx, cy]) => toPath(hexPoints(CELL_R, cx, cy)))
  .join(" ");

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

/**
 * Shared gradients. Rendered inside each SVG that uses them (a `<defs>` in
 * one SVG is not visible to another), keyed by the instance id.
 */
function SteelDefs({ id }: { id: string }) {
  return (
    <defs>
      {/* Chrome banding along the rods, diagonal so every spoke catches it. */}
      <linearGradient id={`${id}-rod`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="100">
        <stop offset="0" stopColor="#eef0f3" />
        <stop offset="0.3" stopColor="#a9aeb6" />
        <stop offset="0.52" stopColor="#3f434a" />
        <stop offset="0.74" stopColor="#9096a0" />
        <stop offset="1" stopColor="#dcdfe4" />
      </linearGradient>
      {/* Crimson floor light rising through the honeycomb from below. */}
      <radialGradient id={`${id}-glow`} gradientUnits="userSpaceOnUse" cx="50" cy="82" r="62">
        <stop offset="0" stopColor={CRIMSON} />
        <stop offset="0.45" stopColor={MAROON} />
        <stop offset="1" stopColor={MAROON_DEEP} />
      </radialGradient>
      {/* The brighter pulse layered over it while the logo breathes in. */}
      <radialGradient id={`${id}-pulse`} gradientUnits="userSpaceOnUse" cx="50" cy="80" r="48">
        <stop offset="0" stopColor="#ff6b86" />
        <stop offset="0.6" stopColor={CRIMSON} stopOpacity="0.55" />
        <stop offset="1" stopColor={CRIMSON} stopOpacity="0" />
      </radialGradient>
      {/* Overhead sheen on the upper faces: the steel side of the split. */}
      <linearGradient id={`${id}-sheen`} gradientUnits="userSpaceOnUse" x1="30" y1="6" x2="60" y2="60">
        <stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
        <stop offset="0.45" stopColor="#ffffff" stopOpacity="0.12" />
        <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
      </linearGradient>
      {/* Honeycomb: a dark groove and a steel lip on every cell wall. */}
      <pattern id={`${id}-honey`} patternUnits="userSpaceOnUse" width={CELL_W} height={CELL_H}>
        <path d={HONEYCOMB_CELLS} fill="none" stroke="#000000" strokeOpacity="0.6" strokeWidth="1.1" />
        <path
          d={HONEYCOMB_CELLS}
          fill="none"
          stroke="#f2f3f5"
          strokeOpacity="0.42"
          strokeWidth="0.5"
          transform="translate(-0.3 -0.35)"
        />
      </pattern>
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

interface MarkProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  size?: number;
  variant?: LogoVariant;
  /** Stroke weight relative to the 100-unit box. The source mark is heavy. */
  weight?: number;
}

export function LogoMark({ size = 40, variant = "flat", weight = 8, style, ...rest }: MarkProps) {
  const id = svgId(useId());
  const relief: CSSProperties = variant === "embossed" ? { filter: EMBOSS_FILTER } : {};
  const rods = [OUTER_PATH, INNER_PATH, SPOKES].join(" ");
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
      <clipPath id={`${id}-face`}>
        <path d={OUTER_PATH} />
      </clipPath>

      {/* Faces: maroon light, the breathing pulse, the honeycomb, the sheen. */}
      <g clipPath={`url(#${id}-face)`}>
        <rect width="100" height="100" fill={`url(#${id}-glow)`} />
        <rect width="100" height="100" fill={`url(#${id}-pulse)`} className="logo-glow" />
        <rect width="100" height="100" fill={`url(#${id}-honey)`} />
        <rect width="100" height="100" fill={`url(#${id}-sheen)`} />
      </g>

      {/* Rods: shadow, chrome body, specular upper edge, crimson lower edge. */}
      <g fill="none" strokeLinejoin="round" strokeLinecap="round">
        <path d={rods} stroke="#000000" strokeOpacity="0.55" strokeWidth={weight} transform="translate(1.2 1.6)" />
        <path d={rods} stroke={`url(#${id}-rod)`} strokeWidth={weight} />
        <path
          d={rods}
          stroke="#ffffff"
          strokeOpacity="0.8"
          strokeWidth={weight * 0.26}
          transform="translate(-0.9 -1.1)"
        />
        <path
          d={rods}
          stroke={CRIMSON}
          strokeOpacity="0.45"
          strokeWidth={weight * 0.18}
          transform="translate(0.9 1.3)"
        />
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
      <LogoMark size={mark} variant={variant} />
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
