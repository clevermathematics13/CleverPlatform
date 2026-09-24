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
  NEXT_PART_OVERLAP,
  LEGACY_NEXT_ALLOWANCE,
  nextTopBelow,
  regionEndBelow,
  boundModelBoxes,
  boundStoredModelBox,
  boundStoredModelBoxes,
  modelExpansionCaps,
  sameBox,
  anchorCropPlan,
  modelCropPlan,
  pointsToFractions,
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

/**
 * Key Assessment 1 (Grade 9 Standard), one student's second page, as the
 * marker reported it -- reconstructed from the stored boxes with the 0.03
 * floor padding that every one of these short boxes gets. 1(c) is the crop
 * in the 23 Sep 2026 screenshot: one line of handwriting at 0.36-0.44 and,
 * under the old arithmetic, the whole of Q2 below it.
 */
const KA1_PAGE2_RAW: { key: string; raw: { page: number; x0: number; y0: number; x1: number; y1: number } }[] = [
  { key: "1(a)", raw: { page: 2, x0: 0.05, y0: 0.04, x1: 0.6, y1: 0.12 } },
  { key: "1(b)", raw: { page: 2, x0: 0.05, y0: 0.14, x1: 0.6, y1: 0.19 } },
  { key: "1(c)", raw: { page: 2, x0: 0.05, y0: 0.36, x1: 0.6, y1: 0.44 } },
  { key: "2(a)", raw: { page: 2, x0: 0.05, y0: 0.42, x1: 0.6, y1: 0.48 } },
  { key: "2(b)", raw: { page: 2, x0: 0.05, y0: 0.47, x1: 0.6, y1: 0.55 } },
  { key: "2(c)", raw: { page: 2, x0: 0.05, y0: 0.58, x1: 0.6, y1: 0.62 } },
  { key: "2(d)", raw: { page: 2, x0: 0.05, y0: 0.69, x1: 0.6, y1: 0.85 } },
];

/** The same page as it is STORED today: padded, biased, raw box gone. */
const KA1_PAGE2_STORED: { key: string; stored: { page: number; x0: number; y0: number; x1: number; y1: number } }[] = [
  { key: "1(a)", stored: { page: 2, x0: 0, y0: 0.01, x1: 0.8352, y1: 0.3 } },
  { key: "1(b)", stored: { page: 2, x0: 0.0494, y0: 0.11, x1: 0.2806, y1: 0.37 } },
  { key: "1(c)", stored: { page: 2, x0: 0, y0: 0.33, x1: 0.522, y1: 0.62 } },
  { key: "2(a)", stored: { page: 2, x0: 0, y0: 0.39, x1: 1, y1: 0.66 } },
  { key: "2(b)", stored: { page: 2, x0: 0, y0: 0.44, x1: 0.876, y1: 0.58 } },
  { key: "2(c)", stored: { page: 2, x0: 0, y0: 0.55, x1: 0.7526, y1: 0.8 } },
  { key: "2(d)", stored: { page: 2, x0: 0, y0: 0.6604, x1: 1, y1: 1 } },
];

const A4 = { widthPt: 595, heightPt: 842 };

describe("nextTopBelow", () => {
  const box = { page: 2, x0: 0.1, y0: 0.4, x1: 0.9, y1: 0.5 };

  it("finds the nearest top strictly below this box's top on the same page", () => {
    const others = [
      { page: 2, x0: 0.1, y0: 0.7, x1: 0.9, y1: 0.8 },
      { page: 2, x0: 0.1, y0: 0.45, x1: 0.9, y1: 0.6 },
      { page: 2, x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.3 },
    ];
    expect(nextTopBelow(box, others)).toBe(0.45);
  });

  it("ignores a box on another page, a box above, and the same top twice", () => {
    expect(nextTopBelow(box, [{ page: 3, x0: 0.1, y0: 0.45, x1: 0.9, y1: 0.6 }])).toBeNull();
    expect(nextTopBelow(box, [{ page: 2, x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.39 }])).toBeNull();
    expect(nextTopBelow(box, [{ page: 2, x0: 0.1, y0: 0.4, x1: 0.9, y1: 0.9 }])).toBeNull();
    expect(nextTopBelow(box, [box])).toBeNull();
  });
});

