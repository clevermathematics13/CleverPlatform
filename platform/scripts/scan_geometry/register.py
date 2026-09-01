"""Per-scan-page registration against the two A.1 print editions.

Reference = bar runs (top/bottom of each printed box's accent bar) for
each edition, in canonical A4 pt. For a scan page's detected runs, fit
y' = s*y + dy by least squares over matched run endpoints, for each
edition; the edition with the lower residual wins. dx comes from the
scan's detected bar column.

Matching: try all contiguous alignments of detected runs against
reference runs (detected may have extra runs from handwriting or be
missing some); a candidate match contributes its endpoints. Fit is
accepted when >=2 runs match with rms residual < 3pt.
"""
import itertools
import numpy as np

def fit_s_dy(ref_pts, obs_pts):
    A = np.vstack([ref_pts, np.ones(len(ref_pts))]).T
    (s, dy), res, *_ = np.linalg.lstsq(A, np.array(obs_pts), rcond=None)
    pred = A @ np.array([s, dy])
    rms = float(np.sqrt(np.mean((pred - obs_pts) ** 2)))
    return float(s), float(dy), rms

def match_and_fit(ref_runs, obs_runs, s_bounds=(0.85, 1.05)):
    """Best (s, dy, rms, nmatched) over subsets: choose for each obs run a
    ref run (order-preserving, injective) -- small sets so brute force."""
    best = None
    nr, no = len(ref_runs), len(obs_runs)
    if nr == 0 or no == 0:
        return None
    for ref_idx in itertools.combinations(range(nr), min(nr, no)):
        for obs_idx in itertools.combinations(range(no), len(ref_idx)):
            ref_pts, obs_pts = [], []
            for ri, oi in zip(ref_idx, obs_idx):
                ref_pts += list(ref_runs[ri])
                obs_pts += list(obs_runs[oi])
            if len(ref_pts) < 4:
                continue
            s, dy, rms = fit_s_dy(ref_pts, obs_pts)
            if not (s_bounds[0] <= s <= s_bounds[1]):
                continue
            n = len(ref_idx)
            score = (n, -rms)
            if rms < 3.0 and (best is None or score > best[0]):
                best = (score, {"s": round(s, 4), "dy": round(dy, 2), "rms": round(rms, 2), "n": n})
    return best[1] if best else None

def classify_page(obs_runs, ref_v1, ref_v2):
    f1 = match_and_fit(ref_v1, obs_runs) if ref_v1 else None
    f2 = match_and_fit(ref_v2, obs_runs) if ref_v2 else None
    if f1 and f2:
        # prefer more matches; then lower rms
        if (f1["n"], -f1["rms"]) >= (f2["n"], -f2["rms"]):
            return "v1", f1, f2
        return "v2", f2, f1
    if f1:
        return "v1", f1, None
    if f2:
        return "v2", f2, None
    return None, None, None
