"""Answer-box Printed answer-box detection for scanned A.1-style packets (per-row banded accent-bar tracking).

A scan can be translated (Maia/Matteo: ~+12pt) and slightly rotated, so a
row belongs to the bar if ANYWHERE in a +-7pt band around the scan's bar
column there is a locally dense dark window ~1.5-3pt wide. Banner rows
(dark across the page width) are filtered per run.
"""
import json, sys
import numpy as np
import fitz

DPI = 150
SCALE = DPI / 72.0
CANON_X = 50.83

def _gray(page, rect):
    pix = page.get_pixmap(clip=rect, dpi=DPI, colorspace=fitz.csGRAY)
    return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width).astype(int)

def find_bar_x(doc, probe_pages=(8, 12, 22)):
    scores = {}
    for p in probe_pages:
        if p >= len(doc):
            continue
        arr = _gray(doc[p], fitz.Rect(40, 0, 78, doc[p].rect.y1))
        dark = arr < 215
        for x0 in np.arange(43.0, 72.0, 0.5):
            c0 = int((x0 - 40) * SCALE)
            c1 = int((x0 + 2.5 - 40) * SCALE)
            frac = dark[:, c0:c1].mean(axis=1) > 0.6
            scores[x0] = scores.get(x0, 0) + frac.mean()
    if not scores:
        return CANON_X
    return float(max(scores, key=scores.get))

def page_runs(page, bar_x, min_run_pt=12.0):
    band = _gray(page, fitz.Rect(bar_x - 7.0, 0, bar_x + 9.0, page.rect.y1))
    dark = band < 215
    # per-row: max dark coverage over any sliding window ~2.2pt wide
    w = max(3, int(2.2 * SCALE))
    kernel = np.ones(w)
    conv = np.apply_along_axis(lambda r: np.convolve(r, kernel, mode="valid"), 1, dark.astype(float))
    marked = (conv.max(axis=1) / w) > 0.75

    wide = _gray(page, fitz.Rect(90, 0, 520, page.rect.y1))
    n = min(len(marked), wide.shape[0])
    widedark = (wide[:n] < 200).mean(axis=1)

    runs = []
    start = None
    gap = 0
    max_gap = int(4 * SCALE)
    for i in range(n):
        if marked[i]:
            if start is None:
                start = i
            gap = 0
        elif start is not None:
            gap += 1
            if gap > max_gap:
                end = i - gap
                if (end - start) / SCALE >= min_run_pt:
                    runs.append((start, end))
                start = None
                gap = 0
    if start is not None:
        end = n - 1 - gap
        if (end - start) / SCALE >= min_run_pt:
            runs.append((start, end))
    return [
        (round(s / SCALE, 1), round(e / SCALE, 1))
        for s, e in runs
        if widedark[s:e + 1].mean() <= 0.35
    ]

def detect(pdf_path, pages):
    doc = fitz.open(pdf_path)
    bar_x = find_bar_x(doc)
    out = {"bar_x": round(bar_x, 2), "dx": round(bar_x - CANON_X, 2), "pages": {}}
    for p in pages:
        if p >= len(doc):
            continue
        out["pages"][str(p)] = page_runs(doc[p], bar_x)
    return out

if __name__ == "__main__":
    print(json.dumps(detect(sys.argv[1], [int(p) for p in sys.argv[2].split(",")]), indent=1))