describe("regionEndBelow", () => {
  const box = { page: 2, x0: 0.1, y0: 0.4, x1: 0.9, y1: 0.5 };

  it("is the top of the box after the next one when there is one", () => {
    const others = [
      { page: 2, x0: 0.1, y0: 0.45, x1: 0.9, y1: 0.6 },
      { page: 2, x0: 0.1, y0: 0.7, x1: 0.9, y1: 0.8 },
      { page: 2, x0: 0.1, y0: 0.9, x1: 0.9, y1: 0.95 },
    ];
    expect(regionEndBelow(box, others)).toEqual({ y: 0.7, kind: "second-top" });
  });

  it("is the next box's own bottom when it is the last on the page", () => {
    expect(regionEndBelow(box, [{ page: 2, x0: 0.1, y0: 0.45, x1: 0.9, y1: 0.6 }])).toEqual({ y: 0.6, kind: "next-bottom" });
  });

  it("is null when nothing is below, on this page", () => {
    expect(regionEndBelow(box, [{ page: 3, x0: 0.1, y0: 0.45, x1: 0.9, y1: 0.6 }])).toBeNull();
    expect(regionEndBelow(box, [{ page: 2, x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.3 }])).toBeNull();
    expect(regionEndBelow(box, [])).toBeNull();
  });
});

