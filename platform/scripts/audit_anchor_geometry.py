"""
Reusable anchor-geometry audit for the NA scan pipeline.

Generalizes the one-off "left accent bar" true-border detector built and
validated by hand during the 27 Aug 2026 A.1 audit (see HANDOFF.md ss5,
"Full anchor-geometry audit") into a permanent, run-anytime tool -- so
every future packet gets the same check without a human having to
rediscover the method from a live incident again.

WHY THIS SHAPE OF FIX, NOT A RUNTIME ALGORITHM CHANGE:
HANDOFF.md documents a reverted attempt (PR#25/#26, "bridge ruled-paper
gaps") to fix this same class of truncation by loosening stage 4's
adaptive ink-density expansion (cv_crop_extract.py's
_adaptive_crop_bounds) to bridge blank gaps between ruled lines. It was
reverted the same day after a follow-up audit caught a crop that had
silently swallowed an unrelated PRINTED reference box, because ordinary
ink-density expansion cannot distinguish "more of the student's own
handwriting resumes" from "a new printed block started" -- a false
positive with no visible signal anything went wrong. The established,
safer alternative (used successfully for Q1/Q3/Q6/Q13(b)/Q19(c)/Q26(b)/
Q30/Q7(b)/Q11) is to fix the ANCHOR'S OWN GEOMETRY once, using a signal
that is independent of any student's handwriting: the printed left
accent bar every answer box template has. This script only ever proposes
changes to na_anchors' authored geometry -- it never touches the runtime
expansion algorithm.

METHOD:
For each anchor, sample a thin vertical strip just inside its printed
left border (a few pt right of x0_pt) and scan DOWNWARD from y0_pt,
looking for where the bar's own ink color run ends (turns white) --
that's the box's TRUE bottom border, independent of whatever a student
wrote inside it. Compared against y1_pt (the anchor's own un-expanded
height): true_border noticeably past y1_pt means the box is authored
shorter than it's printed -- the exact bug class this script exists to
catch (Q1(e), Q6, Q19(c), Q30 all shared this "authored a bit short"
root cause, whether or not their expand_max_y1_pt cap was already wide
enough to reach the true content -- see "Q1(e) truncation found again,
30 Aug 2026" in HANDOFF.md for why a wide-enough cap alone doesn't save
you: the runtime ink-density expansion can still stall in a blank gap
before ever reaching it).

Deliberately bounded, not wide-open: the search stops at a hard ceiling
(SEARCH_CEILING_PT past y0_pt, or the page bottom) to avoid exactly the
false-positive the 27 Aug audit hit on its first pass ("the scan had bled
through a too-small print gap into the NEXT anchor's bar"). A too-narrow
window can still miss a real undershoot on an unusually tall box; that's
a false negative, the safe direction to fail in, not a false positive.

Deliberately does NOT flag expand_max_y1_pt overshoot ("cap sits far past
the true border, might swallow the next printed block"). An earlier
version of this script tried that by raw distance and flagged 30+ of 40
real anchors in a working, previously-audited packet -- nearly all false
positives, since ordinary blank page space before the next question is
completely normal and safe, and there is no way to distinguish that from
genuine swallow risk (real printed content sitting in the gap, the Q11
class of bug) without actually detecting what's printed there, which
this script does not attempt. Don't add that check back without solving
that distinction first (see HANDOFF.md).

Read-only. Prints a report and proposed na_anchors patches (y1_pt only)
for a human to verify against the actual rendered page before applying
anything -- same trust-but-verify posture as every fix in the 27 Aug
audit, several of whose first-pass "problems" turned out to be detector
artifacts, not real bugs.

Usage:
  python3 audit_anchor_geometry.py --pdf <path-to-any-split-or-master-pdf> \\
      --anchors <path-to-anchors.json>

  anchors.json: an array of anchor dicts as the caller has them (from
  `select id, qid, page_index, x0_pt, y0_pt, x1_pt, y1_pt,
  expand_max_x1_pt, expand_max_y1_pt from na_anchors where
  packet_version_id = ...`, dumped to JSON -- this script has no direct
  database access by design, matching cv_crop_extract.py's own
  db-agnostic shape).
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass

import cv2
import fitz  # PyMuPDF
import numpy as np

CROP_DPI = 300
PT_TO_PX = CROP_DPI / 72.0

# How far right of x0_pt to sample the accent bar's own color -- must
# land solidly inside the bar's stroke, not past its edge. Measured
# directly against A.1's rendered pages: the printed accent bar is only
# ~2-2.5pt wide, so this needs to stay well under that, not "a few pt"
# (an earlier version of this script used 3.0pt here and it overshot the
# bar entirely, landing in white paper and silently skipping nearly every
# anchor -- caught by testing against a known-truncated anchor (A.1
# Q1(e)) before trusting this script's output for anything else).
BAR_SAMPLE_OFFSET_PT = 1.0

# How many consecutive white rows below the bar's own color confirm the
# bar has actually ended (vs. a single anti-aliased pixel mid-stroke).
WHITE_CONFIRM_ROWS = 6

# Hard ceiling on how far past the anchor's own y0_pt to search -- the
# bounded-window fix from the 27 Aug audit that stopped the detector from
# conflating one anchor's border with the NEXT anchor's own bar.
SEARCH_CEILING_PT = 150.0

WHITE_THRESHOLD = 245  # a channel above this counts as "white" (paper)

# Flag an anchor as undershooting only past this margin -- small
# discrepancies (a point or two) are measurement noise, not a real bug;
# every real fix in the 27 Aug audit undershot by double digits of points.
UNDERSHOOT_MARGIN_PT = 8.0


@dataclass
class AnchorGeom:
    id: str
    qid: str
    page_index: int
    x0_pt: float
    y0_pt: float
    x1_pt: float
    y1_pt: float
    expand_max_x1_pt: float | None
    expand_max_y1_pt: float | None


@dataclass
class AuditResult:
    qid: str
    true_border_pt: float | None
    undershoot: bool
    proposed_y1_pt: float | None
    note: str


def _render_page(doc: fitz.Document, page_index: int) -> np.ndarray:
    page = doc[page_index]
    mat = fitz.Matrix(CROP_DPI / 72, CROP_DPI / 72)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
    return cv2.cvtColor(img, cv2.COLOR_RGB2BGR) if pix.n == 3 else img


def _is_white(px: np.ndarray) -> bool:
    return bool(np.all(px > WHITE_THRESHOLD))


# How far before y0_pt to start looking, and how far after it a run may
# still start and count as "this anchor's own bar" (not the previous
# anchor's). Generous on purpose -- every undershoot fixed in the 27 Aug
# audit was in the 24-27pt range, so 40pt covers real cases with margin.
LOOKBACK_PT = 10.0
OWN_BAR_START_SLACK_PT = 40.0

# A run shorter than this is treated as noise/anti-aliasing, never as a
# real accent bar -- every real answer box in A.1 is at least ~60pt tall.
MIN_RUN_LENGTH_PT = 15.0


def find_true_bottom_border(page_img: np.ndarray, anchor: AnchorGeom) -> float | None:
    """Scans the accent-bar column for every colored run in a window
    around y0_pt, then picks the run most likely to be THIS anchor's own
    bar (not bleed-through from the previous anchor's, which is a real
    risk when an anchor's authored y0_pt itself undershoots -- exactly
    the same bug class this script exists to catch, which means a naive
    "start scanning exactly at y0_pt" approach can misattribute the
    previous anchor's tail-end ink to this one). Among runs starting
    within OWN_BAR_START_SLACK_PT after LOOKBACK_PT before y0_pt, returns
    the LONGEST one's end -- a real answer box's own bar spans nearly its
    whole printed height, while a bleed-through fragment from whatever
    box preceded it is comparatively short. Returns None if no run of at
    least MIN_RUN_LENGTH_PT is found at all (e.g. an anchor with no
    printed left border, like a grid question)."""
    page_h_px = page_img.shape[0]
    x_px = int((anchor.x0_pt + BAR_SAMPLE_OFFSET_PT) * PT_TO_PX)
    if x_px < 0 or x_px >= page_img.shape[1]:
        return None

    scan_start_px = max(0, int((anchor.y0_pt - LOOKBACK_PT) * PT_TO_PX))
    ceiling_px = min(page_h_px - 1, int((anchor.y0_pt + SEARCH_CEILING_PT) * PT_TO_PX))
    latest_start_px = int((anchor.y0_pt + OWN_BAR_START_SLACK_PT) * PT_TO_PX)

    runs: list[tuple[int, int]] = []  # (start_px, end_px) inclusive
    run_start = None
    white_run = 0
    for y_px in range(scan_start_px, ceiling_px):
        if _is_white(page_img[y_px, x_px]):
            white_run += 1
            if run_start is not None and white_run >= WHITE_CONFIRM_ROWS:
                runs.append((run_start, y_px - white_run))
                run_start = None
        else:
            white_run = 0
            if run_start is None:
                run_start = y_px
    if run_start is not None:
        runs.append((run_start, ceiling_px - 1))

    candidates = [
        (start, end)
        for start, end in runs
        if start <= latest_start_px and (end - start) / PT_TO_PX >= MIN_RUN_LENGTH_PT
    ]
    if not candidates:
        return None
    best_start, best_end = max(candidates, key=lambda r: r[1] - r[0])
    return best_end / PT_TO_PX


def audit_one(page_img: np.ndarray, anchor: AnchorGeom) -> AuditResult:
    true_border = find_true_bottom_border(page_img, anchor)
    if true_border is None:
        return AuditResult(anchor.qid, None, False, None, "no accent bar found (or search ceiling reached) -- not audited")

    undershoot = true_border > anchor.y1_pt + UNDERSHOOT_MARGIN_PT
    if undershoot:
        proposed_y1 = round(true_border + 4.0, 1)  # small margin, matching the 27 Aug fixes' convention
        note = f"undershoot: authored y1_pt={anchor.y1_pt} vs true border ~{true_border:.1f}pt"
    else:
        proposed_y1 = None
        note = f"ok: true border ~{true_border:.1f}pt, base geometry already reasonable"

    return AuditResult(anchor.qid, true_border, undershoot, proposed_y1, note)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pdf", required=True, help="Path to any split (or master) PDF for this packet version")
    parser.add_argument("--anchors", required=True, help="Path to a JSON array of na_anchors rows")
    args = parser.parse_args()

    with open(args.anchors) as f:
        rows = json.load(f)
    anchors = [
        AnchorGeom(
            id=r["id"],
            qid=r["qid"],
            page_index=r["page_index"],
            x0_pt=float(r["x0_pt"]),
            y0_pt=float(r["y0_pt"]),
            x1_pt=float(r["x1_pt"]),
            y1_pt=float(r["y1_pt"]),
            expand_max_x1_pt=float(r["expand_max_x1_pt"]) if r.get("expand_max_x1_pt") is not None else None,
            expand_max_y1_pt=float(r["expand_max_y1_pt"]) if r.get("expand_max_y1_pt") is not None else None,
        )
        for r in rows
    ]

    doc = fitz.open(args.pdf)
    page_cache: dict[int, np.ndarray] = {}

    flagged = []
    for a in anchors:
        if a.page_index not in page_cache:
            page_cache[a.page_index] = _render_page(doc, a.page_index)
        result = audit_one(page_cache[a.page_index], a)
        status = "FLAG" if result.undershoot else ("skip" if result.true_border_pt is None else "ok")
        print(f"[{status:4s}] {result.qid:20s} {result.note}")
        if result.undershoot:
            flagged.append((a, result))

    print(f"\n{len(flagged)} of {len(anchors)} anchors flagged for review.")
    if flagged:
        print("\nProposed na_anchors patches (VERIFY against the actual rendered page before applying any of these):")
        for a, r in flagged:
            print(f"  update na_anchors set y1_pt = {r.proposed_y1_pt} where id = '{a.id}'; -- {a.qid}")


if __name__ == "__main__":
    main()
