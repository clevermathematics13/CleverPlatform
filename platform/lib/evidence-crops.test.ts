import { describe, it, expect } from "vitest";
import {
  ANCHOR_TOLERANCE_PT,
  MIN_BOX_FRACTION,
  PAD_FLOOR,
  PAD_PROPORTION,
  fractionBoxToPoints,
  noExpansionCaps,
  anchorToEvidenceBox,
  firstShiftedAnchorPage,
  computeExpansionCaps,
  normalizeFractionBox,
  padModelBox,
  MODEL_DOWNWARD_BIAS,
} from "./evidence-crops";

describe("normalizeFractionBox", () => {
  it("accepts a well-formed box unchanged", () => {
    const result = normalizeFractionBox({ page: 3, x0: 0.1, y0: 0.2, x1: 0.8, y1: 0.4 });
    expect(result).toEqual({ ok: true, box: { page: 3, x0: 0.1, y0: 0.2, x1: 0.8, y1: 0.4 } });
  });

  it("sorts the corners of a drag made up and to the left", () => {
    // A teacher can start the drag at the bottom-right of the region; the
    // browser reports the start point as (x0, y0) regardless of direction.
    const result = normalizeFractionBox({ page: 1, x0: 0.8, y0: 0.6, x1: 0.2, y1: 0.3 });
    expect(result).toEqual({ ok: true, box: { page: 1, x0: 0.2, y0: 0.3, x1: 0.8, y1: 0.6 } });
  });

  it("clamps a drag that ran off the edge of the page", () => {
    const result = normalizeFractionBox({ page: 2, x0: -0.4, y0: 0.5, x1: 1.9, y1: 0.7 });
    expect(result).toEqual({ ok: true, box: { page: 2, x0: 0, y0: 0.5, x1: 1, y1: 0.7 } });
  });

  it("rejects a stray click that drew almost no box", () => {
    const tiny = MIN_BOX_FRACTION / 2;
    const result = normalizeFractionBox({ page: 1, x0: 0.5, y0: 0.5, x1: 0.5 + tiny, y1: 0.5 + tiny });
    expect(result.ok).toBe(false);
  });

  it("rejects a box that is wide enough but not tall enough", () => {
    const result = normalizeFractionBox({ page: 1, x0: 0.1, y0: 0.5, x1: 0.9, y1: 0.5001 });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-finite coordinate rather than cropping NaN points", () => {
    expect(normalizeFractionBox({ page: 1, x0: Number.NaN, y0: 0.2, x1: 0.8, y1: 0.4 }).ok).toBe(false);
    expect(normalizeFractionBox({ page: 1, x0: 0.1, y0: 0.2, x1: Infinity, y1: 0.4 }).ok).toBe(false);
  });

  it("rejects a missing or non-numeric coordinate", () => {
    expect(normalizeFractionBox({ page: 1, y0: 0.2, x1: 0.8, y1: 0.4 }).ok).toBe(false);
    expect(normalizeFractionBox({ page: 1, x0: "0.1", y0: 0.2, x1: 0.8, y1: 0.4 }).ok).toBe(false);
  });

  it("rejects a page that is not a whole number of 1 or more", () => {
    // evidence_box.page is 1-indexed; a 0 here would crop the wrong page
    // after the route subtracts one for the CV service.
    expect(normalizeFractionBox({ page: 0, x0: 0.1, y0: 0.2, x1: 0.8, y1: 0.4 }).ok).toBe(false);
    expect(normalizeFractionBox({ page: 2.5, x0: 0.1, y0: 0.2, x1: 0.8, y1: 0.4 }).ok).toBe(false);
    expect(normalizeFractionBox({ page: "3", x0: 0.1, y0: 0.2, x1: 0.8, y1: 0.4 }).ok).toBe(false);
  });
});

describe("fractionBoxToPoints", () => {
  it("scales by the page's own size, not a constant", () => {
    const box = { page: 1, x0: 0.5, y0: 0.25, x1: 1, y1: 0.5 };
    // A4 in points, which is what these scans actually carry.
    expect(fractionBoxToPoints(box, { widthPt: 595, heightPt: 842 })).toEqual({
      x0Pt: 297.5,
      y0Pt: 210.5,
      x1Pt: 595,
      y1Pt: 421,
    });
    // The same fractions on a US Letter page must land somewhere else --
    // this is the assumption whose absence shifts every crop at once.
    expect(fractionBoxToPoints(box, { widthPt: 612, heightPt: 792 })).toEqual({
      x0Pt: 306,
      y0Pt: 198,
      x1Pt: 612,
      y1Pt: 396,
    });
  });
});

