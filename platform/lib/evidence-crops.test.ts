import { describe, it, expect } from "vitest";
import {
  MIN_BOX_FRACTION,
  fractionBoxToPoints,
  noExpansionCaps,
  normalizeFractionBox,
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
