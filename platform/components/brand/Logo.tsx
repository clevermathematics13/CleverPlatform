/**
 * CleverMathematics brand mark and wordmark.
 *
 * The mark is rebuilt as vector geometry from the supplied logo: a pointy-top
 * regular hexagon, a concentric inner hexagon, and six radial spokes joining
 * matching vertices - the classic hexagonal-frustum wireframe. Rebuilding it
 * as SVG (rather than embedding the raster) is what makes the emboss
 * treatment possible: the strokes take `currentColor`, so one component reads
 * correctly on any surface the palette defines, and the relief is done with
 * light and shadow offsets rather than baked pixels.
 *
 * `variant="embossed"` renders the logo as if pressed up out of the surface:
 * a faint highlight cast up-left, a deeper shadow cast down-right, and the
 * stroke itself lifted one step above the surface tone. Because both offsets
 * are relative (white and black at low alpha) it holds on any dark ground.
 *
 * Sizing. Two ways to size the logo, and they must not be mixed:
 *   - `size`: the mark's height in px; the wordmark follows at 0.62x. Use it
 *     where the container is comfortably wider than the logo (sign-in card).
 *   - `width`: the TOTAL width the logo may occupy. Every dimension is derived
 *     from it and the wordmark is an SVG text fitted to its exact box, so the
 *     logo can never overflow or clip, whatever font is loaded. Use it in
 *     constrained chrome (the navigation rail), where the first version of
 *     this component was cut off at "CleverMathematic".
 */

import type { CSSProperties, SVGProps } from "react";

// Vertex geometry on a 100x100 box, centre (50,50). Pointy-top hexagon:
// vertices every 60deg starting from straight up.
const OUTER_R = 44;
const INNER_R = 24;

function hexPoints(r: number): [number, number][] {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (-90 + i * 60);
    return [50 + r * Math.cos(a), 50 + r * Math.sin(a)];
  });
}

const OUTER = hexPoints(OUTER_R);
const INNER = hexPoints(INNER_R);

const toPath = (pts: [number, number][]) =>
  pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ") + " Z";

const SPOKES = OUTER.map(([ox, oy], i) => {
  const [ix, iy] = INNER[i];
  return `M${ox.toFixed(2)} ${oy.toFixed(2)} L${ix.toFixed(2)} ${iy.toFixed(2)}`;
}).join(" ");

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

interface MarkProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  size?: number;
  variant?: LogoVariant;
  /** Stroke weight relative to the 100-unit box. The source mark is heavy. */
  weight?: number;
}

export function LogoMark({ size = 40, variant = "flat", weight = 7, style, ...rest }: MarkProps) {
  const relief: CSSProperties = variant === "embossed" ? { filter: EMBOSS_FILTER } : {};
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={weight}
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
      style={{ ...relief, ...style }}
      {...rest}
    >
      <path d={toPath(OUTER)} />
      <path d={toPath(INNER)} />
      <path d={SPOKES} />
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
  className?: string;
}

/**
 * Mark plus wordmark. The wordmark uses the brand face declared on
 * `--font-brand` (see app/layout.tsx).
 */
export function Logo({ size = 40, width, variant = "flat", markOnly = false, className }: LogoProps) {
  // Derive the font size either from the requested mark height or from the
  // total width the lockup may take.
  const f = width !== undefined && !markOnly ? width / LOCKUP_PER_F : size * 0.62;
  const mark = width !== undefined && !markOnly ? f * MARK_PER_F : size;
  const gap = mark * 0.32;
  const wordmarkWidth = f * WORDMARK_PER_F;
  const relief: CSSProperties = variant === "embossed" ? { filter: EMBOSS_FILTER } : {};

  return (
    <span
      className={className}
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
          <text
            x="0"
            y={f}
            fontFamily={WORDMARK_FONT}
            fontSize={f}
            fontWeight={400}
            fill="currentColor"
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
