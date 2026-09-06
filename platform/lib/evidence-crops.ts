/**
 * Geometry for AI-grading evidence crops.
 *
 * Lives here rather than inside the route because AGENTS.md rules out unit
 * tests for Next.js API routes, and this arithmetic is exactly the kind that
 * fails silently: a wrong conversion still produces a plausible-looking crop
 * of the wrong part of the page, which is the defect this whole area is being
 * fixed for.
 *
 * THREE coordinate spaces meet here, and confusing any two of them is the
 * bug to guard against:
 *
 *  - `EvidenceBox` (ai_grade_results.evidence_box) is FRACTIONS of one
 *    scanned page, `page` 1-INDEXED. That is what the grading model reports
 *    and what the full-page view reads back to draw its red outline, so it
 *    stays the stored form.
 *  - The CV service's /crop and /page-image endpoints want absolute PDF
 *    POINTS, `pageIndex` 0-INDEXED (cv-service/main.py's AnchorIn;
 *    scripts/cv_crop_extract.py's Anchor).
 *  - The browser reports a drawn box as fractions of the RENDERED IMAGE.
 *    Those equal page fractions only because the page image is the whole
 *    page, undistorted -- the editor must therefore measure against the
 *    <img> element's own box, not a padded container.
 *
 * Fractions convert to points using THAT page's own width and height, read
 * from the PDF being cropped. Never a constant: a scan carries whatever page
 * box the scanner produced, and assuming A4 is how a crop ends up shifted for
 * every student at once.
 */

export interface EvidenceBox {
  /** 1-indexed page within the scan. */
  page: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PageSizePt {
  widthPt: number;
  heightPt: number;
}

export interface PointBox {
  x0Pt: number;
  y0Pt: number;
  x1Pt: number;
  y1Pt: number;
}

/**
 * Smallest box we will accept, as a fraction of the page in each dimension.
 * A stray click during a drag registers as a near-zero rectangle; cropping
 * that yields a handful of pixels that look like a broken feature rather than
 * an obvious mis-click. On A4 this floor is about 6pt wide by 8pt tall --
 * far below any real answer, so it rejects only accidents.
 */
export const MIN_BOX_FRACTION = 0.01;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export type NormalizeResult = { ok: true; box: EvidenceBox } | { ok: false; error: string };

/**
 * Validates and canonicalises a box drawn in the browser.
 *
 * Drags run in any direction, so x0/y0 are not necessarily the top-left --
 * the corners are sorted here rather than trusted. Values are clamped to the
 * page, because a drag that leaves the image edge is a legitimate way to say
 * "all the way to the margin".
 */
export function normalizeFractionBox(input: {
  page?: unknown;
  x0?: unknown;
  y0?: unknown;
  x1?: unknown;
  y1?: unknown;
}): NormalizeResult {
  const page = input.page;
  if (typeof page !== "number" || !Number.isInteger(page) || page < 1) {
    return { ok: false, error: "page must be a whole number of 1 or more" };
  }

  const coords: Record<string, number> = {};
  for (const key of ["x0", "y0", "x1", "y1"] as const) {
    const value = input[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { ok: false, error: `${key} must be a finite number` };
    }
    coords[key] = clamp01(value);
  }

  const x0 = Math.min(coords.x0, coords.x1);
  const x1 = Math.max(coords.x0, coords.x1);
  const y0 = Math.min(coords.y0, coords.y1);
  const y1 = Math.max(coords.y0, coords.y1);

  if (x1 - x0 < MIN_BOX_FRACTION || y1 - y0 < MIN_BOX_FRACTION) {
    return { ok: false, error: "That box is too small to crop -- drag a region around the student's work" };
  }

  return { ok: true, box: { page, x0, y0, x1, y1 } };
}

/** Fractions of a page -> absolute points on that same page. */
export function fractionBoxToPoints(box: EvidenceBox, size: PageSizePt): PointBox {
  return {
    x0Pt: box.x0 * size.widthPt,
    y0Pt: box.y0 * size.heightPt,
    x1Pt: box.x1 * size.widthPt,
    y1Pt: box.y1 * size.heightPt,
  };
}

/**
 * The expansion caps to send with a teacher-drawn box.
 *
 * `extract_crops` always applies CROP_BLEED_PT (3pt) and then grows the
 * right/bottom edges while it still finds ink there, capped by
 * expand_max_x1_pt/expand_max_y1_pt. That adaptive growth exists to rescue a
 * box the MODEL drew too tight. A teacher looking at the page and dragging a
 * rectangle has already decided where the work ends, so growth would only
 * pull in the next part's writing -- the exact failure being fixed.
 *
 * Setting each cap to the box's own edge suppresses it: the cap in pixels
 * lands just inside the bleed-expanded edge, so the "is there room to grow"
 * test is false from the start and the crop is the drawn box plus bleed.
 * (`possibly_truncated` may come back true as a result; it is meaningless
 * here and is not stored.)
 */
export function noExpansionCaps(points: PointBox): { expandMaxX1Pt: number; expandMaxY1Pt: number } {
  return { expandMaxX1Pt: points.x1Pt, expandMaxY1Pt: points.y1Pt };
}
