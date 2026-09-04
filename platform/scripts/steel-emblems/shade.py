"""Shade the student-tile emblem masks into photographic embossed steel.

Reads the greyscale masks written by render-masks.mjs, builds a height field
(a turned disc with a chamfered rim, the emblem standing proud of it with a
rounded bevel, V-cut engravings, lathe rings and brushed grain), and lights
it the way a photograph of metal is lit: the colour of polished steel is
almost entirely the reflection of its surroundings, so the base tone comes
from an environment map indexed by the reflected view ray (a dim room straight
back at the camera, a softbox overhead, a dark maroon floor), with a key light
from the upper left for the hard glints, a broad fill lobe, ambient occlusion
in the concavities, a contact shadow under the emblem, and a little sensor
grain on top. Output is premultiplied RGBA at OUT_SIZE.

    python3 scripts/steel-emblems/shade.py
"""
from __future__ import annotations

import os

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
MASKS = os.path.join(HERE, "masks")
OUT_DIR = os.path.join(HERE, "..", "..", "public", "student-tiles")
OUT_SIZE = 640

# Working resolution comes from the masks (1600). Heights are in pixels of
# that grid, so slopes are geometric.
PX_PER_UNIT = 8.0  # 200-unit SVG box -> 1600 px


def load(name: str) -> np.ndarray:
    im = Image.open(os.path.join(MASKS, f"{name}.png")).convert("L")
    return np.asarray(im, dtype=np.float64) / 255.0


def smoothstep(x: np.ndarray) -> np.ndarray:
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def quarter_round(t: np.ndarray) -> np.ndarray:
    """Rounded bevel profile: t in [0,1] from edge to interior -> height."""
    t = np.clip(t, 0.0, 1.0)
    return np.sqrt(1.0 - (1.0 - t) ** 2)


