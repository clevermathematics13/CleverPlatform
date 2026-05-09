#!/usr/bin/env python3
"""
Deterministic CV-based graph extraction for piecewise linear / smooth functions.
Pure Python: numpy, scipy, scikit-image, PIL. No OpenCV.

Pipeline:
  1. Calibrate axes from grid line spacing; snap to integer px/unit; origin = closest grid line to image centre.
  2. Isolate graph-line pixels via chromatic or morphological thickness filter.
  3. Column-sweep: median y per x-column → smooth y-profile.
  4. Douglas-Peucker simplification collapses smooth curves into key breakpoints.
  5. Slope-change detection adds any remaining sharp corners.
  6. Merge nearby breakpoints; snap coords to 0.5-unit grid.
"""

import sys, json, base64, argparse, logging, math
from pathlib import Path
from dataclasses import dataclass, asdict
from typing import List, Tuple, Optional, Dict, Any
from io import BytesIO

import numpy as np
from PIL import Image
from scipy.ndimage import binary_dilation, binary_erosion
from skimage import feature

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)


# ── Data classes ───────────────────────────────────────────────────────────────

@dataclass
class AxisCalibration:
    x_min: float
    x_max: float
    y_min: float
    y_max: float
    px_per_unit_x: float
    px_per_unit_y: float
    origin_x_px: int
    origin_y_px: int
    success: bool = True
    notes: List[str] = None
    def __post_init__(self):
        if self.notes is None:
            self.notes = []

@dataclass
class GraphVertex:
    x: float
    y: float
    confidence: float
    is_endpoint: bool = False
    pixel_x: int = 0
    pixel_y: int = 0

@dataclass
class GraphSegment:
    x_min: float
    x_max: float
    y_at_xmin: float
    y_at_xmax: float
    slope: float
    intercept: float
    confidence: float
    pixel_length: float


@dataclass
class ProfileData:
    x_px: np.ndarray
    y_px: np.ndarray
    x: np.ndarray
    y: np.ndarray
    y_smooth: np.ndarray
    sample_count: int
    coverage_ratio: float
    noise_sigma: float


@dataclass
class FitCandidate:
    family: str
    expr: str
    score: float
    confidence: float
    rmse: float
    nrmse: float
    endpoint_error: float
    complexity_penalty: float


# ── Image loading ──────────────────────────────────────────────────────────────

def load_image_b64(b64_str: str) -> np.ndarray:
    if b64_str.startswith("data:") and "," in b64_str:
        b64_str = b64_str.split(",", 1)[1]
    img_data = base64.b64decode(b64_str)
    return np.array(Image.open(BytesIO(img_data)).convert('RGB'))

def rgb_to_gray(img: np.ndarray) -> np.ndarray:
    r, g, b = img[:,:,0].astype(float), img[:,:,1].astype(float), img[:,:,2].astype(float)
    return (0.299*r + 0.587*g + 0.114*b).astype(np.uint8)


# ── Axis calibration ───────────────────────────────────────────────────────────

