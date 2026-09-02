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
 * `variant="embossed"` renders the mark as if pressed up out of the surface:
 * a faint highlight cast up-left, a deeper shadow cast down-right, and the
 * stroke itself lifted one step above the surface tone. Because both offsets
 * are relative (white and black at low alpha) it holds on every palette
 * direction under consideration, light or dark.
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

interface MarkProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  size?: number;
  variant?: LogoVariant;
  /** Stroke weight relative to the 100-unit box. The source mark is heavy. */
  weight?: number;
}

/** Emboss relief: light cast up-left, shadow cast down-right. */
const EMBOSS_FILTER =
  "drop-shadow(-1px -1px 0 rgba(255,255,255,0.22)) drop-shadow(1px 1px 0 rgba(0,0,0,0.65)) drop-shadow(0 2px 3px rgba(0,0,0,0.35))";

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
  size?: number;
  variant?: LogoVariant;
  /** Hide the wordmark and show the mark alone (collapsed nav, favicons). */
  markOnly?: boolean;
  className?: string;
}

/**
 * Mark plus wordmark. The wordmark uses the brand face declared on
 * `--font-brand` (see app/layout.tsx); the fallbacks are chosen for similar
 * width so an unstyled flash does not reflow the header.
 */
export function Logo({ size = 40, variant = "flat", markOnly = false, className }: LogoProps) {
  const relief: CSSProperties =
    variant === "embossed"
      ? { textShadow: "-1px -1px 0 rgba(255,255,255,0.18), 1px 1px 0 rgba(0,0,0,0.6)" }
      : {};
  return (
    <span
      className={className}
      style={{ display: "inline-flex", alignItems: "center", gap: size * 0.32, lineHeight: 1 }}
    >
      <LogoMark size={size} variant={variant} />
      {!markOnly && (
        <span
          style={{
            fontFamily: "var(--font-brand), 'Audiowide', 'Orbitron', 'Exo 2', ui-sans-serif, sans-serif",
            fontSize: size * 0.62,
            fontWeight: 400,
            letterSpacing: "0.005em",
            whiteSpace: "nowrap",
            ...relief,
          }}
        >
          CleverMathematics
        </span>
      )}
    </span>
  );
}