describe("boundModelBoxes", () => {
  it("stops each KA1 box at the end of the next part's region", () => {
    const bounded = new Map(boundModelBoxes(KA1_PAGE2_RAW).map((b) => [b.key, b]));
    // 1(a): next is 1(b) (0.14), the box after that starts at 0.36, so the
    // crop may reach 0.38; the bias (0.15 -> 0.30) stops it first.
    expect(bounded.get("1(a)")!.box.y1).toBeCloseTo(0.3, 10);
    expect(bounded.get("1(a)")!.ceiling).toBeCloseTo(0.38, 10);
    expect(bounded.get("1(b)")!.box.y1).toBeCloseTo(0.37, 10);
    expect(bounded.get("1(b)")!.ceiling).toBeCloseTo(0.44, 10);
    // 1(c) -- the screenshot. 2(a) is reported INSIDE it (0.42 < 0.44) and
    // 2(b) at 0.47, so the crop ends at 0.49: the 0.36-0.44 handwriting and
    // Q2's heading, instead of 0.62 plus uncapped growth over Q2's text.
    expect(bounded.get("1(c)")!.box.y1).toBeCloseTo(0.49, 10);
    expect(bounded.get("1(c)")!.ceiling).toBeCloseTo(0.49, 10);
    // 2(a) -- the box the marker put one part too high (on the sequence
    // table; (a)'s answer sits under 2(b)'s box at 0.47-0.55). Bounding at
    // 2(b)'s TOP would lose the answer; the end of 2(b)'s region keeps it.
    expect(bounded.get("2(a)")!.box.y1).toBeCloseTo(0.6, 10);
    expect(bounded.get("2(a)")!.ceiling).toBeCloseTo(0.6, 10);
    expect(bounded.get("2(b)")!.box.y1).toBeCloseTo(0.71, 10);
    expect(bounded.get("2(b)")!.ceiling).toBeCloseTo(0.71, 10);
    // 2(c): only 2(d) is below it, so the bound is 2(d)'s own bottom plus
    // the floor padding; the bias stops the crop first.
    expect(bounded.get("2(c)")!.box.y1).toBeCloseTo(0.8, 10);
    expect(bounded.get("2(c)")!.ceiling).toBeCloseTo(0.88, 10);
    // Last on the page: nothing below it, so the full bias as before.
    expect(bounded.get("2(d)")!.box.y1).toBe(1);
    expect(bounded.get("2(d)")!.ceiling).toBeNull();
  });

  it("never reaches further than the unbounded bias did, and never above the padded box", () => {
    for (const b of boundModelBoxes(KA1_PAGE2_RAW)) {
      const raw = KA1_PAGE2_RAW.find((r) => r.key === b.key)!.raw;
      const padded = padModelBox(raw)!;
      expect(b.box.y1).toBeLessThanOrEqual(padded.y1 + 1e-12);
      expect(b.box.y1).toBeGreaterThanOrEqual(Math.min(1, raw.y1 + PAD_FLOOR) - 1e-12);
    }
  });

  it("leaves the three other edges exactly as padModelBox sets them", () => {
    for (const b of boundModelBoxes(KA1_PAGE2_RAW)) {
      const raw = KA1_PAGE2_RAW.find((r) => r.key === b.key)!.raw;
      const padded = padModelBox(raw)!;
      expect(b.box.page).toBe(padded.page);
      expect(b.box.x0).toBeCloseTo(padded.x0, 10);
      expect(b.box.y0).toBeCloseTo(padded.y0, 10);
      expect(b.box.x1).toBeCloseTo(padded.x1, 10);
    }
  });

  it("bounds by position on the page, not by the order the parts are given in", () => {
    const shuffled = [...KA1_PAGE2_RAW].reverse();
    const summarise = (rows: ReturnType<typeof boundModelBoxes<string>>) =>
      rows.map((b) => `${b.key}:${b.box.y1.toFixed(6)}:${b.ceiling === null ? "page" : b.ceiling.toFixed(6)}`).sort();
    expect(summarise(boundModelBoxes(shuffled))).toEqual(summarise(boundModelBoxes(KA1_PAGE2_RAW)));
  });

  it("is not bounded by a box on another page or a box above it", () => {
    const raw = { page: 2, x0: 0.1, y0: 0.3, x1: 0.9, y1: 0.4 };
    const alone = padModelBox(raw)!;
    const [otherPage] = boundModelBoxes(
      [{ key: "p", raw }],
      [raw, { page: 3, x0: 0.1, y0: 0.42, x1: 0.9, y1: 0.5 }]
    );
    expect(otherPage.box.y1).toBeCloseTo(alone.y1, 10);
    expect(otherPage.ceiling).toBeNull();
    const [above] = boundModelBoxes([{ key: "p", raw }], [raw, { page: 2, x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.2 }]);
    expect(above.box.y1).toBeCloseTo(alone.y1, 10);
  });

  it("reads the region end off the nearest two boxes below it", () => {
    const raw = { page: 2, x0: 0.1, y0: 0.3, x1: 0.9, y1: 0.4 };
    const [b] = boundModelBoxes(
      [{ key: "p", raw }],
      [raw, { page: 2, x0: 0.1, y0: 0.7, x1: 0.9, y1: 0.8 }, { page: 2, x0: 0.1, y0: 0.5, x1: 0.9, y1: 0.6 }]
    );
    expect(b.ceiling).toBeCloseTo(0.7 + NEXT_PART_OVERLAP, 10);
    // The bias runs out (0.43 + 0.15) before the bound does.
    expect(b.box.y1).toBeCloseTo(0.58, 10);
  });

  it("equals padModelBox for every production box when nothing is below it", () => {
    for (const [, [x0, y0, x1, y1]] of PRODUCTION_PADDING_CASES) {
      const raw = { page: 3, x0, y0, x1, y1 };
      const [b] = boundModelBoxes([{ key: "only", raw }]);
      expect(b.box).toEqual(padModelBox(raw));
      expect(b.ceiling).toBeNull();
    }
  });

  it("drops a degenerate box and never lets one act as a neighbour", () => {
    const raw = { page: 2, x0: 0.1, y0: 0.3, x1: 0.9, y1: 0.4 };
    const inverted = { page: 2, x0: 0.9, y0: 0.5, x1: 0.1, y1: 0.45 };
    const out = boundModelBoxes([
      { key: "good", raw },
      { key: "bad", raw: inverted },
    ]);
    expect(out.map((b) => b.key)).toEqual(["good"]);
    expect(out[0].ceiling).toBeNull();
  });

  it("is bounded by a neighbour that is only in the neighbour list", () => {
    // The grading run passes every reported box, including parts cut from a
    // paper layout: their reported top still says where the next part starts.
    // One box below with nothing after it bounds at its own bottom.
    const raw = { page: 2, x0: 0.1, y0: 0.3, x1: 0.9, y1: 0.4 };
    const [b] = boundModelBoxes([{ key: "p", raw }], [{ page: 2, x0: 0.1, y0: 0.44, x1: 0.9, y1: 0.5 }]);
    expect(b.ceiling).toBeCloseTo(0.5 + PAD_FLOOR, 10);
    expect(b.box.y1).toBeCloseTo(0.53, 10);
  });
});

