"""
NA scan pipeline -- stage 4: crop extraction.

Given a student's split packet PDF (produced by stage 2) and the packet
version's locked anchor manifest (produced by stage 0, already in
na_anchors), extracts one image crop per anchor: the region of that
student's actual scanned page corresponding to a single answer box.

DELIBERATELY NOT using page-identity matching (ORB/RANSAC fingerprinting).
That was built and validated in an earlier pilot (78/78 correct across 3
real packets) but was a decision point, not a default: confirmed with
Pablo that scans are "98% of the time clean, sequential" -- so this module
assumes scan page N of a student's packet IS master page N-1, with no
model or feature-matching call needed for the common case. If that
assumption is wrong for a given page, we can only detect it as a symptom
(garbage/blank crop, wrong content) -- not confirm it directly -- so
crop_page_count_mismatch() below is a cheap pre-check: if the student's
split PDF doesn't have exactly the packet's expected page count, something
is already off (a missing/extra sheet) and deterministic mapping should
not be trusted blindly for that student. The caller decides what to do
with that signal (flag for teacher review, or fall back to real page-
identity matching via the same ORB approach proven in the pilot -- not
implemented here, since it was never needed to validate this path).

Rotation: unlike the pilot's scans, which were confirmed upside-down with
rotation baked into the pixels, stage 1's cover-page reading already
required correct-orientation input (na-scanning.ts sends single pages
straight to Haiku with no de-rotation, and roster grounding worked -- see
platform/lib/na-scanning.ts), so pages reaching this module are assumed
right-side-up. rotation_hint lets a caller override this per page if a
future batch turns out to need it; default is 0.

Adaptive boundary expansion is ported from the validated pilot with no
behavioural changes: grow a crop's right/bottom edge outward while ink
density right at that edge stays above threshold (evidence writing
continues past the current boundary), capped by expand_max_x1_pt /
expand_max_y1_pt from na_anchors (the next anchor's position, or the page
edge) so one overflowing answer can never swallow the next question's box.
The pilot's two real bugs -- expansion math done in raw rotated-scan pixel
space silently inverting "right/down", and a duplicate rotation call
undoing the first fix -- are avoided here structurally: this module
renders the page upright FIRST (via rotation_hint, applied once, before
any cropping or expansion), then does all cropping and expansion in that
single consistent orientation. There is no second rotation step anywhere
below.
"""

from __future__ import annotations

import base64
import io
from dataclasses import dataclass
from typing import Any

import cv2
import fitz  # PyMuPDF
import numpy as np

# Render resolution for crops. 200dpi was what the pilot confirmed
# produces legible handwriting; matches CROP_DPI used there.
CROP_DPI = 200
PT_TO_PX = CROP_DPI / 72.0

# Bleed added on every side before adaptive expansion has a chance to run,
# in PDF points -- matches the pilot's CROP_BLEED_PT. This is a small
# fixed margin for normal cases; adaptive expansion only grows further if
# ink is actually found touching the (bleed-expanded) edge.
CROP_BLEED_PT = 3.0

# Adaptive expansion parameters, unchanged from the pilot.
EXPAND_STEP_PT = 8.0
EXPAND_DENSITY_THRESHOLD = 0.05
EXPAND_MAX_STEPS = 12
EXPAND_BAND_FRAC = 0.06


@dataclass
class Anchor:
    """One answer-box location, as stored in na_anchors."""

    qid: str
    page_index: int  # 0-indexed page within the packet master
    x0_pt: float
    y0_pt: float
    x1_pt: float
    y1_pt: float
    expand_max_x1_pt: float | None = None
    expand_max_y1_pt: float | None = None


@dataclass
class CropResult:
    qid: str
    page_index: int
    image_base64: str  # PNG, base64-encoded
    expanded: bool  # True if adaptive expansion grew the crop beyond bleed
    warnings: list[str]


def crop_page_count_mismatch(student_pdf_bytes: bytes, expected_page_count: int) -> int | None:
    """Returns the student PDF's actual page count if it differs from
    expected_page_count, else None. A cheap pre-check the caller should
    run before trusting deterministic page-N-to-master-N-1 mapping for
    this student -- see module docstring."""
    doc = fitz.open(stream=student_pdf_bytes, filetype="pdf")
    actual = doc.page_count
    doc.close()
    return None if actual == expected_page_count else actual


def _edge_ink_density(gray_img: np.ndarray, side: str, band_frac: float = EXPAND_BAND_FRAC) -> float:
    """Ink density in a thin band just inside one edge of a crop --
    unchanged from the pilot. Used to detect whether student writing is
    touching (and likely continuing past) that edge."""
    h, w = gray_img.shape
    if side == "right":
        band = gray_img[:, int(w * (1 - band_frac)) :]
    elif side == "bottom":
        band = gray_img[int(h * (1 - band_frac)) :, :]
    else:
        raise ValueError(side)
    if band.size == 0:
        return 0.0
    return float((band < 200).sum()) / band.size


