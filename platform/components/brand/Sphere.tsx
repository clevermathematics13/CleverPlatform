"use client";

/**
 * The lattice sphere.
 *
 * The supplied artwork is a black woven sphere rotating on a crimson field.
 * The field is baked into the pixels, so it cannot be cut out - it has to be
 * either embraced or cropped. This crops: a circular mask sized just past the
 * sphere's silhouette turns the square frame into an orb with a thin crimson
 * rim, which sits cleanly on the dark palette (the rim IS the accent colour)
 * and reads as a single focal object rather than a pasted rectangle.
 *
 * Design intent: one animated focal object per surface, at most. It lives on
 * the sign-in page (the platform's only "front door"); it does not loop inside
 * the working dashboard, where motion competes with reading.
 *
 * The animation is an MP4 (H.264), not a GIF. A GIF of this loop was 13 MB
 * because GIF stores every frame as a near-complete 256-colour image; the
 * video codec stores only what changes between frames and weighs 1.6 MB at
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
  /** Rim colour around the orb; defaults to the artwork's crimson. */
  rim?: string;
}

export function Sphere({ size = 320, className, rim = "#c8103f" }: Props) {
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
            transform: "scale(1.06)",
          }}
        />
      )}
    </div>
  );
}