def calibrate_axes(gray: np.ndarray) -> AxisCalibration:
    h, w = gray.shape
    inverted = 255 - gray
    grid_mask = (inverted > 150).astype(np.uint8)

    v_profile = grid_mask.sum(axis=0)
    h_profile = grid_mask.sum(axis=1)
    v_peaks = np.where(v_profile > np.percentile(v_profile, 75))[0]
    h_peaks = np.where(h_profile > np.percentile(h_profile, 75))[0]

    def cluster_peaks(peaks, min_gap=5):
        if len(peaks) == 0:
            return []
        current = [peaks[0]]
        lines = []
        for p in peaks[1:]:
            if p - current[-1] > min_gap:
                lines.append(int(np.mean(current)))
                current = [p]
            else:
                current.append(p)
        lines.append(int(np.mean(current)))
        return lines

    v_lines = cluster_peaks(v_peaks)
    h_lines = cluster_peaks(h_peaks)
    logger.info(f"Detected {len(v_lines)} vertical, {len(h_lines)} horizontal grid lines")

    if len(v_lines) >= 3 and len(h_lines) >= 3:
        v_spacing = float(np.median(np.diff(v_lines)))
        h_spacing = float(np.median(np.diff(h_lines)))

        # Snap to nearest integer pixel for cleaner coordinates
        px_per_unit_x = max(1.0, round(v_spacing))
        px_per_unit_y = max(1.0, round(h_spacing))

        # Origin = grid line nearest image centre
        cx, cy = w / 2, h / 2
        origin_x_px = int(v_lines[int(np.argmin([abs(vl - cx) for vl in v_lines]))])
        origin_y_px = int(h_lines[int(np.argmin([abs(hl - cy) for hl in h_lines]))])

        # Derive axis range from how many grid lines there are
        half_x = round(len(v_lines) / 2)
        half_y = round(len(h_lines) / 2)

        return AxisCalibration(
            x_min=-half_x, x_max=half_x,
            y_min=-half_y, y_max=half_y,
            px_per_unit_x=px_per_unit_x,
            px_per_unit_y=px_per_unit_y,
            origin_x_px=origin_x_px,
            origin_y_px=origin_y_px,
            notes=[f"Grid: {len(v_lines)}v/{len(h_lines)}h lines, {px_per_unit_x:.0f}/{px_per_unit_y:.0f}px/unit"]
        )

    logger.warning("Insufficient grid lines; using fallback calibration")
    return AxisCalibration(
        x_min=-4, x_max=4, y_min=-4, y_max=4,
        px_per_unit_x=w / 8, px_per_unit_y=h / 8,
        origin_x_px=w // 2, origin_y_px=h // 2,
        notes=["Fallback: grid lines not reliably detected"]
    )


# ── Graph line isolation ───────────────────────────────────────────────────────

def isolate_graph_line(img_rgb: np.ndarray) -> np.ndarray:
    """
    Binary mask of graph-line pixels, excluding background and thin grid lines.

    Priority:
    1. Chromatic: coloured graph line (blue, red…) separated from gray grid.
    2. Morphological thickness: dark pixels after eroding thin 1-2px lines away.
    3. Fallback: raw dark pixels.
    """
    chroma = np.max(img_rgb, axis=2).astype(float) - np.min(img_rgb, axis=2).astype(float)
    chromatic = chroma > 40
    if chromatic.sum() > 50:
        logger.info(f"Color isolation: {int(chromatic.sum())} chromatic pixels")
        return (chromatic.astype(np.uint8) * 255)

    gray = rgb_to_gray(img_rgb)
    dark = gray < 80
    eroded = binary_erosion(dark, structure=np.ones((3, 3)))
    thick  = binary_dilation(eroded, structure=np.ones((3, 3)))
    if thick.sum() > 50:
        logger.info(f"Thickness filter: {int(thick.sum())} graph-line pixels")
        return (thick.astype(np.uint8) * 255)

    logger.warning("Fallback: raw dark mask")
    return (dark.astype(np.uint8) * 255)


# ── Douglas-Peucker simplification ────────────────────────────────────────────

def _douglas_peucker(points: List[Tuple[float, float]], epsilon: float) -> List[int]:
    """Return indices of points surviving D-P simplification at given epsilon."""
    if len(points) < 3:
        return list(range(len(points)))

    def _dp(start: int, end: int) -> List[int]:
        if end <= start + 1:
            return [start, end]
        x0, y0 = points[start]
        x1, y1 = points[end]
        dx, dy = x1 - x0, y1 - y0
        length = (dx**2 + dy**2) ** 0.5
        if length == 0:
            return [start, end]
        max_dist, max_idx = 0.0, start
        for i in range(start + 1, end):
            xi, yi = points[i]
            dist = abs(dy * xi - dx * yi + x1 * y0 - y1 * x0) / length
            if dist > max_dist:
                max_dist, max_idx = dist, i
        if max_dist > epsilon:
            left  = _dp(start, max_idx)
            right = _dp(max_idx, end)
            return left + right[1:]
        return [start, end]

    return _dp(0, len(points) - 1)


# ── Vertex detection ───────────────────────────────────────────────────────────

def _cluster_1d(values: np.ndarray, gap: float) -> List[float]:
    if len(values) == 0:
        return []
    vs = np.sort(values)
    clusters: List[List[float]] = [[float(vs[0])]]
    for v in vs[1:]:
        if v - clusters[-1][-1] > gap:
            clusters.append([])
        clusters[-1].append(float(v))
    return [float(np.median(c)) for c in clusters]

def _snap(v: float) -> float:
    return round(v * 2) / 2


