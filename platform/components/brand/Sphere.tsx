"use client";

/**
 * The lattice sphere.
 *
 * The supplied artwork is an animated GIF of a black woven sphere on a
 * crimson field. The field is baked into the pixels, so it cannot be cut
 * out - it has to be either embraced or cropped. This crops: a circular
 * mask sized just past the sphere's silhouette turns the square frame into
 * an orb with a thin crimson rim, which sits cleanly on any dark palette and
 * reads as a single focal object rather than a pasted rectangle.
 *
 * Design intent: one animated focal object per surface, at most. It lives
 * on the login page (the platform's only "front door"); it does not loop
 * inside the working dashboard, where motion competes with reading.
 *
 * - `prefers-reduced-motion`: the GIF is never requested. The <picture>
 *   element's media-queried <source> is the only place the GIF URL appears,
 *   so a browser with the preference set skips the request entirely and
 *   the <img> resolves to a transparent pixel over the static orb. This is
 *   decided by the browser at first paint, not by JavaScript after
 *   hydration, so server rendering never leaks the GIF to such users.
 * - Missing file (`/public/sphere.gif` not yet added): the same static orb
 *   renders, drawn in CSS to echo the artwork's palette and lattice, so the
 *   layout is never broken by an absent asset.
 *
 * Drop the artwork at `platform/public/sphere.gif`.
 */

import { useState } from "react";

/** 1x1 transparent GIF: what the <img> shows when no <source> is chosen. */
const TRANSPARENT_PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

interface Props {
  size?: number;
  className?: string;
  /** Rim colour around the orb; defaults to the artwork's crimson. */
  rim?: string;
}

export function Sphere({ size = 320, className, rim = "#c8103f" }: Props) {
  const [failed, setFailed] = useState(false);

  return (
    <div
      className={className}
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        overflow: "hidden",
        position: "relative",
        flexShrink: 0,
        boxShadow: `0 0 0 1px ${rim}55, 0 0 0 6px ${rim}18, 0 30px 80px -20px ${rim}66, 0 20px 40px -20px rgba(0,0,0,0.8)`,
        background: `radial-gradient(circle at 35% 30%, ${rim} 0%, #7a0a2a 55%, #2a0410 100%)`,
      }}
    >
      {/* Static orb: a CSS echo of the artwork (lattice over a lit sphere). */}
      <div
        style={{
          position: "absolute",
          inset: "6%",
          borderRadius: "50%",
          background:
            "radial-gradient(circle at 38% 32%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.08) 22%, rgba(0,0,0,0) 40%)," +
            "radial-gradient(circle at 50% 50%, #1a1a1a 0%, #0a0a0a 70%, #000 100%)",
          backgroundBlendMode: "screen, normal",
          boxShadow: "inset -18px -24px 40px rgba(0,0,0,0.85), inset 10px 12px 24px rgba(255,255,255,0.06)",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            backgroundImage:
              `repeating-linear-gradient(0deg, transparent 0 9px, ${rim}99 9px 11px),` +
              "repeating-linear-gradient(90deg, transparent 0 13px, rgba(0,0,0,0.9) 13px 15px)",
            maskImage: "radial-gradient(circle, #000 55%, transparent 72%)",
            WebkitMaskImage: "radial-gradient(circle, #000 55%, transparent 72%)",
            opacity: 0.85,
          }}
        />
      </div>

      {!failed && (
        <picture>
          <source media="(prefers-reduced-motion: no-preference)" srcSet="/sphere.gif" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={TRANSPARENT_PIXEL}
            alt=""
            onError={() => setFailed(true)}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: "scale(1.06)",
            }}
          />
        </picture>
      )}
    </div>
  );
}
