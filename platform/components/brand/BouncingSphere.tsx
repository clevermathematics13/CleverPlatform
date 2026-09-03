"use client";

/**
 * The lattice sphere as a bouncing ball.
 *
 * A fixed layer along the bottom of the viewport. The sphere comes in from
 * beyond the right edge, crosses the screen in gravity-shaped hops off the
 * floor, leaves past the left edge, turns round out of sight and comes back -
 * for as long as the page is open. Three nested transforms, each one plain
 * CSS keyframes in globals.css so nothing runs on the main thread:
 *
 *   travel  - linear left-right motion, `animation-direction: alternate`
 *   bounce  - the hop: ease-out rising, ease-in falling, so it decelerates
 *             to the apex and accelerates into the floor like a real ball
 *   squash  - the impact: wider and shorter on the floor, a touch taller
 *             just before and after, from a bottom-centre origin
 *
 * A crimson pool of light on the floor under the ball brightens and spreads
 * on each impact, the way the original artwork's crimson field lit the floor
 * under the sphere. The video itself is opaque, so the pool is painted behind
 * it and only its lower half shows while the ball is down.
 *
 * The ball's contact point is the video frame's bottom edge: the asset is
 * registered so the sphere's bottom rests there on every frame (see
 * scripts/sphere-backdrop.py, FLOOR_MARGIN). Without that the sphere would
 * bounce on empty air in the phases of its loop where it floats high in the
 * frame.
 *
 * Reduced motion: the animations are off and the ball rests near the
 * bottom-left corner. Sphere.tsx separately keeps the video itself from
 * playing for those viewers.
 *
 * Sizing and timing are the CSS custom properties on `.bouncing-sphere`.
 */

import { Sphere } from "@/components/brand/Sphere";

export function BouncingSphere({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={["bouncing-sphere", className].filter(Boolean).join(" ")}>
      <div className="bouncing-sphere__travel">
        <div className="bouncing-sphere__glow" />
        <div className="bouncing-sphere__bounce">
          <div className="bouncing-sphere__squash">
            <Sphere size="var(--ball)" />
          </div>
        </div>
      </div>
    </div>
  );
}