def extract_profile_from_mask(mask: np.ndarray, calib: AxisCalibration) -> Optional[ProfileData]:
    active = mask > 128
    h_img, w_img = active.shape

    x_cols: List[int] = []
    y_meds: List[float] = []
    for x in range(w_img):
        ys = np.where(active[:, x])[0]
        if len(ys) > 0:
            x_cols.append(x)
            y_meds.append(float(np.median(ys)))

    if len(x_cols) < 12:
        return None

    xa = np.array(x_cols, dtype=float)
    ya = np.array(y_meds, dtype=float)
    win = max(5, len(xa) // 50)
    ys = np.convolve(ya, np.ones(win) / win, mode='same')

    noise_sigma_px = float(np.std(ya - ys)) if len(ya) > 1 else 0.0
    xg = (xa - calib.origin_x_px) / calib.px_per_unit_x
    yg = (calib.origin_y_px - ys) / calib.px_per_unit_y
    noise_sigma = noise_sigma_px / max(calib.px_per_unit_y, 1e-6)

    return ProfileData(
        x_px=xa,
        y_px=ya,
        x=xg,
        y=yg,
        y_smooth=yg,
        sample_count=len(x_cols),
        coverage_ratio=float(len(x_cols)) / float(max(w_img, 1)),
        noise_sigma=noise_sigma,
    )


def find_vertices_from_mask(mask: np.ndarray, calib: AxisCalibration) -> List[GraphVertex]:
    """
    Column-sweep → D-P simplification → slope-change breakpoint detection → vertices.
    """
    profile = extract_profile_from_mask(mask, calib)
    if profile is None or profile.sample_count < 4:
        logger.warning("Insufficient active columns — line not detected")
        return []
    h_img, _ = (mask > 128).shape
    xa = profile.x_px
    ys = calib.origin_y_px - (profile.y_smooth * calib.px_per_unit_y)

    # ── Douglas-Peucker simplification ─────────────────────────────────────────
    # Epsilon = 1.5 % of image height → collapses smooth curves to ~3-8 points
    dp_eps = max(1.0, h_img * 0.015)
    profile_pts = list(zip(xa.tolist(), ys.tolist()))
    dp_indices = _douglas_peucker(profile_pts, epsilon=dp_eps)
    logger.info(f"D-P: {len(xa)} cols → {len(dp_indices)} keypoints (eps={dp_eps:.1f}px)")

    # ── Slope-change on full profile for sharp corners ─────────────────────────
    dx = np.diff(xa)
    dy = np.diff(ys)
    slopes = np.where(dx > 0, dy / dx, 0.0)
    slope_delta = np.abs(np.diff(slopes))
    # Stricter threshold (92nd %ile, min 0.5) to only add sharp corners
    thresh = max(0.5, float(np.percentile(slope_delta, 92))) if len(slope_delta) > 5 else 0.5
    logger.info(f"Slope-change threshold: {thresh:.3f}")
    slope_bp = [i + 1 for i, sd in enumerate(slope_delta) if sd > thresh]

    all_bp = sorted(set(dp_indices + [0, len(xa)-1] + slope_bp))

    # Merge nearby breakpoints (< 40% of a grid unit apart)
    gap_px = max(4.0, calib.px_per_unit_x * 0.4)
    merged_x = _cluster_1d(xa[all_bp], gap=gap_px)
    logger.info(f"Breakpoints after merge: {len(merged_x)}")

    vertices: List[GraphVertex] = []
    for i, mx in enumerate(merged_x):
        ni = int(np.argmin(np.abs(xa - mx)))
        px_x = int(xa[ni])
        px_y = int(round(ys[ni]))
        gx = _snap((px_x - calib.origin_x_px) / calib.px_per_unit_x)
        gy = _snap((calib.origin_y_px - px_y) / calib.px_per_unit_y)
        vertices.append(GraphVertex(
            x=float(gx), y=float(gy), confidence=0.85,
            is_endpoint=(i == 0 or i == len(merged_x)-1),
            pixel_x=px_x, pixel_y=px_y,
        ))

    # Deduplicate
    seen: set = set()
    unique: List[GraphVertex] = []
    for v in vertices:
        key = (v.x, v.y)
        if key not in seen:
            seen.add(key)
            unique.append(v)

    unique.sort(key=lambda v: v.x)
    return unique


# Backward-compat alias
def find_vertices_from_edges(edges: np.ndarray, calib: AxisCalibration) -> List[GraphVertex]:
    return find_vertices_from_mask(edges, calib)


# ── Segment building ───────────────────────────────────────────────────────────

def vertices_to_segments(vertices: List[GraphVertex]) -> List[GraphSegment]:
    segments = []
    for i in range(len(vertices) - 1):
        v1, v2 = vertices[i], vertices[i+1]
        if abs(v2.x - v1.x) < 1e-6:
            continue
        slope = (v2.y - v1.y) / (v2.x - v1.x)
        intercept = v1.y - slope * v1.x
        pixel_dist = float(np.sqrt((v2.pixel_x - v1.pixel_x)**2 + (v2.pixel_y - v1.pixel_y)**2))
        segments.append(GraphSegment(
            x_min=v1.x, x_max=v2.x,
            y_at_xmin=v1.y, y_at_xmax=v2.y,
            slope=slope, intercept=intercept,
            confidence=(v1.confidence + v2.confidence) / 2,
            pixel_length=pixel_dist,
        ))
    return segments

def format_expr(slope: float, intercept: float) -> str:
    m, c = round(slope, 6), round(intercept, 6)
    if abs(m) < 1e-8: return str(c)
    if abs(c) < 1e-8: return f"{m}*x"
    sign = "+" if c >= 0 else "-"
    return f"{m}*x {sign} {abs(c)}"


def _format_signed(value: float) -> str:
    return f" + {abs(value):.6g}" if value >= 0 else f" - {abs(value):.6g}"


def _format_poly_expr(coeffs: np.ndarray) -> str:
    deg = len(coeffs) - 1
    terms: List[str] = []
    for idx, c in enumerate(coeffs):
        power = deg - idx
        if abs(c) < 1e-9:
            continue
        if power == 0:
            terms.append(f"{c:.6g}")
        elif power == 1:
            terms.append(f"{c:.6g}*x")
        else:
            terms.append(f"{c:.6g}*x^{power}")
    if not terms:
        return "0"
    expr = " + ".join(terms)
    return expr.replace("+ -", "- ")


def _score_candidate(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    complexity_penalty: float,
) -> Tuple[float, float, float, float, float]:
    rmse = float(np.sqrt(np.mean((y_true - y_pred) ** 2)))
    y_span = float(max(np.ptp(y_true), 1e-6))
    nrmse = rmse / y_span
    endpoint_error = float((abs(y_pred[0] - y_true[0]) + abs(y_pred[-1] - y_true[-1])) / (2.0 * y_span))
    score = 0.68 * nrmse + 0.22 * endpoint_error + 0.10 * complexity_penalty
    confidence = float(np.clip(1.0 - score, 0.0, 1.0))
    return score, confidence, rmse, nrmse, endpoint_error


def _fit_polynomial(profile: ProfileData, degree: int, family: str, complexity: float) -> Optional[FitCandidate]:
    if profile.sample_count < degree + 4:
        return None
    coeffs = np.polyfit(profile.x, profile.y_smooth, degree)
    y_pred = np.polyval(coeffs, profile.x)
    score, confidence, rmse, nrmse, endpoint_error = _score_candidate(profile.y_smooth, y_pred, complexity)
    return FitCandidate(
        family=family,
        expr=_format_poly_expr(coeffs),
        score=score,
        confidence=confidence,
        rmse=rmse,
        nrmse=nrmse,
        endpoint_error=endpoint_error,
        complexity_penalty=complexity,
    )


def _fit_exponential(profile: ProfileData) -> Optional[FitCandidate]:
    x = profile.x
    y = profile.y_smooth
    y_span = float(max(np.ptp(y), 1e-6))
    ymin = float(np.min(y))
    ymax = float(np.max(y))

    c_candidates = np.linspace(ymin - 0.8 * y_span, ymax + 0.8 * y_span, 41)
    best: Optional[FitCandidate] = None
    for c in c_candidates:
        z = y - c
        if np.any(z <= 1e-6):
            continue
        lnz = np.log(z)
        try:
            b, ln_a = np.polyfit(x, lnz, 1)
        except Exception:
            continue
        a = float(np.exp(ln_a))
        if not np.isfinite(a) or not np.isfinite(b):
            continue
        y_pred = a * np.exp(b * x) + c
        score, confidence, rmse, nrmse, endpoint_error = _score_candidate(y, y_pred, complexity_penalty=0.10)
        expr = f"{a:.6g}*exp({b:.6g}*x){_format_signed(c)}"
        cand = FitCandidate(
            family="exponential",
            expr=expr,
            score=score,
            confidence=confidence,
            rmse=rmse,
            nrmse=nrmse,
            endpoint_error=endpoint_error,
            complexity_penalty=0.10,
        )
        if best is None or cand.score < best.score:
            best = cand
    return best


def select_curve_family(profile: ProfileData) -> Dict[str, Any]:
    candidates: List[FitCandidate] = []
    for cand in [
        _fit_polynomial(profile, 1, "linear", 0.00),
        _fit_polynomial(profile, 2, "quadratic", 0.08),
        _fit_polynomial(profile, 3, "cubic", 0.16),
        _fit_exponential(profile),
    ]:
        if cand is not None and math.isfinite(cand.score):
            candidates.append(cand)

    if not candidates:
        return {
            "accepted": False,
            "reason": "No fit candidates available",
            "best": None,
            "runner_up": None,
            "margin": 0.0,
            "candidates": [],
        }

    candidates.sort(key=lambda c: c.score)
    best = candidates[0]
    runner = candidates[1] if len(candidates) > 1 else None
    margin = float((runner.score - best.score) if runner else 1.0)

    adjusted = best.confidence
    adjusted += min(0.08, margin * 0.5)
    if profile.coverage_ratio < 0.15:
        adjusted -= 0.20
    if profile.sample_count < 30:
        adjusted -= 0.12
    if profile.noise_sigma > 0.25:
        adjusted -= min(0.20, profile.noise_sigma * 0.2)
    adjusted = float(np.clip(adjusted, 0.0, 1.0))
    best.confidence = adjusted

    threshold = 0.72
    margin_threshold = 0.05
    high_conf_override = 0.88
    accepted = best.confidence >= threshold and (margin >= margin_threshold or best.confidence >= high_conf_override)
    reason = "accepted"
    if not accepted:
        reasons = []
        if best.confidence < threshold:
            reasons.append(f"confidence {best.confidence:.3f} < {threshold:.2f}")
        if margin < margin_threshold:
            if best.confidence < high_conf_override:
                reasons.append(f"margin {margin:.3f} < {margin_threshold:.2f}")
        reason = "; ".join(reasons) if reasons else "not accepted"

    return {
        "accepted": accepted,
        "reason": reason,
        "best": best,
        "runner_up": runner,
        "margin": margin,
        "candidates": [asdict(c) for c in candidates],
        "threshold": threshold,
        "margin_threshold": margin_threshold,
        "high_conf_override": high_conf_override,
    }


def _build_piecewise_response(vertices: List[GraphVertex], segments: List[GraphSegment], calib: AxisCalibration) -> Dict[str, Any]:
    elements = []
    for seg in segments:
        elements.append({
            "type": "line", "expr": format_expr(seg.slope, seg.intercept),
            "xMin": round(seg.x_min, 6), "xMax": round(seg.x_max, 6),
            "dashed": False, "color": "#000000",
        })
    for v in vertices:
        elements.append({"type": "point", "x": round(v.x, 6), "y": round(v.y, 6), "label": "", "open": False})

    domain = [min(v.x for v in vertices), max(v.x for v in vertices)]
    rng = [min(v.y for v in vertices), max(v.y for v in vertices)]
    return {
        "graphSpec": {
            "xRange": [calib.x_min, calib.x_max],
            "yRange": [calib.y_min, calib.y_max],
            "elements": elements,
        },
        "graphMeta": {
            "description": f"CV piecewise fallback: {len(segments)} segment(s) from {len(vertices)} vertices.",
            "equations": [f"y = {format_expr(s.slope, s.intercept)}, {s.x_min:.3g}<=x<={s.x_max:.3g}" for s in segments],
            "xIntercepts": [], "yIntercepts": [],
            "verticalAsymptotes": [], "horizontalAsymptotes": [],
            "keyPoints": [{"x": round(v.x, 6), "y": round(v.y, 6), "label": ""} for v in vertices],
            "domain": [round(d, 6) for d in domain],
            "markschemeHints": [
                f"Piecewise fallback: {len(segments)} segs / {len(vertices)} vertices",
                f"Domain [{domain[0]:.3g}, {domain[1]:.3g}]  Range [{rng[0]:.3g}, {rng[1]:.3g}]",
            ],
        },
        "domain": domain,
        "range": rng,
    }


# ── Main extraction pipeline ───────────────────────────────────────────────────

def extract_graph_cv(img_b64: str) -> dict:
    try:
        img  = load_image_b64(img_b64)
        gray = rgb_to_gray(img)
        calib = calibrate_axes(gray)
        if not calib.success:
            return {"error": "Calibration failed", "metadata": {"notes": calib.notes}}

        graph_mask = isolate_graph_line(img)
        profile = extract_profile_from_mask(graph_mask, calib)
        if profile is None:
            return {"error": "Fewer than 2 vertices detected", "metadata": {"warnings": ["No usable graph profile detected"]}}

        fit_diag = select_curve_family(profile)
        best_fit = fit_diag.get("best")
        if fit_diag.get("accepted") and isinstance(best_fit, FitCandidate):
            x_min = float(_snap(float(np.min(profile.x))))
            x_max = float(_snap(float(np.max(profile.x))))
            y_min = float(np.min(profile.y_smooth))
            y_max = float(np.max(profile.y_smooth))
            end_x = [float(np.min(profile.x)), float(np.max(profile.x))]
            end_y = [float(profile.y_smooth[0]), float(profile.y_smooth[-1])]

            return {
                "ok": True,
                "graphSpec": {
                    "xRange": [calib.x_min, calib.x_max],
                    "yRange": [calib.y_min, calib.y_max],
                    "elements": [
                        {
                            "type": "fn",
                            "expr": best_fit.expr,
                            "xMin": round(x_min, 6),
                            "xMax": round(x_max, 6),
                            "dashed": False,
                            "color": "#000000",
                        },
                        {"type": "point", "x": round(end_x[0], 6), "y": round(end_y[0], 6), "label": "", "open": False},
                        {"type": "point", "x": round(end_x[1], 6), "y": round(end_y[1], 6), "label": "", "open": False},
                    ],
                },
                "graphMeta": {
                    "description": f"CV curve-family fit ({best_fit.family}) with confidence {best_fit.confidence:.2f}.",
                    "equations": [f"y = {best_fit.expr}, {x_min:.3g}<=x<={x_max:.3g}"],
                    "xIntercepts": [], "yIntercepts": [],
                    "verticalAsymptotes": [], "horizontalAsymptotes": [],
                    "keyPoints": [
                        {"x": round(end_x[0], 6), "y": round(end_y[0], 6), "label": "endpoint"},
                        {"x": round(end_x[1], 6), "y": round(end_y[1], 6), "label": "endpoint"},
                    ],
                    "domain": [round(x_min, 6), round(x_max, 6)],
                    "markschemeHints": [
                        f"Selected family: {best_fit.family}",
                        f"Fit confidence: {best_fit.confidence:.3f}; margin: {fit_diag.get('margin', 0.0):.3f}",
                        f"Domain [{x_min:.3g}, {x_max:.3g}]  Range [{y_min:.3g}, {y_max:.3g}]",
                    ],
                },
                "metadata": {
                    "method": "cv_curve_family_v1",
                    "selected_family": best_fit.family,
                    "fit_confidence": best_fit.confidence,
                    "fit_margin": fit_diag.get("margin", 0.0),
                    "profile": {
                        "sample_count": profile.sample_count,
                        "coverage_ratio": profile.coverage_ratio,
                        "noise_sigma": profile.noise_sigma,
                    },
                    "fit_candidates": fit_diag.get("candidates", []),
                    "calibration": asdict(calib),
                    "warnings": calib.notes,
                },
                "feedback": [
                    "Curve-family fit accepted at high confidence.",
                    "Expression is bounded to detected graph domain.",
                ],
            }

        vertices = find_vertices_from_mask(graph_mask, calib)
        logger.info(f"Fallback found {len(vertices)} vertices")
        if len(vertices) < 2:
            return {
                "error": "Manual review required: extraction uncertainty gate triggered",
                "metadata": {
                    "method": "cv_curve_family_v1",
                    "warnings": calib.notes + [
                        f"Curve-family fit rejected: {fit_diag.get('reason', 'unknown')}",
                        "Piecewise fallback also detected fewer than 2 vertices",
                    ],
                    "fit_candidates": fit_diag.get("candidates", []),
                },
            }

        segments = vertices_to_segments(vertices)
        fallback = _build_piecewise_response(vertices, segments, calib)

        uncertainty_reasons: List[str] = []
        if len(vertices) >= 26:
            uncertainty_reasons.append(f"High vertex count ({len(vertices)}) indicates likely over-segmentation")
        if len(segments) >= 24:
            uncertainty_reasons.append(f"High segment count ({len(segments)}) indicates low-confidence piecewise fallback")
        uncertainty_reasons.append(f"Curve-family fit rejected: {fit_diag.get('reason', 'unknown')}")

        if len(vertices) >= 26 or len(segments) >= 24:
            warnings = calib.notes + ["Extraction uncertainty gate triggered"] + uncertainty_reasons
            return {
                "error": "Manual review required: extraction uncertainty gate triggered",
                "graphSpec": fallback["graphSpec"],
                "graphMeta": fallback["graphMeta"],
                "metadata": {
                    "method": "cv_curve_family_v1",
                    "vertices_detected": len(vertices),
                    "segments_extracted": len(segments),
                    "fit_candidates": fit_diag.get("candidates", []),
                    "fit_margin": fit_diag.get("margin", 0.0),
                    "calibration": asdict(calib),
                    "warnings": warnings,
                },
                "feedback": [
                    "Curve-family fit did not meet confidence threshold.",
                    "Fallback piecewise result appears over-segmented.",
                ],
            }

        warnings = calib.notes + [f"Curve-family fit rejected: {fit_diag.get('reason', 'unknown')}", "Using piecewise fallback"]
        return {
            "ok": True,
            "graphSpec": fallback["graphSpec"],
            "graphMeta": fallback["graphMeta"],
            "metadata": {
                "method": "cv_piecewise_fallback_v1",
                "vertices_detected": len(vertices),
                "segments_extracted": len(segments),
                "fit_candidates": fit_diag.get("candidates", []),
                "fit_margin": fit_diag.get("margin", 0.0),
                "calibration": asdict(calib),
                "warnings": warnings,
            },
            "feedback": [
                "Curve-family fit did not pass confidence threshold.",
                "Returned piecewise fallback with normal confidence.",
            ],
        }

    except Exception as e:
        import traceback
        logger.error(traceback.format_exc())
        return {"error": f"Extraction failed: {e}", "metadata": {"traceback": traceback.format_exc()}}


# ── Self-tests ─────────────────────────────────────────────────────────────────

def _assert(cond: bool, msg: str) -> None:
    if not cond: raise AssertionError(msg)

def run_self_tests() -> dict:
    results = []

    # Test 1: Diagonal-then-horizontal piecewise mask → ≥2 vertices
    mask = np.zeros((200, 200), dtype=np.uint8)
    for x in range(10, 61):
        y = 100 - (x - 10)
        if 0 <= y < 200: mask[y, x] = 255
    for x in range(60, 111):
        mask[40, x] = 255
    calib = AxisCalibration(x_min=-4, x_max=4, y_min=-4, y_max=4,
                            px_per_unit_x=20.0, px_per_unit_y=20.0,
                            origin_x_px=60, origin_y_px=100)
    verts = find_vertices_from_mask(mask, calib)
    _assert(len(verts) >= 2, f"Expected >=2 vertices, got {len(verts)}")
    results.append({"name": "piecewise_column_sweep", "ok": True, "vertices": len(verts)})

    # Test 2: Data-URI blank image → structured dict response
    blank = Image.new("RGB", (16, 16), (255, 255, 255))
    buf = BytesIO(); blank.save(buf, format="PNG")
    uri = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
    res = extract_graph_cv(uri)
    _assert(isinstance(res, dict) and ("error" in res or "ok" in res), "Expected dict with error/ok")
    results.append({"name": "data_uri_input", "ok": True, "result_kind": "ok" if res.get("ok") else "error"})

    # Test 3: Synthetic coloured piecewise graph → correct vertex count via colour isolation
    from PIL import ImageDraw
    W, H, PX = 480, 480, 60
    OX, OY = W//2, H//2
    img = Image.new('RGB', (W, H), (255,255,255))
    d = ImageDraw.Draw(img)
    for i in range(-4,5):
        d.line([(OX+i*PX,0),(OX+i*PX,H)], fill=(200,200,200), width=1)
        d.line([(0,OY+i*PX),(W,OY+i*PX)], fill=(200,200,200), width=1)
    d.line([(OX,0),(OX,H)], fill=(0,0,0), width=2)
    d.line([(0,OY),(W,OY)], fill=(0,0,0), width=2)
    pts = [(-3,-2),(-1,0),(1,0),(3,1)]
    pixel_pts = [(OX+gx*PX, OY-gy*PX) for gx,gy in pts]
    for i in range(len(pixel_pts)-1):
        d.line([pixel_pts[i], pixel_pts[i+1]], fill=(0,0,200), width=3)
    buf2 = BytesIO(); img.save(buf2, format='PNG')
    b64 = base64.b64encode(buf2.getvalue()).decode()
    res2 = extract_graph_cv(b64)
    _assert(res2.get("ok"), f"Expected ok result, got: {res2.get('error')}")
    got_verts = res2["metadata"]["vertices_detected"]
    _assert(2 <= got_verts <= 8, f"Expected 2-8 vertices for 4-pt piecewise, got {got_verts}")
    results.append({"name": "synthetic_coloured_piecewise", "ok": True, "vertices": got_verts})

    # Test 4: Quadratic profile should accept curve-family fitting
    x = np.linspace(-3.0, 3.0, 180)
    y = 0.4 * x * x - 1.2
    quad_profile = ProfileData(
        x_px=np.arange(len(x), dtype=float),
        y_px=np.zeros_like(x),
        x=x,
        y=y,
        y_smooth=y,
        sample_count=len(x),
        coverage_ratio=0.75,
        noise_sigma=0.01,
    )
    quad_fit = select_curve_family(quad_profile)
    _assert(bool(quad_fit.get("accepted")), f"Quadratic fit not accepted: {quad_fit.get('reason')}")
    _assert(quad_fit.get("best") is not None, "Quadratic best fit missing")
    results.append({
        "name": "quadratic_family_fit",
        "ok": True,
        "family": quad_fit["best"].family,
        "confidence": round(quad_fit["best"].confidence, 3),
    })

    # Test 5: Exponential profile should accept curve-family fitting
    x2 = np.linspace(-2.0, 2.0, 160)
    y2 = 1.5 * np.exp(0.6 * x2) + 0.8
    exp_profile = ProfileData(
        x_px=np.arange(len(x2), dtype=float),
        y_px=np.zeros_like(x2),
        x=x2,
        y=y2,
        y_smooth=y2,
        sample_count=len(x2),
        coverage_ratio=0.7,
        noise_sigma=0.01,
    )
    exp_fit = select_curve_family(exp_profile)
    _assert(bool(exp_fit.get("accepted")), f"Exponential fit not accepted: {exp_fit.get('reason')}")
    _assert(exp_fit.get("best") is not None, "Exponential best fit missing")
    results.append({
        "name": "exponential_family_fit",
        "ok": True,
        "family": exp_fit["best"].family,
        "confidence": round(exp_fit["best"].confidence, 3),
    })

    return {"ok": True, "testsRun": len(results), "results": results}


# ── CLI ────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Deterministic CV graph extraction")
    parser.add_argument("--input",      help="Base64 image or JSON payload")
    parser.add_argument("--input-file", help="JSON file with { image } or { images } payload")
    parser.add_argument("--output",     help="Output file (default stdout)")
    parser.add_argument("--self-test",  action="store_true", help="Run built-in regression tests")
    args = parser.parse_args()

    try:
        if args.self_test:
            result = run_self_tests()
            out = json.dumps(result, indent=2)
            Path(args.output).write_text(out, encoding="utf-8") if args.output else print(out)
            return

        if args.input_file:
            data = json.loads(Path(args.input_file).read_text(encoding="utf-8"))
            imgs = data.get("images")
            b64  = imgs[0] if isinstance(imgs, list) and imgs else data.get("image")
        elif args.input:
            if args.input.startswith('{'):
                data = json.loads(args.input)
                imgs = data.get("images")
                b64  = imgs[0] if isinstance(imgs, list) and imgs else data.get("image")
            else:
                b64 = args.input
        else:
            raise ValueError("--input or --input-file required")

        if not b64:
            raise ValueError("No base64 image payload found")

        result = extract_graph_cv(b64)
        out = json.dumps(result, indent=2)
        Path(args.output).write_text(out) if args.output else print(out)

    except Exception as e:
        print(json.dumps({"error": str(e)}, indent=2), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