def normalize(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.maximum(n, 1e-9)


def build_height(disc: np.ndarray, raised: np.ndarray, grooves: np.ndarray, rng: np.random.Generator):
    h_, w_ = disc.shape
    yy, xx = np.mgrid[0:h_, 0:w_].astype(np.float64)
    cx = cy = (w_ - 1) / 2.0
    r = np.hypot(xx - cx, yy - cy)
    r_units = r / PX_PER_UNIT

    # ---- Disc: flat face, gentle dome, chamfer from r=92 to the rim at 98.
    face = 40.0 + 20.0 * (1.0 - np.clip(r_units / 92.0, 0, 1) ** 2)
    cham_t = np.clip((98.0 - r_units) / 6.0, 0.0, 1.0)  # 1 at r=92, 0 at rim
    chamfer = 12.0 + (face - 12.0) * quarter_round(cham_t)
    h = np.where(r_units <= 92.0, face, chamfer)
    h = np.where(r_units > 98.0, 0.0, h)

    # Turned groove just inside the chamfer (V-cut, depth 2.5px, half-width 4px).
    ring = np.clip(1.0 - np.abs(r_units - 86.0) * PX_PER_UNIT / 4.0, 0.0, 1.0)
    h -= 2.5 * ring

    # ---- Emblem: proud of the face by 22px with a 24px rounded bevel.
    inside = raised > 0.5
    d_in = ndimage.distance_transform_edt(inside)
    d_out = ndimage.distance_transform_edt(~inside)
    # Signed distance; positive inside. The bevel spans -1..23 px so the AA
    # edge of the mask lands on the profile rather than on a cliff. Thin
    # members (chains) are narrower than the bevel, so they simply come out
    # as fully rounded beads, which is right.
    sd = d_in - d_out
    bevel = quarter_round((sd + 1.0) / 24.0)
    emblem_h = 22.0 * bevel
    # Fillet where the emblem meets the disc: a small concave radius outside.
    fillet = 2.0 * np.exp(-np.clip(-sd, 0, None) / 8.0) * (sd < 0)
    h += emblem_h + fillet

    # ---- Engravings: V-cut 5px deep, soft-walled.
    g = ndimage.gaussian_filter(grooves, 2.0)
    h -= 5.0 * np.clip(g, 0, 1) * np.clip(bevel, 0, 1)

    # ---- Surface texture.
    # Lathe rings on the disc: 1-D noise in radius, so the grain is concentric.
    ring_noise = rng.normal(size=int(r.max()) + 2)
    ring_noise = ndimage.gaussian_filter1d(ring_noise, 0.9)
    ring_tex = ring_noise[np.clip(r.astype(int), 0, len(ring_noise) - 1)]
    # Linear brushing on the emblem: noise smeared along x.
    brush = rng.normal(size=disc.shape)
    brush = ndimage.gaussian_filter(brush, sigma=(0.7, 28.0))
    brush /= brush.std() + 1e-9
    # Fine isotropic micro-roughness everywhere.
    micro = ndimage.gaussian_filter(rng.normal(size=disc.shape), 0.8)
    micro /= micro.std() + 1e-9

    on_emblem = smoothstep((sd + 2.0) / 6.0)
    h += 0.035 * ring_tex * (1.0 - on_emblem) * (r_units <= 98.0)
    h += 0.03 * brush * on_emblem
    h += 0.012 * micro * (r_units <= 98.0)

    # A few stray scratches: thin, shallow, random.
    for _ in range(5):
        x0, y0 = rng.uniform(0, w_, 2)
        ang = rng.uniform(0, np.pi)
        length = rng.uniform(150, 600)
        x1, y1 = x0 + length * np.cos(ang), y0 + length * np.sin(ang)
        n = int(length)
        xs = np.linspace(x0, x1, n).astype(int)
        ys = np.linspace(y0, y1, n).astype(int)
        ok = (xs >= 0) & (xs < w_) & (ys >= 0) & (ys < h_)
        line = np.zeros_like(h)
        line[ys[ok], xs[ok]] = 1.0
        line = ndimage.gaussian_filter(line, 0.9)
        h -= 0.12 * line / (line.max() + 1e-9) * (r_units <= 98.0)

    alpha = np.clip((98.6 - r_units) * PX_PER_UNIT / 2.0, 0.0, 1.0)  # ~2px AA rim
    return h, alpha, sd, bevel, r_units


def environment(rd: np.ndarray) -> np.ndarray:
    """Colour of the studio in direction rd (x right, y up, z toward viewer).

    A face-on surface reflects straight back at the camera, where the room is
    a dim warm grey. Faces tilted up catch a large softbox; tilted up-left,
    the key. Tilted down they see the floor, which in this room is dark
    maroon with a fairly crisp edge where it meets the wall.
    """
    up = rd[..., 1]
    x = rd[..., 0]
    room = np.array([0.19, 0.178, 0.182])
    wall_right = np.array([0.13, 0.122, 0.125])
    softbox = np.array([0.98, 0.97, 0.96])
    key = np.array([0.92, 0.91, 0.92])
    floor = np.array([0.085, 0.045, 0.055])
    floor_deep = np.array([0.03, 0.012, 0.018])

    # Walls: darker to the right, so left-facing bevels read brighter.
    t_right = smoothstep((x - 0.1) / 0.5)
    base = room[None, None, :] * (1.0 - t_right)[..., None] + wall_right[None, None, :] * t_right[..., None]
    # Floor below a crisp horizon.
    t_floor = smoothstep((-up - 0.04) / 0.10)
    t_deep = smoothstep((-up - 0.3) / 0.5)
    ground = floor[None, None, :] * (1.0 - t_deep)[..., None] + floor_deep[None, None, :] * t_deep[..., None]
    base = base * (1.0 - t_floor)[..., None] + ground * t_floor[..., None]
    # Softbox overhead-front, and the key up-left.
    box = np.exp(-((up - 0.55) / 0.26) ** 2) * np.exp(-(x / 0.9) ** 2)
    lobe = np.exp(-(((x + 0.55) / 0.38) ** 2 + ((up - 0.30) / 0.30) ** 2))
    # A thin bright rim right at the horizon, the edge of the softbox table.
    rim = np.exp(-((up + 0.02) / 0.03) ** 2) * 0.35
    col = base + box[..., None] * softbox + 0.8 * lobe[..., None] * key + rim[..., None] * softbox
    return col


def shade(h: np.ndarray, alpha: np.ndarray, sd: np.ndarray, bevel: np.ndarray, r_units: np.ndarray,
          rng: np.random.Generator) -> np.ndarray:
    gy, gx = np.gradient(h)
    n = normalize(np.stack([-gx, -gy, np.ones_like(h)], axis=-1))
    # Image y points down; lighting works in y-up.
    n_up = n.copy()
    n_up[..., 1] *= -1.0

    v = np.array([0.0, 0.0, 1.0])
    ndv = np.clip(n_up[..., 2], 0.0, 1.0)
    refl = 2.0 * ndv[..., None] * n_up - v[None, None, :]
    refl = normalize(refl)

    # Slightly rough reflection: blur the reflected direction a touch so the
    # environment does not mirror as a hard image (this is satin, not chrome).
    refl_s = np.stack([ndimage.gaussian_filter(refl[..., i], 2.2) for i in range(3)], axis=-1)
    env = environment(normalize(refl_s))

    steel = np.array([0.80, 0.81, 0.83])
    # Fresnel for a metal: high everywhere, a little higher at grazing.
    f = 0.82 + 0.18 * (1.0 - ndv) ** 3
    color = steel[None, None, :] * env * f[..., None]

    # Key light, upper left, hard glint + broad sheen.
    def spec(light, power, k):
        l = normalize(np.array(light))
        hv = normalize(l + v)
        ndh = np.clip((n_up * hv[None, None, :]).sum(-1), 0.0, 1.0)
        return k * ndh ** power

    color += spec([-0.55, 0.75, 0.55], 260.0, 0.85)[..., None] * np.array([1.0, 0.99, 0.98])
    color += spec([-0.55, 0.75, 0.55], 18.0, 0.16)[..., None] * np.array([0.95, 0.95, 0.97])
    # Fill from lower right, faint and warm (the maroon room).
    color += spec([0.7, -0.5, 0.5], 40.0, 0.10)[..., None] * np.array([0.9, 0.55, 0.6])

    # Diffuse term is small for metal, but it keeps flat faces from going dead.
    l_key = normalize(np.array([-0.55, 0.75, 0.55]))
    ndl = np.clip((n_up * l_key[None, None, :]).sum(-1), 0.0, 1.0)
    color += 0.06 * ndl[..., None] * steel[None, None, :]

    # Ambient occlusion: where the surface sits below its neighbourhood.
    ao = 0.0
    for s, k in ((6.0, 0.35), (16.0, 0.35), (40.0, 0.30)):
        blurred = ndimage.gaussian_filter(h, s)
        ao = ao + k * np.clip((blurred - h) / (0.6 * s), 0.0, 1.0)
    ao = 1.0 - 0.75 * np.clip(ao, 0.0, 1.0)
    color *= ao[..., None]

    # Contact shadow: the emblem shades the disc toward the lower right.
    emblem = smoothstep((sd + 1.0) / 2.0)
    sh = ndimage.shift(emblem, shift=(9.0, 7.0), order=1, mode="constant")
    sh = ndimage.gaussian_filter(sh, 7.0)
    shadow = np.clip(sh - emblem, 0.0, 1.0)
    color *= (1.0 - 0.55 * shadow)[..., None]

    # Vignette: a real disc darkens slightly toward its edge under a softbox.
    vig = 1.0 - 0.10 * smoothstep((r_units - 60.0) / 38.0)
    color *= vig[..., None]

    # Sensor grain and a gentle filmic curve.
    grain = rng.normal(size=h.shape) * 0.012
    color += grain[..., None]
    color = np.clip(color * 1.35, 0.0, None)  # exposure
    color = color / (1.0 + 0.22 * color)  # soft shoulder
    color = np.clip(color, 0.0, 1.0) ** (1.0 / 2.2)

    rgba = np.concatenate([color * alpha[..., None], alpha[..., None]], axis=-1)
    return rgba


def to_image(rgba: np.ndarray) -> Image.Image:
    # Downsample premultiplied, then un-premultiply for a straight-alpha PNG.
    im = Image.fromarray((np.clip(rgba, 0, 1) * 255.0 + 0.5).astype(np.uint8), "RGBA")
    im = im.resize((OUT_SIZE, OUT_SIZE), Image.LANCZOS)
    arr = np.asarray(im).astype(np.float64) / 255.0
    a = arr[..., 3:4]
    rgb = np.where(a > 0, arr[..., :3] / np.maximum(a, 1e-6), 0.0)
    out = np.concatenate([np.clip(rgb, 0, 1), a], axis=-1)
    return Image.fromarray((out * 255.0 + 0.5).astype(np.uint8), "RGBA")


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    disc = load("disc")
    for name in ("self-assess", "feedback"):
        rng = np.random.default_rng(20260903)
        raised = load(f"{name}.raised")
        grooves = load(f"{name}.grooves")
        h, alpha, sd, bevel, r_units = build_height(disc, raised, grooves, rng)
        rgba = shade(h, alpha, sd, bevel, r_units, rng)
        out = os.path.join(OUT_DIR, f"{name}.png")
        to_image(rgba).save(out, optimize=True)
        print("wrote", os.path.relpath(out, os.getcwd()), os.path.getsize(out) // 1024, "KB")


if __name__ == "__main__":
    main()