describe("noExpansionCaps", () => {
  it("caps growth at the drawn edges so the crop stays where the teacher put it", () => {
    const points = { x0Pt: 50, y0Pt: 100, x1Pt: 500, y1Pt: 300 };
    expect(noExpansionCaps(points)).toEqual({ expandMaxX1Pt: 500, expandMaxY1Pt: 300 });
  });
});

/**
 * Golden master for padModelBox, taken from a real graded paper.
 *
 * Each row is [label, raw model box, the padded box that is in
 * ai_grade_results.evidence_box for that part today]. The expected values were
 * read out of production, not computed here, so any drift in the padding
 * arithmetic breaks these -- which matters because the padded box is what the
 * full-page view draws its outline from, so a change here silently moves every
 * historical crop's recorded region out from under the image it describes.
 *
 * Both branches are represented: the PAD_FLOOR branch (short boxes, where
 * 0.18 x height falls under 0.03) and the proportional branch (tall ones).
 *
 * The bottom edge is the one deliberate departure: since MODEL_DOWNWARD_BIAS
 * was added (17 Sep 2026) y1 sits that much lower than the stored value, so
 * these rows pin x0/y0/x1 exactly and y1 at stored + bias. Anything else
 * moving is still drift.
 */
const PRODUCTION_PADDING_CASES: [string, [number, number, number, number], [number, number, number, number]][] = [
  ["Q1(a)", [0.15, 0.52, 0.25, 0.55], [0.12, 0.49, 0.28, 0.58]],
  ["Q2(a)", [0.15, 0.18, 0.22, 0.21], [0.12, 0.15, 0.25, 0.24]],
  ["Q5(d)", [0.1, 0.28, 0.35, 0.38], [0.055, 0.25, 0.395, 0.41]],
  ["Q7(a)", [0.1, 0.14, 0.45, 0.24], [0.037, 0.11, 0.513, 0.27]],
  ["Q8(a)", [0.1, 0.5, 0.4, 0.68], [0.046, 0.4676, 0.454, 0.7124]],
  ["Q9(a)", [0.1, 0.26, 0.65, 0.58], [0.001, 0.2024, 0.749, 0.6376]],
  ["Q11(a)", [0.15, 0.38, 0.8, 0.42], [0.033, 0.35, 0.917, 0.45]],
  ["Q12(a)", [0.1, 0.14, 0.65, 0.36], [0.001, 0.1004, 0.749, 0.3996]],
  ["Q13(c)", [0.1, 0.4, 0.45, 0.56], [0.037, 0.37, 0.513, 0.59]],
  ["Q14(b)", [0.3, 0.28, 0.55, 0.36], [0.255, 0.25, 0.595, 0.39]],
];

