#!/usr/bin/env python3
"""Key the crimson studio backdrop out of public/sphere.mp4.

The sign-in orb (components/brand/Sphere.tsx) is a rendered woven sphere on a
crimson field. The field is baked into the pixels, so it used to be hidden by
cropping the video into a circle - which left the sphere sitting on a bright
crimson disc. This rewrites the file instead: everything outside the sphere
(wall, floor, cast shadow) becomes the page ground --color-da-bg, and the
sphere itself - INCLUDING the crimson seen through the holes in the weave - is
left exactly as rendered. The sphere then floats on the sign-in page with
nothing around it.

Why it is not a plain colour key: the crimson behind the lattice is the same
colour as the crimson around it, so keying by colour alone empties the sphere
too. Instead the sphere is LOCATED, not keyed. Its silhouette is found from
texture - the backdrop is a smooth gradient, the sphere is woven at every point
of its face - and because the subject is a sphere, that textured blob is
reduced to a circle: centre and area-equivalent radius. The cut is then a
clean circle, drawn a couple of pixels inside the weave's bumpy outline. An
earlier version keyed backdrop-coloured pixels right up to the bumps instead,
which kept the last sliver of every bump and gave the orb a ragged, fringed
edge; a circle through the weave reads as the sphere's own limb.

The circle is fitted on every frame, then the three parameters are smoothed
over time (the sphere pulses and drifts, but smoothly) so the edge cannot
shimmer from frame to frame. The loop is closed, so the smoothing wraps.

Usage (from platform/):
    pip install numpy scipy imageio-ffmpeg
    python3 scripts/sphere-backdrop.py <source.mp4> public/sphere.mp4

Re-run it against the ORIGINAL artwork, never against public/sphere.mp4 - that
file has already been keyed and has no crimson field left to locate the
sphere against.
"""
import subprocess
import sys

import numpy as np
from scipy import ndimage
from scipy.signal import savgol_filter

try:
    import imageio_ffmpeg
    FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
except ImportError:
    FFMPEG = "ffmpeg"

# The sign-in page's ground is --color-da-bg #0f0b0d = (15, 11, 13), but a
# frame does not survive the trip to the screen unchanged: it is stored as
# limited-range yuv420p and the browser converts it back, which lands on a
# coarser set of values than 8-bit RGB offers. Filling with the literal
# #0f0b0d renders in Chrome as (16, 12, 13) and filling one step higher, as a
# naive ffmpeg round trip suggests, renders as (18, 13, 14) - a square of
# lighter ground, plainly visible around the sphere. This value was picked by
# measuring what Chrome actually paints (see the note at the bottom of this
# file): it comes back as (15, 11, 13) on the sign-in page itself.
BG = np.array([14, 10, 12], dtype=np.float32)

# Local standard deviation of luminance, in 8-bit levels, above which a pixel
# counts as "woven" rather than "smooth backdrop".
TEXTURE_LEVEL = 6.0

# How far inside the fitted circle to cut, in pixels. The area-equivalent
# radius runs through the middle of the weave's bumps; two pixels further in
# the boundary is solid weave and no backdrop shows between bumps.
INSET = 2.0

# Width of the antialiased edge, in pixels.
EDGE = 1.5

# Temporal smoothing of the circle parameters: Savitzky-Golay window (frames)
# and polynomial order. Fit noise is a few tenths of a pixel; the sphere's own
# radius changes by up to ~6 px per frame while it pulses, which a quadratic
# over seven frames follows without lag.
SMOOTH_WINDOW = 7
SMOOTH_ORDER = 2


def disk(r):
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return (x * x + y * y) <= r * r


def texture(rgb):
    """Local standard deviation of luminance over a 9 px window."""
    lum = rgb.astype(np.float32) @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    mean = ndimage.uniform_filter(lum, 9)
    var = ndimage.uniform_filter(lum * lum, 9) - mean * mean
    return np.sqrt(np.maximum(var, 0.0))