describe("boundStoredModelBox", () => {
  const stored = { page: 2, x0: 0, y0: 0.33, x1: 0.522, y1: 0.62 };

  it("cuts the KA1 1(c) crop back to the end of 2(a)'s region", () => {
    const bounded = boundStoredModelBox(stored, 0.49);
    expect(bounded).toMatchObject({ page: 2, x0: 0, y0: 0.33, x1: 0.522 });
    expect(bounded.y1).toBeCloseTo(0.49, 10);
  });

  it("repairs a box that Fix crops widened twice, and is a no-op on its own output", () => {
    const widenedTwice = { ...stored, y1: 0.77 };
    const once = boundStoredModelBox(widenedTwice, 0.49);
    expect(once.y1).toBeCloseTo(0.49, 10);
    expect(boundStoredModelBox(once, 0.49)).toEqual(once);
  });

  it("never widens: a far bound leaves the stored bottom alone, and no bound returns the box as it is", () => {
    expect(boundStoredModelBox(stored, 0.9)).toEqual(stored);
    expect(boundStoredModelBox(stored, null)).toBe(stored);
  });
});

describe("boundStoredModelBoxes", () => {
  it("bounds the whole KA1 page against every stored row on it", () => {
    // 2(b) is a row stored before the bias existed; as a neighbour it still
    // bounds 1(c) and 2(a), and its own bottom is left where it is.
    const bounded = new Map(boundStoredModelBoxes(KA1_PAGE2_STORED).map((b) => [b.key, b]));
    expect(bounded.get("1(a)")!.box.y1).toBeCloseTo(0.3, 10);
    expect(bounded.get("1(a)")!.ceiling).toBeCloseTo(0.33 + LEGACY_NEXT_ALLOWANCE, 10);
    expect(bounded.get("1(b)")!.box.y1).toBeCloseTo(0.37, 10);
    // The screenshot row: 0.62 (plus uncapped growth) becomes 0.49.
    expect(bounded.get("1(c)")!.box.y1).toBeCloseTo(0.49, 10);
    expect(bounded.get("1(c)")!.ceiling).toBeCloseTo(0.44 + LEGACY_NEXT_ALLOWANCE, 10);
    // 2(a), boxed one part too high by the marker: the end of 2(b)'s region
    // (2(c)'s top plus the allowance) still holds (a)'s answer at 0.53-0.57.
    expect(bounded.get("2(a)")!.box.y1).toBeCloseTo(0.6, 10);
    expect(bounded.get("2(b)")!.box.y1).toBeCloseTo(0.58, 10);
    // 2(c): only 2(d) below it, whose stored bottom is the page edge.
    expect(bounded.get("2(c)")!.box.y1).toBeCloseTo(0.8, 10);
    expect(bounded.get("2(c)")!.ceiling).toBe(1);
    expect(bounded.get("2(d)")!.box.y1).toBe(1);
    expect(bounded.get("2(d)")!.ceiling).toBeNull();
  });

  it("takes its neighbours from the run, not only from the rows being re-cut", () => {
    const only1c = KA1_PAGE2_STORED.filter((r) => r.key === "1(c)");
    const [alone] = boundStoredModelBoxes(only1c);
    expect(alone.box.y1).toBe(0.62);
    expect(alone.ceiling).toBeNull();
    const [withRun] = boundStoredModelBoxes(only1c, KA1_PAGE2_STORED.map((r) => r.stored));
    expect(withRun.box.y1).toBeCloseTo(0.49, 10);
    expect(withRun.ceiling).toBeCloseTo(0.44 + LEGACY_NEXT_ALLOWANCE, 10);
  });

  it("drops a box that could never be cropped", () => {
    const out = boundStoredModelBoxes([{ key: "flat", stored: { page: 1, x0: 0.5, y0: 0.5, x1: 0.5, y1: 0.6 } }]);
    expect(out).toEqual([]);
  });
});

describe("modelExpansionCaps", () => {
  it("caps at the page edges when there is nothing below", () => {
    expect(modelExpansionCaps(null, A4)).toEqual({ expandMaxX1Pt: 595, expandMaxY1Pt: 842 });
  });

  it("caps downward growth at the ceiling in points, and never past the page", () => {
    expect(modelExpansionCaps(0.44, A4).expandMaxY1Pt).toBeCloseTo(370.48, 10);
    expect(modelExpansionCaps(0.44, A4).expandMaxX1Pt).toBe(595);
    expect(modelExpansionCaps(1.2, A4).expandMaxY1Pt).toBe(842);
  });
});