describe("padModelBox", () => {
  it.each(PRODUCTION_PADDING_CASES)(
    "reproduces the stored box's sides and top for %s, with y1 a bias lower",
    (_label, [x0, y0, x1, y1], [ex0, ey0, ex1, ey1]) => {
      const padded = padModelBox({ page: 3, x0, y0, x1, y1 });
      expect(padded).not.toBeNull();
      expect(padded!.x0).toBeCloseTo(ex0, 10);
      expect(padded!.y0).toBeCloseTo(ey0, 10);
      expect(padded!.x1).toBeCloseTo(ex1, 10);
      expect(padded!.y1).toBeCloseTo(Math.min(1, ey1 + MODEL_DOWNWARD_BIAS), 10);
    }
  );

  // The regression this bias was added for: Key Assessment 1 Q4(b), whose
  // stored box (0.0134, 0.15) -> (0.5166, 0.25) cropped to a picture of part
  // (a)'s answer with (b)'s printed prompt along the bottom edge. (b)'s own
  // handwriting sits just under that edge, so the crop had to reach past it.
  it("reaches below the printed prompt a biased box stops at", () => {
    const padded = padModelBox({ page: 3, x0: 0.08, y0: 0.18, x1: 0.45, y1: 0.22 })!;
    expect(padded.y0).toBeCloseTo(0.15, 10);
    expect(padded.y1).toBeCloseTo(0.4, 10);
    // The part's answer line sat around 0.27-0.31 of the page height.
    expect(padded.y1).toBeGreaterThan(0.31);
  });

  it("leaves the top edge alone, so a box that was already right stays right", () => {
    const raw = { page: 2, x0: 0.1, y0: 0.35, x1: 0.9, y1: 0.45 };
    const padded = padModelBox(raw)!;
    expect(padded.y0).toBeLessThan(raw.y0);
    expect(padded.y0).toBeCloseTo(0.32, 10);
  });

  it("keeps the page it was given", () => {
    expect(padModelBox({ page: 7, x0: 0.1, y0: 0.2, x1: 0.4, y1: 0.5 })?.page).toBe(7);
  });

  it("uses the floor when the box is small and the proportion when it is large", () => {
    // 0.10 wide: 0.10 * 0.18 = 0.018, under the 0.03 floor -> floor wins.
    const small = padModelBox({ page: 1, x0: 0.4, y0: 0.4, x1: 0.5, y1: 0.5 })!;
    expect(small.x0).toBeCloseTo(0.4 - PAD_FLOOR, 10);
    // 0.40 wide: 0.40 * 0.18 = 0.072, over the floor -> proportion wins.
    const large = padModelBox({ page: 1, x0: 0.3, y0: 0.3, x1: 0.7, y1: 0.7 })!;
    expect(large.x0).toBeCloseTo(0.3 - 0.4 * PAD_PROPORTION, 10);
  });

  it("clamps padding at the page edge rather than running off it", () => {
    const padded = padModelBox({ page: 1, x0: 0.01, y0: 0.01, x1: 0.99, y1: 0.99 })!;
    expect(padded).toEqual({ page: 1, x0: 0, y0: 0, x1: 1, y1: 1 });
  });

  it("returns null for a box that cannot be cropped", () => {
    // Inverted, and zero-width after clamping -- both mean "skip this part,
    // keep grading", never "crop something arbitrary".
    expect(padModelBox({ page: 1, x0: 0.8, y0: 0.2, x1: 0.2, y1: 0.4 })).toBeNull();
    expect(padModelBox({ page: 1, x0: 0.5, y0: 0.2, x1: 0.5, y1: 0.4 })).toBeNull();
    expect(padModelBox({ page: 1, x0: 0.2, y0: 0.5, x1: 0.6, y1: 0.5 })).toBeNull();
    expect(padModelBox({ page: 1, x0: -0.5, y0: 0.2, x1: -0.1, y1: 0.4 })).toBeNull();
  });

  it("does not apply to a teacher-drawn box", () => {
    // normalizeFractionBox is the teacher path and pads nothing: the region
    // drawn on the page is the region cropped. Guarding that here because the
    // two paths sit side by side and padding the teacher's box would quietly
    // pull in the neighbouring part's writing.
    const drawn = normalizeFractionBox({ page: 1, x0: 0.1, y0: 0.3, x1: 0.6, y1: 0.4 });
    expect(drawn).toEqual({ ok: true, box: { page: 1, x0: 0.1, y0: 0.3, x1: 0.6, y1: 0.4 } });
  });
});