def _adaptive_crop_bounds(
    page_img: np.ndarray,
    bx0: int,
    by0: int,
    bx1: int,
    by1: int,
    max_bx1: int,
    max_by1: int,
    step_px: int,
) -> tuple[int, int, bool]:
    """Grow a crop's right/bottom edges outward, one step at a time, while
    ink density right at that edge stays above threshold. Capped by
    (max_bx1, max_by1). Ported unchanged from the pilot's
    adaptive_crop_bounds, operating here in already-upright page pixel
    space (see module docstring on why that ordering matters).

    Returns (final_bx1, final_by1, expanded)."""
    cur_bx1, cur_by1 = bx1, by1
    expanded = False
    for _ in range(EXPAND_MAX_STEPS):
        grew = False
        crop = page_img[by0:cur_by1, bx0:cur_bx1]
        if crop.size == 0:
            break
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.ndim == 3 else crop

        if cur_bx1 < max_bx1:
            if _edge_ink_density(gray, "right") > EXPAND_DENSITY_THRESHOLD:
                cur_bx1 = min(max_bx1, cur_bx1 + step_px)
                grew = True
                expanded = True

        if cur_by1 < max_by1:
            if _edge_ink_density(gray, "bottom") > EXPAND_DENSITY_THRESHOLD:
                cur_by1 = min(max_by1, cur_by1 + step_px)
                grew = True
                expanded = True

        if not grew:
            break
    return cur_bx1, cur_by1, expanded


def _render_page_upright(doc: fitz.Document, page_index: int, rotation_hint: int) -> np.ndarray:
    """Renders one page at CROP_DPI as a BGR numpy array, applying
    rotation_hint (degrees, applied once) so the page is upright before
    any cropping happens. Default rotation_hint=0 assumes pages already
    arrive upright -- see module docstring."""
    page = doc[page_index]
    mat = fitz.Matrix(CROP_DPI / 72, CROP_DPI / 72)
    if rotation_hint:
        mat = mat.prerotate(rotation_hint)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
    if pix.n == 3:
        img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
    return img


def extract_crops(
    student_pdf_bytes: bytes,
    anchors: list[Anchor],
    rotation_hint: int = 0,
) -> list[CropResult]:
    """Extracts one crop per anchor from a student's split packet PDF.

    Page mapping is deterministic: anchor.page_index (0-indexed, matching
    the master) is read directly as the same 0-indexed page of
    student_pdf_bytes. No page-identity matching is performed -- see
    module docstring for why, and for what to do if that assumption might
    not hold for a given upload.
    """
    doc = fitz.open(stream=student_pdf_bytes, filetype="pdf")
    results: list[CropResult] = []

    # Group anchors by page so each page is only rendered once.
    by_page: dict[int, list[Anchor]] = {}
    for a in anchors:
        by_page.setdefault(a.page_index, []).append(a)

    for page_index, page_anchors in by_page.items():
        warnings: list[str] = []
        if page_index < 0 or page_index >= doc.page_count:
            for a in page_anchors:
                results.append(
                    CropResult(
                        qid=a.qid,
                        page_index=page_index,
                        image_base64="",
                        expanded=False,
                        warnings=[
                            f"page_index {page_index} is out of range for this student's "
                            f"{doc.page_count}-page packet -- likely a missing page or a "
                            "page-count mismatch that should have been caught by "
                            "crop_page_count_mismatch() before calling extract_crops()."
                        ],
                    )
                )
            continue

        page_img = _render_page_upright(doc, page_index, rotation_hint)
        page_h, page_w = page_img.shape[:2]

        for a in page_anchors:
            bleed_px = CROP_BLEED_PT * PT_TO_PX
            bx0 = max(0, int((a.x0_pt) * PT_TO_PX - bleed_px))
            by0 = max(0, int((a.y0_pt) * PT_TO_PX - bleed_px))
            bx1 = min(page_w, int((a.x1_pt) * PT_TO_PX + bleed_px))
            by1 = min(page_h, int((a.y1_pt) * PT_TO_PX + bleed_px))

            max_bx1 = (
                min(page_w, int(a.expand_max_x1_pt * PT_TO_PX))
                if a.expand_max_x1_pt is not None
                else page_w
            )
            max_by1 = (
                min(page_h, int(a.expand_max_y1_pt * PT_TO_PX))
                if a.expand_max_y1_pt is not None
                else page_h
            )
            step_px = int(EXPAND_STEP_PT * PT_TO_PX)

            final_bx1, final_by1, expanded = _adaptive_crop_bounds(
                page_img, bx0, by0, bx1, by1, max_bx1, max_by1, step_px
            )

            crop = page_img[by0:final_by1, bx0:final_bx1]
            page_warnings = list(warnings)
            if crop.size == 0:
                page_warnings.append(
                    f"Anchor {a.qid}: computed crop region is empty (bx0={bx0}, by0={by0}, "
                    f"bx1={final_bx1}, by1={final_by1}) -- check anchor coordinates against "
                    f"this page's actual size ({page_w}x{page_h}px at {CROP_DPI}dpi)."
                )
                results.append(
                    CropResult(
                        qid=a.qid,
                        page_index=page_index,
                        image_base64="",
                        expanded=False,
                        warnings=page_warnings,
                    )
                )
                continue

            ok, buf = cv2.imencode(".png", crop)
            if not ok:
                page_warnings.append(f"Anchor {a.qid}: PNG encoding failed.")
                results.append(
                    CropResult(
                        qid=a.qid,
                        page_index=page_index,
                        image_base64="",
                        expanded=expanded,
                        warnings=page_warnings,
                    )
                )
                continue

            results.append(
                CropResult(
                    qid=a.qid,
                    page_index=page_index,
                    image_base64=base64.b64encode(buf.tobytes()).decode("ascii"),
                    expanded=expanded,
                    warnings=page_warnings,
                )
            )

    doc.close()
    return results
