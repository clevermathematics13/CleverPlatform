"use client";

/**
 * The lattice sphere as a background presence: drifting slowly, breathing.
 *
 * Two deliberate departures from Sphere.tsx's own design notes, both taken on
 * the teacher's instruction and worth knowing about before copying this
 * anywhere else:
 *
 * 1. That file says the sphere "does not loop inside the working dashboard,
 *    where motion competes with reading". This is the working dashboard. The
 *    motion is therefore made as close to subliminal as it can be while still
 *    being motion: a ~34s drift and a ~11s breath, low opacity, heavily
 *    blurred, behind everything and ignoring the pointer. Nothing on this
 *    page moves in the reader's fovea.
 *
 * 2. It renders the CSS orb, not the video (`still`). The video's backdrop is
 *    baked into its pixels and keyed to `--color-da-bg`; the dashboard paints
 *    that colour but then lays MandelbrotBg over it, so the video would show
 *    as a dark square on a textured ground. The orb is transparent and
 *    composites correctly over anything.
 *
 * Both animations are CSS, so `prefers-reduced-motion` switches them off in
 * globals.css rather than through a media-query listener here -- a reader who
 * has asked for stillness gets a static orb, which is exactly the artwork.
 */

import { Sphere } from "@/components/brand/Sphere";

export function AmbientSphere({
  size = 520,
  className,
}: {
  size?: number | string;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={["ambient-sphere", className].filter(Boolean).join(" ")}
    >
      <div className="ambient-sphere__drift">
        <div className="ambient-sphere__breathe">
          <Sphere size={size} still />
        </div>
      </div>
    </div>
  );
}