describe("computeExpansionCaps", () => {
  const A4 = [{ widthPt: 595, heightPt: 842 }];

  it("caps each region's growth at the top of the next region below it", () => {
    const regions = [
      { pageIndex: 0, x0Pt: 50, y0Pt: 100, x1Pt: 500, y1Pt: 160 },
      { pageIndex: 0, x0Pt: 50, y0Pt: 200, x1Pt: 500, y1Pt: 260 },
    ];
    const caps = computeExpansionCaps(regions, A4);
    // First grows down to just above the second (200 - 4).
    expect(caps[0].expandMaxY1Pt).toBe(196);
    // Last on the page grows to the page edge.
    expect(caps[1].expandMaxY1Pt).toBe(842);
  });

  it("caps x at the page edge, never on a neighbour", () => {
    // A region to the right must not truncate a long line of working for
    // every student on the paper.
    const regions = [
      { pageIndex: 0, x0Pt: 50, y0Pt: 100, x1Pt: 300, y1Pt: 160 },
      { pageIndex: 0, x0Pt: 320, y0Pt: 100, x1Pt: 500, y1Pt: 160 },
    ];
    expect(computeExpansionCaps(regions, A4).map((c) => c.expandMaxX1Pt)).toEqual([595, 595]);
  });

  it("only lets regions on the same page cap each other", () => {
    const regions = [
      { pageIndex: 0, x0Pt: 50, y0Pt: 700, x1Pt: 500, y1Pt: 760 },
      { pageIndex: 1, x0Pt: 50, y0Pt: 100, x1Pt: 500, y1Pt: 160 },
    ];
    const caps = computeExpansionCaps(regions, [
      { widthPt: 595, heightPt: 842 },
      { widthPt: 595, heightPt: 842 },
    ]);
    expect(caps[0].expandMaxY1Pt).toBe(842);
  });

  it("is not capped by a region that merely overlaps it", () => {
    // Two slightly overlapping boxes would otherwise cap each other to
    // nothing, making both crops smaller than what was drawn.
    const regions = [
      { pageIndex: 0, x0Pt: 50, y0Pt: 100, x1Pt: 500, y1Pt: 200 },
      { pageIndex: 0, x0Pt: 50, y0Pt: 180, x1Pt: 500, y1Pt: 280 },
    ];
    const caps = computeExpansionCaps(regions, A4);
    expect(caps[0].expandMaxY1Pt).toBe(842);
    expect(caps[1].expandMaxY1Pt).toBe(842);
  });

  it("never caps inside the region itself", () => {
    // A cap below the drawn bottom edge would shrink the crop. Regions this
    // tightly packed just get no room to grow.
    const regions = [
      { pageIndex: 0, x0Pt: 50, y0Pt: 100, x1Pt: 500, y1Pt: 200 },
      { pageIndex: 0, x0Pt: 50, y0Pt: 202, x1Pt: 500, y1Pt: 300 },
    ];
    const caps = computeExpansionCaps(regions, A4);
    expect(caps[0].expandMaxY1Pt).toBe(200);
  });

  it("falls back to the region's own edges when the page size is missing", () => {
    const regions = [{ pageIndex: 9, x0Pt: 50, y0Pt: 100, x1Pt: 500, y1Pt: 200 }];
    expect(computeExpansionCaps(regions, A4)[0]).toEqual({ expandMaxX1Pt: 500, expandMaxY1Pt: 200 });
  });
});

describe("anchorToEvidenceBox", () => {
  const A4 = { widthPt: 595, heightPt: 842 };

  it("converts a region to fractions of its reference page", () => {
    const box = anchorToEvidenceBox({
      anchor: { x0Pt: 59.5, y0Pt: 200, x1Pt: 535.5, y1Pt: 300 },
      referenceSize: A4,
      page: 3,
      tolerancePt: 0,
    });
    expect(box.page).toBe(3);
    expect(box.x0).toBeCloseTo(0.1, 10);
    expect(box.x1).toBeCloseTo(0.9, 10);
    expect(box.y0).toBeCloseTo(200 / 842, 10);
    expect(box.y1).toBeCloseTo(300 / 842, 10);
  });

  it("extends both vertical edges by the tolerance, and neither horizontal one", () => {
    const anchor = { x0Pt: 50, y0Pt: 200, x1Pt: 500, y1Pt: 300 };
    const box = anchorToEvidenceBox({ anchor, referenceSize: A4, page: 1 });
    expect(box.y0).toBeCloseTo((200 - ANCHOR_TOLERANCE_PT) / 842, 10);
    expect(box.y1).toBeCloseTo((300 + ANCHOR_TOLERANCE_PT) / 842, 10);
    // Horizontal drift measured under 6pt across a class, so x is untouched.
    expect(box.x0).toBeCloseTo(50 / 595, 10);
    expect(box.x1).toBeCloseTo(500 / 595, 10);
  });

  it("stops the downward tolerance at the expansion cap", () => {
    // The cap is the next region's top. Growing past it is how a crop ends up
    // showing the following part's answer -- the failure being fixed.
    const anchor = { x0Pt: 50, y0Pt: 200, x1Pt: 500, y1Pt: 300 };
    const box = anchorToEvidenceBox({ anchor, referenceSize: A4, page: 1, maxY1Pt: 310 });
    expect(box.y1).toBeCloseTo(310 / 842, 10);
  });

  it("never shrinks the region when the cap is tighter than its own bottom", () => {
    const anchor = { x0Pt: 50, y0Pt: 200, x1Pt: 500, y1Pt: 300 };
    const box = anchorToEvidenceBox({ anchor, referenceSize: A4, page: 1, maxY1Pt: 250 });
    expect(box.y1).toBeCloseTo(300 / 842, 10);
  });

  it("does not run off the top of the page", () => {
    const box = anchorToEvidenceBox({
      anchor: { x0Pt: 50, y0Pt: 5, x1Pt: 500, y1Pt: 60 },
      referenceSize: A4,
      page: 1,
    });
    expect(box.y0).toBe(0);
  });

  it("gives the same fractions whatever the scan's page size turns out to be", () => {
    // The point of crossing through fractions: the stored box describes a
    // proportion of the page, so the route can multiply it by whatever size
    // the student's own scan page actually is.
    const anchor = { x0Pt: 59.5, y0Pt: 210.5, x1Pt: 297.5, y1Pt: 421 };
    const box = anchorToEvidenceBox({ anchor, referenceSize: A4, page: 1, tolerancePt: 0 });
    expect(fractionBoxToPoints(box, A4)).toEqual({ x0Pt: 59.5, y0Pt: 210.5, x1Pt: 297.5, y1Pt: 421 });
    // Same proportions, a Letter-sized scan: different points, same place.
    const onLetter = fractionBoxToPoints(box, { widthPt: 612, heightPt: 792 });
    expect(onLetter.x0Pt).toBeCloseTo(0.1 * 612, 8);
    expect(onLetter.y0Pt).toBeCloseTo(0.25 * 792, 8);
  });
});


