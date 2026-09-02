#!/usr/bin/env python3
"""Key the crimson studio backdrop out of public/sphere.mp4.

The sign-in orb (components/brand/Sphere.tsx) is a rendered woven sphere on a
crimson field. The field is baked into the pixels, so it used to be hidden by
cropping the video into a circle - which left the sphere sitting on a bright
crimson disc. This rewrites the file instead: every backdrop pixel (wall,
floor, cast shadow) becomes the page ground --color-da-bg, while the sphere,
INCLUDING the crimson seen through the holes in the weave, is left exactly as
rendered. The sphere then floats on the sign-in page with nothing around it.

Why it is not a plain colour key: the crimson behind the lattice is the same
colour as the crimson around it, so keying by colour alone empties the sphere
too. The separation used here is texture, not colour - the backdrop is a
smooth gradient, the sphere is woven at every point of its face - and since
the subject is a sphere, the textured blob is fitted with a circle, which
survives the frames where the weave is too dim to register. Colour then
decides what actually gets replaced inside that region, so a slightly wrong
silhouette can only ever mis-handle backdrop-coloured pixels.

Usage (from platform/):
    pip install numpy scipy imageio-ffmpeg
    python3 scripts/sphere-backdrop.py <source.mp4> public/sphere.mp4

Re-run it against the ORIGINAL artwork, never against public/sphere.mp4 - that
file has already been keyed and has no crimson field left to find.
"""
import subprocess
import sys

import numpy as np
from scipy import ndimage

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
# file): it comes back as (15, 11, 12), one step low on blue at near-black,
# which no eye resolves.
BG = np.array([14, 10, 12], dtype=np.float32)

# Local standard deviation of luminance, in 8-bit levels, above which a pixel
# counts as "woven" rather than "smooth backdrop".
TEXTURE_LEVEL = 6.0


def disk(r):
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return (x * x + y * y) <= r * r


def crimsonness(rgb):
    """0..1 measure of "saturated red field": ~0 on the black bars and the
    white highlights, 0.6-0.9 on the crimson."""
    r = rgb[..., 0].astype(np.float32)
    g = rgb[..., 1].astype(np.float32)
    b = rgb[..., 2].astype(np.float32)
    return np.clip((r - np.maximum(g, b * 0.6)) / 255.0, 0.0, 1.0)


def texture(rgb):
    """Local standard deviation of luminance over a 9 px window."""
    lum = rgb.astype(np.float32) @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    mean = ndimage.uniform_filter(lum, 9)
    var = ndimage.uniform_filter(lum * lum, 9) - mean * mean
    return np.sqrt(np.maximum(var, 0.0))


def sphere_disc(sd):
    """Circle covering the sphere, fitted to the textured blob."""
    textured = ndimage.binary_opening(sd > TEXTURE_LEVEL, disk(2))
    textured = ndimage.binary_closing(textured, disk(10))
    lab, n = ndimage.label(textured)
    if n == 0:
        return np.zeros(sd.shape, bool)
    sizes = ndimage.sum(textured, lab, range(1, n + 1))
    ys, xs = np.nonzero(lab == int(np.argmax(sizes)) + 1)
    cy, cx = ys.mean(), xs.mean()
    # 99.9th percentile rather than the maximum so one stray textured speck
    # cannot inflate the circle; +3 px covers the weave's bumpy outline.
    r = np.percentile(np.hypot(ys - cy, xs - cx), 99.9) + 3.0
    yy, xx = np.ogrid[:sd.shape[0], :sd.shape[1]]
    return (yy - cy) ** 2 + (xx - cx) ** 2 <= r * r


def backdrop(sd, t):
    """Region to repaint: everything outside the fitted circle, grown into any
    smooth crimson still inside it (the sliver of field between the circle and
    the sphere's bumpy outline). The weave blocks that growth, so the crimson
    seen through the lattice is never reached."""
    outside = ~sphere_disc(sd)
    fillable = outside | ((sd < TEXTURE_LEVEL) & (t > 0.10))
    lab, n = ndimage.label(fillable, structure=np.ones((3, 3)))
    if n == 0:
        return outside
    edge = np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])
    return np.isin(lab, np.unique(edge[edge > 0]))


def process(rgb):
    t = crimsonness(rgb)
    # Inside the backdrop region, replace in proportion to how crimson a pixel
    # is, so the antialiased edge of the silhouette blends instead of stepping.
    alpha = np.clip((t - 0.06) / 0.16, 0.0, 1.0) * backdrop(texture(rgb), t)
    alpha = ndimage.gaussian_filter(alpha.astype(np.float32), 0.6)[..., None]
    return np.clip(rgb * (1 - alpha) + BG * alpha, 0, 255).astype(np.uint8)


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
    dec = subprocess.Popen(
        [FFMPEG, "-v", "error", "-i", src, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        stdout=subprocess.PIPE)
    enc = subprocess.Popen(
        [FFMPEG, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
         "-s", f"{w}x{h}", "-r", "25", "-i", "-", "-an",
         "-c:v", "libx264", "-preset", "slow", "-crf", "21",
         "-pix_fmt", "yuv420p", "-profile:v", "high",
         "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
         "-movflags", "+faststart", dst],
        stdin=subprocess.PIPE)
    frames = 0
    while True:
        raw = dec.stdout.read(w * h * 3)
        if len(raw) < w * h * 3:
            break
        frame = np.frombuffer(raw, np.uint8).reshape(h, w, 3).astype(np.float32)
        enc.stdin.write(process(frame).tobytes())
        frames += 1
    enc.stdin.close()
    enc.wait()
    dec.wait()
    print(f"{frames} frames -> {dst}")


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
