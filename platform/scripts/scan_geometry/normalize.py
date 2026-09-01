"""Register every page of every scan against a canonical reference, warp
out-of-tolerance scans back to canonical A4 space, and verify the result.

See README.md in this directory for why this exists and how to run it.
Committed as the reusable form of the 1 Sep 2026 normalization (HANDOFF
§5): the one-off analysis lived in the session scratchpad; this is the
same logic, parameterized by a reference JSON so any packet — ideally a
typst_metadata packet with a stored master PDF — can use it.

Method summary (each choice earned by a failure during development):
- Primary fit: matched accent-bar runs -> least squares s/dy
  (register.py). Only accepted at rms < 3pt with >= 2 matched boxes.
- Fallback: banner-weighted dark-profile correlation (gray < 130), which
  sees section banners/headings but not ruled lines or pencil. A
  light-threshold profile aliases against ruled-line periodicity and
  produced dy errors of a full box height — do not lower the threshold.
- Ambiguity: among correlation peaks within 0.04 of the best, prefer the
  one nearest the scan's run-fit median dy.
- Verification: after warping, every page must re-register at |dy| <= 3pt
  (dark-profile correlation vs the reference at s=1). Failures are
  reported, never silently accepted.
"""
from __future__ import annotations

import argparse
import json
import os

import cv2
import fitz
import numpy as np

from . import bars
from . import register

PROF_DPI = 50
TOL_DY, TOL_DX, TOL_S = 4.0, 4.0, 0.012
NORM_DPI = 300
JPEG_QUALITY = 82
A4_W_PT, A4_H_PT = 595, 842


def dark_profile(page, dpi=PROF_DPI):
    pix = page.get_pixmap(clip=fitz.Rect(45, 0, 560, page.rect.y1), dpi=dpi, colorspace=fitz.csGRAY)
    arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width).astype(float)
    return (arr < 130).mean(axis=1)


def corr_at(prof_obs, prof_ref, s, dy_pt, dpi=PROF_DPI):
    n = len(prof_ref)
    idx = (np.arange(n) * s + dy_pt * dpi / 72.0).round().astype(int)
    ok = (idx >= 0) & (idx < len(prof_obs))
    if ok.sum() < n * 0.5:
        return None
    a, b = np.asarray(prof_ref)[ok], prof_obs[idx[ok]]
    if a.std() < 1e-6 or b.std() < 1e-6:
        return None
    return float(np.corrcoef(a, b)[0, 1])


def corr_candidates(prof_obs, prof_ref, s, lo=-75, hi=75):
    scores = {}
    for dy in np.arange(lo, hi + 0.5, 1.0):
        c = corr_at(prof_obs, prof_ref, s, dy)
        if c is not None:
            scores[float(dy)] = c
    if not scores:
        return []
    best = max(scores.values())
    return sorted(
        [(dy, c) for dy, c in scores.items() if c >= best - 0.04 and c > 0.45],
        key=lambda t: -t[1],
    )


def page_bar_x(page):
    scores = {}
    arr = bars._gray(page, fitz.Rect(38, 0, 92, page.rect.y1))
    dark = arr < 215
    for x0 in np.arange(41.0, 88.0, 0.5):
        c0 = int((x0 - 38) * bars.SCALE)
        c1 = int((x0 + 2.5 - 38) * bars.SCALE)
        frac = dark[:, c0:c1].mean(axis=1) > 0.6
        scores[x0] = frac.mean()
    x = max(scores, key=scores.get)
    return float(x), scores[x]


def single_run_fits(ref_runs, obs_runs, target_s, tol_s=0.025):
    """(s, dy, residual) for every 1:1 run pairing whose implied scale is
    near target_s. A single box exactly determines (s, dy); the residual is
    the top/bottom dy disagreement -- 0 for a clean pairing."""
    out = []
    for rr in ref_runs:
        rh = rr[1] - rr[0]
        if rh < 20:
            continue
        for orun in obs_runs:
            s = (orun[1] - orun[0]) / rh
            if abs(s - target_s) > tol_s:
                continue
            dy = orun[0] - s * rr[0]
            dy2 = orun[1] - s * rr[1]
            out.append((s, (dy + dy2) / 2, abs(dy - dy2)))
    return sorted(out, key=lambda t: t[2])