/**
 * An 11-page booklet, 41 parts -- 9G's Formative Assessment 1, the paper this
 * guard is live on. `pages` lists each part's anchored page in printing order;
 * a test shifts some of them to describe what the model saw instead.
 */
const BOOKLET = [1, 1, 2, 2, 3, 3, 4, 5, 5, 6, 7, 8, 9, 9, 10, 11, 11];

const seen = (pages: number[], model: (page: number, i: number) => number) =>
  pages.map((anchorPage, i) => ({ anchorPage, modelPage: model(anchorPage, i) }));

describe("firstShiftedAnchorPage", () => {
  it("finds no shift when the model reads every part where the layout puts it", () => {
    expect(firstShiftedAnchorPage(seen(BOOKLET, (p) => p))).toBeNull();
  });

  it("finds no shift when nothing was localised", () => {
    // Every part blank, or every box null -- no evidence, so no overruling.
    expect(firstShiftedAnchorPage([])).toBeNull();
  });

  it("is not overruled by a single stray page from the model", () => {
    // The model's box averages 89pt of error; one odd page is why anchors exist.
    expect(firstShiftedAnchorPage(seen(BOOKLET, (p, i) => (i === 6 ? p + 3 : p)))).toBeNull();
  });

  it("is not overruled by scattered disagreements of different sizes", () => {
    expect(
      firstShiftedAnchorPage(seen(BOOKLET, (p, i) => (i === 2 ? p + 1 : i === 9 ? p + 4 : p)))
    ).toBeNull();
  });

  it("catches a page inserted mid-booklet, which the count guard waves through", () => {
    // A working sheet slipped in before page 9: pages 1-8 read true, and every
    // part from 9 on is one page later than the layout says. Pages 1-8 keep
    // their anchors, which is the point of returning the page rather than false.
    expect(firstShiftedAnchorPage(seen(BOOKLET, (p) => (p >= 9 ? p + 1 : p)))).toBe(9);
  });

  it("catches a redone cover sheet at the front, which shifts the whole paper", () => {
    expect(firstShiftedAnchorPage(seen(BOOKLET, (p) => p + 1))).toBe(1);
  });

  it("keeps the anchors when answers continue onto a later sheet mid-paper", () => {
    // Two page-9 answers finished on page 11. Same direction, but the parts
    // printed on 10 and 11 still read true, so the pages did not move.
    expect(firstShiftedAnchorPage(seen(BOOKLET, (p, i) => (p === 9 && i < 14 ? 11 : p)))).toBeNull();
  });

  it("acts on a shift proven by only two parts, erring toward the model's box", () => {
    expect(
      firstShiftedAnchorPage([
        { anchorPage: 1, modelPage: 1 },
        { anchorPage: 10, modelPage: 11 },
        { anchorPage: 11, modelPage: 12 },
      ])
    ).toBe(10);
  });
});
