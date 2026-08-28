"""Regression tests for cv_crop_extract.py's adaptive expansion.

Not wired into any CI gate (the cv-service has no existing Python test
runner -- see requirements.txt), but reproducible manually:
    pip install pytest opencv-python-headless numpy
    pytest platform/scripts/cv_crop_extract_test.py
"""

import numpy as np

from cv_crop_extract import (
    EXPAND_DENSITY_THRESHOLD,
    _adaptive_crop_bounds,
    _edge_ink_density,
)


def _blank_page(h=400, w=400):
    return np.full((h, w), 255, dtype=np.uint8)


def test_edge_density_ignores_localized_content_below_old_threshold():
    """A real production miss (A.1 Q1, Ines Palomino): a boxed final answer
    sat entirely in the last ~20% of the bottom band's width. A single
    average over the whole band's width gave ~0.048 -- just under
    EXPAND_DENSITY_THRESHOLD (0.05) -- so expansion never fired even
    though a legible answer sat right at the edge. The fix (max over
    segments) must detect this."""
    gray = _blank_page(h=200, w=400)
    band_top = int(200 * 0.94)  # EXPAND_BAND_FRAC = 0.06
    # Ink concentrated in a narrow column range only -- everywhere else in
    # the band stays blank, matching the real diluted-average case (a
    # boxed answer occupying a small fraction of a wide crop's width).
    gray[band_top:, 370:385] = 0

    old_style_average = float((gray[band_top:, :] < 200).sum()) / gray[band_top:, :].size
    assert old_style_average < EXPAND_DENSITY_THRESHOLD, (
        "test setup should reproduce the dilution -- if this fails, "
        "the synthetic case no longer matches the real miss"
    )

    density = _edge_ink_density(gray, "bottom")
    assert density > EXPAND_DENSITY_THRESHOLD


def test_edge_density_right_side_localized_content():
    gray = _blank_page(h=400, w=200)
    band_left = int(200 * 0.94)
    gray[350:395, band_left:] = 0
    density = _edge_ink_density(gray, "right")
    assert density > EXPAND_DENSITY_THRESHOLD


def test_adaptive_crop_bounds_expands_for_localized_bottom_content():
    page = _blank_page(h=300, w=400)
    bx0, by0, bx1, by1 = 20, 20, 380, 150
    # A boxed answer straddling the initial crop's bottom edge, concentrated
    # in one narrow column range (as a real boxed final answer would be) --
    # its top is visible inside the initial crop so expansion has ink to
    # detect, and it continues past by1. Plenty of room below it (max_by1
    # is far past the content), so this should NOT be flagged truncated.
    page[145:175, 300:315] = 0

    final_bx1, final_by1, expanded, possibly_truncated = _adaptive_crop_bounds(
        page, bx0, by0, bx1, by1, max_bx1=380, max_by1=250, step_px=10
    )
    assert expanded is True
    assert final_by1 >= 175
    assert possibly_truncated is False


def test_adaptive_crop_bounds_no_expansion_when_truly_blank():
    page = _blank_page(h=300, w=400)
    final_bx1, final_by1, expanded, possibly_truncated = _adaptive_crop_bounds(
        page, 20, 20, 380, 150, max_bx1=380, max_by1=200, step_px=10
    )
    assert expanded is False
    assert possibly_truncated is False
    assert (final_bx1, final_by1) == (380, 150)


def test_adaptive_crop_bounds_flags_possibly_truncated_when_capped():
    """Real production case (A.1 Q1(e) and others): a student's answer
    genuinely continues past the anchor's expand_max_y1_pt (the next
    question's printed boundary), so even a fully-triggered expansion
    can't reach the rest of it. This must be flagged rather than silently
    treated as a complete crop just because it did expand."""
    page = _blank_page(h=300, w=400)
    bx0, by0, bx1, by1 = 20, 20, 380, 150
    # Ink continues all the way down to (and past, off-page) the cap --
    # unlike the test above, there's no room below max_by1 where the
    # content naturally stops.
    page[145:220, 300:315] = 0

    final_bx1, final_by1, expanded, possibly_truncated = _adaptive_crop_bounds(
        page, bx0, by0, bx1, by1, max_bx1=380, max_by1=180, step_px=10
    )
    assert expanded is True
    assert final_by1 == 180  # hit the cap
    assert possibly_truncated is True