def fit_circle(rgb):
    """(cx, cy, r) of the sphere: centroid and area-equivalent radius of the
    largest textured blob, closed across the lattice holes and hole-filled."""
    textured = ndimage.binary_opening(texture(rgb) > TEXTURE_LEVEL, disk(2))
    textured = ndimage.binary_closing(textured, disk(10))
    textured = ndimage.binary_fill_holes(textured)
    lab, n = ndimage.label(textured)
    if n == 0:
        raise SystemExit("no sphere found in a frame - is this the original artwork?")
    sizes = ndimage.sum(textured, lab, range(1, n + 1))
    ys, xs = np.nonzero(lab == int(np.argmax(sizes)) + 1)
    return xs.mean(), ys.mean(), np.sqrt(len(ys) / np.pi)


def smooth_loop(series):
    """Savitzky-Golay over a closed loop: pad with the wrapped ends so the
    first and last frames are smoothed against each other, not against
    nothing."""
    w = SMOOTH_WINDOW
    padded = np.concatenate([series[-w:], series, series[:w]])
    return savgol_filter(padded, w, SMOOTH_ORDER)[w:-w]


def cut(rgb, cx, cy, r):
    """Keep the disc, paint everything else the page ground. The edge is an
    analytic ramp EDGE pixels wide, so it is antialiased without blurring."""
    h, w = rgb.shape[:2]
    yy, xx = np.mgrid[:h, :w]
    dist = np.hypot(xx - cx, yy - cy)
    inside = np.clip((r - dist) / EDGE + 0.5, 0.0, 1.0)[..., None]
    return np.clip(rgb * inside + BG * (1 - inside), 0, 255).astype(np.uint8)


def probe(path):
    # ffmpeg with no output file reports the stream and exits non-zero; that
    # is the frame size, without needing ffprobe to be installed too.
    out = subprocess.run([FFMPEG, "-hide_banner", "-i", path],
                         capture_output=True, text=True).stderr
    for line in out.splitlines():
        if "Video:" in line:
            for token in line.split(","):
                token = token.strip().split(" ")[0]
                if "x" in token and token.replace("x", "").isdigit():
                    w, h = token.split("x")
                    return int(w), int(h)
    raise SystemExit(f"could not read frame size from {path}")


def main(src, dst):
    w, h = probe(src)
    raw = subprocess.run(
        [FFMPEG, "-v", "error", "-i", src, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        capture_output=True).stdout
    frames = np.frombuffer(raw, np.uint8).reshape(-1, h, w, 3)

    # Pass 1: locate the sphere on every frame, then smooth the path.
    circles = np.array([fit_circle(f) for f in frames])
    cx, cy, r = (smooth_loop(circles[:, k]) for k in range(3))
    r = r - INSET

    # Pass 2: cut and encode.
    enc = subprocess.Popen(
        [FFMPEG, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
         "-s", f"{w}x{h}", "-r", "25", "-i", "-", "-an",
         "-c:v", "libx264", "-preset", "slow", "-crf", "21",
         "-pix_fmt", "yuv420p", "-profile:v", "high",
         "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
         "-movflags", "+faststart", dst],
        stdin=subprocess.PIPE)
    for i, frame in enumerate(frames):
        enc.stdin.write(cut(frame.astype(np.float32), cx[i], cy[i], r[i]).tobytes())
    enc.stdin.close()
    enc.wait()
    print(f"{len(frames)} frames -> {dst}  (radius {r.min():.0f}..{r.max():.0f} px)")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])


# How BG was calibrated, if the palette or the codec settings ever change:
# encode a few seconds of a flat candidate colour with the encoder settings
# used above, put the file in a page whose background is the CSS colour, load
# it in the target browser and read the two colours off a screenshot. Chrome's
# yuv420p -> RGB conversion is not ffmpeg's, so decoding the file with ffmpeg
# and comparing there will agree with itself and still leave a visible square
# in the browser. Candidates land on a coarse lattice of output values; take
# the one whose miss is smallest and on the least visible channel.
