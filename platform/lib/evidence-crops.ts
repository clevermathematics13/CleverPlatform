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

/**
 * Outward padding applied to the box the GRADING MODEL reports, before it is
 * cropped. Proportional to the box's own size so a large block of working is
 * not padded off the page, with a fraction-of-page floor so a small, tightly
 * drawn box still gets a usable margin.
 *
 * These exist because the model's box skews tight -- it clips the tail of a
 * line that runs further right or lower than expected, e.g. a final numeric
 * answer after an "=". They do NOT fix the model's much larger vertical
 * mislocation (measured mean 0.106 page-heights below the box centre, against
 * a floor of 0.03), and they are deliberately NOT applied to a teacher-drawn
 * box, which is a decision rather than an estimate.
 */
export const PAD_PROPORTION = 0.18;
export const PAD_FLOOR = 0.03;

/**
 * Clamp, reject, and pad one model-reported box.
 *
 * Returns null for a box that cannot be cropped at all -- inverted or
 * zero-width/height after clamping. That is the same "skip this part, keep
 * grading" outcome the grading route has always taken; a missing crop is fine,
 * a nonsense one is not.
 *
 * Kept byte-compatible with what is already in ai_grade_results.evidence_box:
 * lib/evidence-crops.test.ts replays real padded boxes from a graded paper
 * through it and requires exact equality, so a change in this arithmetic
 * cannot pass unnoticed.
 */
export function padModelBox(box: EvidenceBox): EvidenceBox | null {
  const rawX0 = clamp01(box.x0);
  const rawY0 = clamp01(box.y0);
  const rawX1 = clamp01(box.x1);
  const rawY1 = clamp01(box.y1);
  if (rawX1 <= rawX0 || rawY1 <= rawY0) return null;

  const padX = Math.max((rawX1 - rawX0) * PAD_PROPORTION, PAD_FLOOR);
  const padY = Math.max((rawY1 - rawY0) * PAD_PROPORTION, PAD_FLOOR);

  return {
    page: box.page,
    x0: clamp01(rawX0 - padX),
    y0: clamp01(rawY0 - padY),
    x1: clamp01(rawX1 + padX),
    y1: clamp01(rawY1 + padY),
  };
}

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

/** One region on a reference page, as stored in test_item_anchors. */
export interface AnchorRegion {
  /** 0-indexed page of the reference PDF. */
  pageIndex: number;
  x0Pt: number;
  y0Pt: number;
  x1Pt: number;
  y1Pt: number;
}

/**
 * Gap left between a region's growth cap and the next region below it, in
 * points. Small enough that a student writing slightly past their box is
 * still captured, large enough that expansion stops before the next part's
 * first line rather than clipping into it.
 */
export const EXPANSION_GAP_PT = 4;

/**
 * Growth caps for a set of per-paper anchors.
 *
 * Anchors are drawn ONCE for a whole class, so unlike a teacher's per-student
 * redraw they must tolerate a student who writes more than the region allows.
 * That is what the CV service's adaptive expansion is for -- it grows the
 * right/bottom edge while ink is still touching it. Left uncapped it would
 * happily run down into the next part's answer, so each region's bottom cap
 * is the top of the nearest region below it on the same page.
 *
 * The rule existed only as prose in cv_crop_extract.py's docstring ("the next
 * anchor's position, or the page edge"), and HANDOFF records it propagating a
 * neighbour's measurement error into a cap when applied by hand. Computing it
 * makes it checkable.
 *
 * The x cap is the page edge, deliberately. Regions on a written paper stack
 * vertically; a region to the RIGHT is rare, and capping horizontally on one
 * would truncate a long line of working for every student on the paper.
 */
export function computeExpansionCaps(
  regions: AnchorRegion[],
  pageSizes: PageSizePt[]
): { expandMaxX1Pt: number; expandMaxY1Pt: number }[] {
  return regions.map((region) => {
    const page = pageSizes[region.pageIndex];
    const pageWidthPt = page?.widthPt ?? region.x1Pt;
    const pageHeightPt = page?.heightPt ?? region.y1Pt;

    // The nearest region that starts below this one's bottom edge. Regions
    // that merely overlap it are not "below" and must not cap it, or two
    // slightly overlapping boxes would cap each other to nothing.
    let nextTopPt: number | null = null;
    for (const other of regions) {
      if (other === region || other.pageIndex !== region.pageIndex) continue;
      if (other.y0Pt >= region.y1Pt && (nextTopPt === null || other.y0Pt < nextTopPt)) {
        nextTopPt = other.y0Pt;
      }
    }

    // The gap is there to stop growth clipping into the NEXT REGION, so it
    // applies only when there is one. Against the page edge there is nothing
    // to keep clear of, and shaving it would cost the last region on a page
    // the bottom of a long answer for no reason.
    const ceilingPt = nextTopPt === null ? pageHeightPt : Math.min(pageHeightPt, nextTopPt - EXPANSION_GAP_PT);

    return {
      expandMaxX1Pt: pageWidthPt,
      // Never below the region's own bottom edge: a cap inside the box would
      // make the crop smaller than what was drawn.
      expandMaxY1Pt: Math.max(region.y1Pt, ceilingPt),
    };
  });
}