def fit_scan(pdf_path, ref):
    """Duplex scanning gives ODD and EVEN pages independent copier passes
    (the 1 Sep cohort had s=0.914/dx=+9 fronts against s=0.87/dx=+23
    backs), so every fallback pools statistics per page PARITY, never
    across the whole scan."""
    doc = fitz.open(pdf_path)
    pages_out = {}
    parity_s = {0: [], 1: []}
    parity_dx = {0: [], 1: []}
    parity_dy = {0: [], 1: []}
    obs_cache = {}
    for p_str, ref_runs in ref["runs"].items():
        p = int(p_str)
        if p >= len(doc):
            continue
        page = doc[p]
        bx, bscore = page_bar_x(page)
        dx = bx - ref["bar_x"].get(p_str, 51.5) if bscore > 0.05 else None
        obs = bars.page_runs(page, bx)
        obs_cache[p_str] = obs
        fit = register.match_and_fit(ref_runs, obs) if ref_runs else None
        if fit and fit["n"] >= 2:
            pages_out[p_str] = {"s": fit["s"], "dy": fit["dy"], "dx": dx, "method": "runs", "rms": fit["rms"], "n": fit["n"]}
            parity_s[p % 2].append(fit["s"])
            parity_dy[p % 2].append(fit["dy"])
            if dx is not None:
                parity_dx[p % 2].append(dx)
        else:
            pages_out[p_str] = {"dx": dx, "method": "pending"}

    def pmed(pool, p, fallback):
        vals = pool[p % 2] or pool[(p + 1) % 2]
        return float(np.median(vals)) if vals else fallback

    for p_str, v in pages_out.items():
        if v["method"] != "pending":
            continue
        p = int(p_str)
        target_s = pmed(parity_s, p, 1.0)
        cands = single_run_fits(ref["runs"][p_str], obs_cache.get(p_str, []), target_s)
        if cands and cands[0][2] < 4.0:
            s, dy, resid = cands[0]
            v.update({"s": float(s), "dy": float(dy), "method": "run1", "resid": round(resid, 2)})
        else:
            corr = corr_candidates(dark_profile(doc[p]), ref["profiles"][p_str], target_s)
            near = pmed(parity_dy, p, 0.0)
            if corr:
                pick = min(corr, key=lambda t: abs(t[0] - near))
                v.update({"s": target_s, "dy": float(pick[0]), "method": "darkcorr", "corr": round(pick[1], 3)})
            else:
                v.update({"s": target_s, "dy": near, "method": "inherited"})
        if v.get("dx") is None:
            v["dx"] = pmed(parity_dx, p, 0.0)
    for p_str, v in pages_out.items():
        if v.get("dx") is None:
            v["dx"] = pmed(parity_dx, int(p_str), 0.0)
    needs = any(
        abs(v["dy"]) > TOL_DY or abs(v["dx"]) > TOL_DX or abs(v["s"] - 1) > TOL_S
        for v in pages_out.values()
        if "s" in v
    )
    all_s = [v["s"] for v in pages_out.values() if "s" in v]
    all_dx = [v["dx"] for v in pages_out.values() if v.get("dx") is not None]
    return {
        "pages": pages_out,
        "median_s": round(float(np.median(all_s)), 4) if all_s else 1.0,
        "median_dx": round(float(np.median(all_dx)), 2) if all_dx else 0.0,
        "needs_norm": needs,
    }


