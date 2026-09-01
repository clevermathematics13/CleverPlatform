"""Build the canonical reference JSON that normalize.py registers against.

Sources, best first:
  1. A packet version's stored master PDF (typst_metadata packets) --
     vector-clean, zero scan noise.
  2. One or more known-good student scans (1:1 scale, near-zero offset),
     whose bar runs are cross-validated pairwise: a run counts only when
     at least two sources agree within 3pt (or a single source is given).

Output JSON: { "bar_x": {page: pt}, "runs": {page: [[top, bottom], ...]},
"profiles": {page: [dark-row fractions]} } for every page that has runs.

Usage:
  python3 -m scripts.scan_geometry.build_reference \
    --pdf master.pdf [--pdf good-scan-2.pdf ...] \
    --pages 3,4,5,... --out a1_reference.json
"""
from __future__ import annotations

import argparse
import json

import fitz
import numpy as np

from . import bars
from .normalize import dark_profile, page_bar_x


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", action="append", required=True)
    ap.add_argument("--pages", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    pages = [int(p) for p in args.pages.split(",")]
    docs = [fitz.open(p) for p in args.pdf]

    out = {"bar_x": {}, "runs": {}, "profiles": {}}
    for p in pages:
        per_doc = []
        bar_xs = []
        for doc in docs:
            if p >= len(doc):
                continue
            bx, score = page_bar_x(doc[p])
            bar_xs.append(bx)
            per_doc.append(bars.page_runs(doc[p], bx))
        if not per_doc:
            continue
        scaffold = per_doc[0]
        merged = []
        for run in scaffold:
            close = [r for lst in per_doc[1:] for r in lst if abs(r[0] - run[0]) < 3 and abs(r[1] - run[1]) < 3]
            if close or len(per_doc) == 1:
                tops = [run[0]] + [c[0] for c in close]
                bots = [run[1]] + [c[1] for c in close]
                merged.append([float(np.median(tops)), float(np.median(bots))])
        out["bar_x"][str(p)] = float(np.median(bar_xs))
        out["runs"][str(p)] = merged
        out["profiles"][str(p)] = [round(float(v), 4) for v in dark_profile(docs[0][p])]

    json.dump(out, open(args.out, "w"))
    print(f"reference written: {args.out} ({len(out['runs'])} pages)")


if __name__ == "__main__":
    main()
