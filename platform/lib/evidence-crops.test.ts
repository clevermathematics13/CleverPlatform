import { describe, it, expect } from "vitest";
import {
  MIN_BOX_FRACTION,
  PAD_FLOOR,
  PAD_PROPORTION,
  fractionBoxToPoints,
  noExpansionCaps,
  normalizeFractionBox,
  padModelBox,
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
    "reproduces the stored box for %s",
    (_label, [x0, y0, x1, y1], [ex0, ey0, ex1, ey1]) => {
      const padded = padModelBox({ page: 3, x0, y0, x1, y1 });
      expect(padded).not.toBeNull();
      expect(padded!.x0).toBeCloseTo(ex0, 10);
      expect(padded!.y0).toBeCloseTo(ey0, 10);
      expect(padded!.x1).toBeCloseTo(ex1, 10);
      expect(padded!.y1).toBeCloseTo(ey1, 10);
    }
  );

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
