"use client";

/**
 * The lattice sphere.
 *
 * The supplied artwork is a black woven sphere rotating on a crimson studio
 * field, and the field is baked into the pixels. It used to be hidden with a
 * circular mask sized just past the silhouette, which turned the square frame
 * into an orb with a thin crimson rim. The field is now keyed out of the file
 * itself: every pixel of backdrop - the wall, the floor and the cast shadow,
 * but NOT the crimson seen through the weave - is replaced with the sign-in
 * page's ground, so the sphere sits directly on the page with nothing around
 * it. See `platform/scripts/sphere-backdrop.py` for how the asset was made and
 * how to redo it if the artwork or the palette changes.
 *
 * That fill is opaque, not transparent (H.264 has no alpha channel), and it is
 * the value that RENDERS as `--color-da-bg` after the browser's yuv420p ->
 * RGB conversion, which is a step or two off the pixels that went in. The
 * video therefore disappears only into a surface actually painted
 * `--color-da-bg` - which the sign-in page is. On the body gradient, on a
 * card, or on any tinted surface it would show as a dark square.
 *
 * Design intent: one animated focal object per surface, at most. It lives on
 * the sign-in page (the platform's only "front door"); it does not loop inside
 * the working dashboard, where motion competes with reading.
 *
 * The animation is an MP4 (H.264), not a GIF. A GIF of this loop was 13 MB
 * because GIF stores every frame as a near-complete 256-colour image; the
 * video codec stores only what changes between frames and weighs 1.5 MB at
 * higher colour fidelity. A muted, looping, inline video with no controls is
 * indistinguishable from a GIF to the viewer.
 *
 * Loading rules:
 * - The element is rendered with `preload="none"` and WITHOUT `autoplay`, so
 *   server rendering never issues a request for the file. Playback (and so
 *   the download) starts only from the effect below, which checks
 *   `prefers-reduced-motion` first. A reduced-motion user never downloads it
 *   and sees the static orb; unlike a GIF, nothing has to be withheld by
 *   markup tricks because a video simply is not told to play.
 * - The static orb is drawn in CSS underneath and shows until the first frame
 *   paints, and permanently if the file is missing or fails to decode.
 *
 * The artwork lives at `platform/public/sphere.mp4`.
 */

import { useEffect, useRef, useState } from "react";

interface Props {
  size?: number;
  className?: string;
  /** Crimson of the artwork, used by the static orb; defaults to the lattice's. */
  accent?: string;
}

export function Sphere({ size = 320, className, accent = "#c8103f" }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const motionOk = window.matchMedia("(prefers-reduced-motion: no-preference)");
    const start = () => {
      if (!motionOk.matches) return;
      video.play().catch(() => {
        // Autoplay refused (rare for a muted inline video) or decode error:
        // the static orb underneath is the intended state, nothing to do.
      });
    };
    const onChange = () => {
      if (motionOk.matches) start();
      else video.pause();
    };
    start();
    motionOk.addEventListener("change", onChange);
    return () => motionOk.removeEventListener("change", onChange);
  }, []);

  return (
    <div
      className={className}
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        position: "relative",
        flexShrink: 0,
      }}
    >
      {/* Static orb: a CSS echo of the artwork (lattice over a crimson-lit
          sphere). Inset, because the rendered sphere does not reach the edges
          of its frame either. */}
      <div
        style={{
          position: "absolute",
          inset: "6%",
          borderRadius: "50%",
          background:
            "radial-gradient(circle at 38% 30%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.08) 22%, rgba(0,0,0,0) 40%)," +
            `radial-gradient(circle at 50% 76%, ${accent} 0%, #7a0a2a 42%, #12060a 78%, #0a0308 100%)`,
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
              "repeating-linear-gradient(0deg, transparent 0 9px, rgba(0,0,0,0.85) 9px 11px)," +
              "repeating-linear-gradient(90deg, transparent 0 13px, rgba(0,0,0,0.9) 13px 15px)",
            maskImage: "radial-gradient(circle, #000 55%, transparent 72%)",
            WebkitMaskImage: "radial-gradient(circle, #000 55%, transparent 72%)",
            opacity: 0.85,
          }}
        />
      </div>

      {!failed && (
        <video
          ref={videoRef}
          src="/sphere.mp4"
          muted
          loop
          playsInline
          preload="none"
          disablePictureInPicture
          disableRemotePlayback
          onError={() => setFailed(true)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      )}
    </div>
  );
}