describe("sameBox", () => {
  const a = { page: 2, x0: 0, y0: 0.33, x1: 0.522, y1: 0.47 };
  it("is true for the same edges within tolerance and false otherwise", () => {
    expect(sameBox(a, { ...a })).toBe(true);
    expect(sameBox(a, { ...a, y1: 0.47 + 1e-9 })).toBe(true);
    expect(sameBox(a, { ...a, y1: 0.48 })).toBe(false);
    expect(sameBox(a, { ...a, page: 3 })).toBe(false);
    expect(sameBox(a, null)).toBe(false);
    expect(sameBox(undefined, a)).toBe(false);
  });
});

describe("anchorCropPlan", () => {
  const anchor = { pageIndex: 2, x0Pt: 50, y0Pt: 200, x1Pt: 500, y1Pt: 300, expandMaxX1Pt: 595, expandMaxY1Pt: 396 };

  it("reproduces the grading run's anchor arithmetic on a same-sized scan", () => {
    const plan = anchorCropPlan({ anchor, referenceSize: A4, scanSize: A4 });
    const expectedBox = anchorToEvidenceBox({
      anchor: { x0Pt: 50, y0Pt: 200, x1Pt: 500, y1Pt: 300 },
      referenceSize: A4,
      page: 3,
      maxY1Pt: 396,
    });
    expect(plan.box).toEqual(expectedBox);
    expect(plan.region.pageIndex).toBe(2);
    expect(plan.region.x0Pt).toBeCloseTo(50, 8);
    expect(plan.region.y0Pt).toBeCloseTo(172, 8);
    expect(plan.region.x1Pt).toBeCloseTo(500, 8);
    expect(plan.region.y1Pt).toBeCloseTo(328, 8);
    expect(plan.region.expandMaxX1Pt).toBeCloseTo(595, 8);
    expect(plan.region.expandMaxY1Pt).toBeCloseTo(396, 8);
  });

  it("rescales the caps through reference fractions on a differently sized scan", () => {
    const letter = { widthPt: 612, heightPt: 792 };
    const plan = anchorCropPlan({ anchor, referenceSize: A4, scanSize: letter });
    const fractions = pointsToFractions({ x0Pt: 0, y0Pt: 0, x1Pt: 595, y1Pt: 396 }, A4);
    expect(plan.region.expandMaxX1Pt).toBeCloseTo(fractions.x1 * 612, 8);
    expect(plan.region.expandMaxY1Pt).toBeCloseTo(fractions.y1 * 792, 8);
    expect(plan.region.x0Pt).toBeCloseTo((50 / 595) * 612, 8);
  });

  it("caps at the page edges when the region has no caps recorded", () => {
    const plan = anchorCropPlan({ anchor: { ...anchor, expandMaxX1Pt: null, expandMaxY1Pt: null }, referenceSize: A4, scanSize: A4 });
    expect(plan.region.expandMaxX1Pt).toBeCloseTo(595, 8);
    expect(plan.region.expandMaxY1Pt).toBeCloseTo(842, 8);
    expect(plan.box.y1).toBeCloseTo(328 / 842, 10);
  });
});

describe("modelCropPlan", () => {
  it("sends the bounded box in scan points with its ceiling as the cap", () => {
    const plan = modelCropPlan({ box: { page: 2, x0: 0, y0: 0.33, x1: 0.522, y1: 0.47 }, ceiling: 0.44 }, A4);
    expect(plan.box).toEqual({ page: 2, x0: 0, y0: 0.33, x1: 0.522, y1: 0.47 });
    expect(plan.region.pageIndex).toBe(1);
    expect(plan.region.y0Pt).toBeCloseTo(0.33 * 842, 8);
    expect(plan.region.y1Pt).toBeCloseTo(0.47 * 842, 8);
    expect(plan.region.x1Pt).toBeCloseTo(0.522 * 595, 8);
    // The cap sits INSIDE the box: the service then grows nothing, which is
    // the point -- the box already reaches the next part.
    expect(plan.region.expandMaxY1Pt).toBeCloseTo(370.48, 8);
    expect(plan.region.expandMaxX1Pt).toBe(595);
  });
});
