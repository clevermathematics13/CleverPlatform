"""
Debug/authoring tool for the NA scan pipeline -- NOT part of the stage
1-5 pipeline itself.

Re-runs the same class of detection the original 39 A.1 anchors came
from (na_packet_versions.anchor_source = 'auto_fillrect': filled
rectangle shapes), scoped to a single page, so a human can read off real
coordinates for a question the original automated pass missed.

Built specifically because A.1's Q26(a) ("Plot all the possible
combinations as points on a grid") has no anchor. Verified locally on a
synthetic page before being trusted: a filled rectangle (what
auto_fillrect catches) comes back from PyMuPDF as one drawing object with
type 'fs' and a real fill color and a sane bounding rect. A ruled grid --
the shape a "plot points on a grid" question is actually likely to use --
comes back as many individual STROKE-ONLY line fragments (type 's',
fill=None), each with a degenerate rect (zero width or zero height,
since each fragment is one line), and no single object represents "the
whole grid". That is exactly why auto_fillrect would have missed it: a
detector looking for filled rectangles has nothing to find.

This module therefore reports two candidate categories, not one:
  - filled: shapes with a fill color, comparable to what auto_fillrect
    already found for the other 39 anchors.
  - grid_clusters: stroke-only line fragments merged by proximity
    (union-find over pairwise bounding-box overlap, expanded by
    CLUSTER_PAD_PT) into single bounding boxes -- reconstructing "this
    dense cluster of ruled lines is one grid" from many degenerate single-
    line fragments. fragment_count is included so a human reviewing
    candidates can tell a real ruled grid (many fragments) apart from a
    single stray line (one fragment).

This is deliberately read-only and returns CANDIDATES for a human to
choose from -- it does not create an na_anchors row itself. Placing an
anchor is a real decision (which candidate, how much bleed to add) that
deserves a person looking at the actual rendered page, not an automatic
pick of "whichever region is biggest".
"""

from __future__ import annotations

from dataclasses import dataclass, field

import fitz  # PyMuPDF

CLUSTER_PAD_PT = 15.0


@dataclass
class RectCandidate:
    x0_pt: float
    y0_pt: float
    x1_pt: float
    y1_pt: float
    kind: str  # "filled" | "grid_cluster"
    fragment_count: int = 1
    fill_rgb: tuple[float, float, float] | None = None


def _union_find_clusters(rects: list[fitz.Rect], pad: float) -> list[tuple[fitz.Rect, int]]:
    """Merges rects into clusters using union-find over pairwise proximity
    (expand each rect by pad, test intersection). O(n^2) pairwise checks,
    which is fine here -- a single PDF page has at most a few dozen
    drawing fragments, not thousands. Verified correct on a synthetic
    18-fragment ruled grid before being trusted (a naive iterative-merge
    loop was tried first and found to silently under-merge; union-find
    was used instead specifically because it's correct by construction,
    not because it was the first approach tried)."""
    n = len(rects)
    if n == 0:
        return []
    parent = list(range(n))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i: int, j: int) -> None:
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[ri] = rj

    for i in range(n):
        expanded = fitz.Rect(rects[i].x0 - pad, rects[i].y0 - pad, rects[i].x1 + pad, rects[i].y1 + pad)
        for j in range(i + 1, n):
            if expanded.intersects(rects[j]):
                union(i, j)

    groups: dict[int, list[fitz.Rect]] = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(rects[i])

    out: list[tuple[fitz.Rect, int]] = []
    for members in groups.values():
        x0 = min(r.x0 for r in members)
        y0 = min(r.y0 for r in members)
        x1 = max(r.x1 for r in members)
        y1 = max(r.y1 for r in members)
        out.append((fitz.Rect(x0, y0, x1, y1), len(members)))
    return out


def inspect_fillrects(pdf_bytes: bytes, page_index: int) -> dict:
    """Returns candidate answer-region rectangles on one page, split into
    filled shapes and clustered stroke-only regions. page_index is
    0-indexed. Raises ValueError if page_index is out of range."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        if page_index < 0 or page_index >= doc.page_count:
            raise ValueError(f"page_index {page_index} out of range for a {doc.page_count}-page document")

        page = doc[page_index]
        page_w, page_h = page.rect.width, page.rect.height
        drawings = page.get_drawings()

        filled_candidates: list[RectCandidate] = []
        stroke_rects: list[fitz.Rect] = []

        for d in drawings:
            rect = fitz.Rect(d.get("rect"))
            # Degenerate (zero-area) individual fragments are common for
            # both stray hairlines and each single side of a ruled grid --
            # skip only truly zero-area ones with no extent at all in
            # either dimension, since a zero-width vertical line is a
            # normal grid fragment we WANT to cluster, not noise.
            if rect.width <= 0 and rect.height <= 0:
                continue
            fill = d.get("fill")
            if fill is not None:
                filled_candidates.append(
                    RectCandidate(
                        x0_pt=round(rect.x0, 2),
                        y0_pt=round(rect.y0, 2),
                        x1_pt=round(rect.x1, 2),
                        y1_pt=round(rect.y1, 2),
                        kind="filled",
                        fill_rgb=tuple(round(c, 3) for c in fill) if fill else None,
                    )
                )
            else:
                stroke_rects.append(rect)

        clusters = _union_find_clusters(stroke_rects, CLUSTER_PAD_PT)
        grid_candidates = [
            RectCandidate(
                x0_pt=round(rect.x0, 2),
                y0_pt=round(rect.y0, 2),
                x1_pt=round(rect.x1, 2),
                y1_pt=round(rect.y1, 2),
                kind="grid_cluster",
                fragment_count=count,
            )
            # Single stray lines aren't useful candidates for "the grid";
            # require at least a handful of fragments merged together to
            # surface as a real candidate region.
            for rect, count in clusters
            if count >= 4
        ]

        return {
            "pageIndex": page_index,
            "pageWidthPt": round(page_w, 2),
            "pageHeightPt": round(page_h, 2),
            "filled": [c.__dict__ for c in filled_candidates],
            "gridClusters": [c.__dict__ for c in grid_candidates],
            "rawDrawingCount": len(drawings),
        }
    finally:
        doc.close()