def normalize_pdf(pdf_path, fit, out_path):
    doc = fitz.open(pdf_path)
    out = fitz.open()
    vals = [v for v in fit["pages"].values() if "s" in v]
    med = {
        "s": float(np.median([v["s"] for v in vals])) if vals else 1.0,
        "dy": float(np.median([v["dy"] for v in vals])) if vals else 0.0,
        "dx": float(np.median([v["dx"] for v in vals])) if vals else 0.0,
    }
    W, H = int(A4_W_PT * NORM_DPI / 72), int(A4_H_PT * NORM_DPI / 72)
    for i in range(len(doc)):
        t = fit["pages"].get(str(i), med)
        s, dy, dx = t.get("s", med["s"]), t.get("dy", med["dy"]), t.get("dx", med["dx"])
        pix = doc[i].get_pixmap(dpi=NORM_DPI, colorspace=fitz.csRGB)
        img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
        k = NORM_DPI / 72.0
        M = np.array([[1 / s, 0, -dx * k / s], [0, 1 / s, -dy * k / s]], dtype=np.float64)
        warped = cv2.warpAffine(img, M, (W, H), flags=cv2.INTER_AREA, borderMode=cv2.BORDER_CONSTANT, borderValue=(255, 255, 255))
        ok, enc = cv2.imencode(".jpg", cv2.cvtColor(warped, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
        page = out.new_page(width=A4_W_PT, height=A4_H_PT)
        page.insert_image(fitz.Rect(0, 0, A4_W_PT, A4_H_PT), stream=enc.tobytes())
    out.save(out_path, deflate=True, garbage=3)
    out.close()


def verify_pdf(pdf_path, ref):
    """Re-registers each normalized page against the reference using bar
    runs -- print-only, so a student's handwriting cannot fool it
    (a dark-profile verifier tried first drowned in pen-heavy pages).
    Pages whose bars were undetectable to begin with come back
    'unverifiable' rather than pass/fail."""
    doc = fitz.open(pdf_path)
    bad = []
    unverifiable = []
    for p_str, ref_runs in ref["runs"].items():
        p = int(p_str)
        if p >= len(doc) or not ref_runs:
            continue
        bx, _ = page_bar_x(doc[p])
        obs = bars.page_runs(doc[p], bx)
        fit = register.match_and_fit(ref_runs, obs, s_bounds=(0.97, 1.03))
        if fit and fit["n"] >= 1:
            if abs(fit["dy"]) > 3.0 or abs(fit["s"] - 1.0) > 0.012:
                bad.append({"page": p, "s": fit["s"], "dy": fit["dy"], "n": fit["n"]})
            continue
        cands = single_run_fits(ref_runs, obs, 1.0, tol_s=0.015)
        if cands and cands[0][2] < 3.0:
            s, dy, _ = cands[0]
            if abs(dy) > 3.0:
                bad.append({"page": p, "s": round(s, 4), "dy": round(dy, 1), "n": 1})
            continue
        unverifiable.append(p)
    return bad, unverifiable


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reference", required=True)
    ap.add_argument("--manifest", required=True, help='[{"id": ..., "local": ...}, ...]')
    ap.add_argument("--outdir", default="normalized")
    ap.add_argument("--transforms-out", default="transforms.json")
    args = ap.parse_args()

    ref = json.load(open(args.reference))
    manifest = json.load(open(args.manifest))
    os.makedirs(args.outdir, exist_ok=True)

    results = {}
    for entry in manifest:
        fit = fit_scan(entry["local"], ref)
        results[entry["id"]] = {"local": entry["local"], **fit}
        if fit["needs_norm"]:
            outp = os.path.join(args.outdir, f"{entry['id']}.pdf")
            normalize_pdf(entry["local"], fit, outp)
            failures, unverifiable = verify_pdf(outp, ref)
            # Repair pass: verification measures the residual (s_r, dy_r)
            # directly, so a flagged page's transform can be corrected by
            # composition -- y = (y_in - dy*k)/s then (y' - dy_r)/s_r
            # collapses to s'' = s*s_r, dy'' = dy + s*dy_r. One iteration
            # is enough in practice (the residual is measured, not
            # guessed); whatever still fails after it is reported.
            if failures:
                for f in failures:
                    v = fit["pages"].get(str(f["page"]))
                    if v is None or "s" not in v:
                        continue
                    v["dy"] = v["dy"] + v["s"] * f["dy"]
                    v["s"] = v["s"] * f["s"]
                    v["repaired"] = True
                normalize_pdf(entry["local"], fit, outp)
                failures, unverifiable = verify_pdf(outp, ref)
            results[entry["id"]]["normalized_local"] = outp
            results[entry["id"]]["verify_failures"] = failures
            results[entry["id"]]["unverifiable_pages"] = unverifiable
            status = "VERIFIED" if not failures else f"CHECK {failures}"
            if unverifiable:
                status += f" (unverifiable: {unverifiable})"
        else:
            status = "in tolerance"
        print(f"{entry.get('student', entry['id'])} {status}")
    json.dump(results, open(args.transforms_out, "w"), indent=1)


if __name__ == "__main__":
    main()
