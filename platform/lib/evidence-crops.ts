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
 * answer after an "=". They are deliberately NOT applied to a teacher-drawn
 * box, which is a decision rather than an estimate.
 */
export const PAD_PROPORTION = 0.18;
export const PAD_FLOOR = 0.03;

/**
 * Extra downward growth for a model-reported box, on TOP of the symmetric
 * padding above.
 *
 * The model's box is not merely tight, it sits systematically HIGH: the work
 * it describes is a measured mean 0.106 page-heights below the box centre.
 * The symmetric padding never addressed that -- its floor is 0.03 -- so a box
 * that landed on the printed question stopped exactly where the handwriting
 * underneath began, and the crop showed the part BEFORE this one: its answer
 * above, this part's printed prompt at the bottom, and this part's own answer
 * just out of frame. On Key Assessment 1 that is what every part of Q4 looked
 * like (17 Sep 2026); the transcription in `evidence` was right each time, so
 * only the picture was wrong, which is the failure mode hardest to notice.
 *
 * Extending y1 alone is deliberate. Shifting the whole box down by the bias
 * would trade one miss for another whenever the box was already right,
 * whereas growing the bottom edge keeps every correct box correct and rescues
 * the biased ones. The cost is a taller crop that may also show the start of
 * the NEXT part's answer -- acceptable, because the part's own printed label
 * is inside the crop, and a crop with one answer too many beats a crop with
 * none. 0.15 covers the measured 0.106 with margin.
 *
 * This is mitigation, not a cure. A paper with a locked layout takes the
 * anchor path above and never comes near this function; that is the real fix
 * for a paper marked often enough to be worth drawing regions for.
 *
 * SINCE 24 SEP 2026 THE BIAS IS BOUNDED, not fixed. On Key Assessment 1
 * (Grade 9 Standard) the marker's box for Q1(c) was roughly right, and the
 * full 0.15 on a one-line answer, followed by the crop service growing the
 * bottom edge over Q2's PRINTED text (which counts as ink), produced a crop
 * that led with one line of Q1(c) and then showed the whole of Q2. The marker
 * reports a box for every part on the run, and those boxes are
 * self-consistent on a page even when each one is off, so the run's own
 * boxes are the natural limit -- see boundModelBoxes for exactly where.
 */
export const MODEL_DOWNWARD_BIAS = 0.15;

/**
 * WHERE A BOUNDED CROP MAY REACH: the end of the NEXT part's region -- the
 * top of the box after the next one, or the next box's own bottom when
 * nothing follows it on the page -- never merely the next part's top.
 *
 * Both halves are load-bearing. The marker's error runs to about one part:
 * on KA1 Extended it boxed the printed stem of every part of Q4 and the
 * following box covered the handwriting, and on KA1 Standard the same student
 * whose Q1(c) box was right had Q2(a) boxed on the sequence table with (a)'s
 * answer under 2(b)'s box (verified against the scan, 24 Sep 2026). A crop
 * bounded at the next part's TOP is tidy when the box is right and loses the
 * answer when it is one part high -- which is the failure that is hardest
 * to see, since the transcription beside it stays right. Bounding at the end
 * of the next part's region keeps the answer in both cases at the cost of one
 * part too many when the box was right; three parts too many, the screenshot,
 * cannot happen. The service's growth is capped at the same place.
 *
 * NEXT_PART_OVERLAP is the allowance past that second box's reported top: the
 * marker boxes handwriting, so a little overlap keeps that part's printed
 * prompt line in the crop without showing its answer. Two consecutive reported
 * boxes on one run overlap by about this much anyway.
 */
export const NEXT_PART_OVERLAP = 0.02;

/**
 * The same bound for a box that was STORED before the raw box was recorded,
 * which is every row written before evidence_box_reported existed. Its bottom
 * edge already carries padding plus the full bias (and, where "Fix crops" was
 * pressed, one more bias per press), and the raw box is gone, so the only
 * repair that can be recomputed from the row is to cut the bottom back to the
 * end of the next part's region, read off the run's other STORED boxes. A
 * stored top sits padY (at least PAD_FLOOR) above its raw top, hence a larger
 * allowance than NEXT_PART_OVERLAP: PAD_FLOOR plus the same overlap.
 *
 * The bound never WIDENS a stored box: it is a minimum against the stored
 * bottom, which is what makes a re-cut idempotent and what stops the
 * compounding that widenStoredModelBox (removed) used to do.
 */
export const LEGACY_NEXT_ALLOWANCE = PAD_FLOOR + NEXT_PART_OVERLAP;

/** The CV service's growth caps for one region, in points on the scan page. */
export interface ExpansionCaps {
  expandMaxX1Pt: number;
  expandMaxY1Pt: number;
}

/** A box that survives clamping with some width and height left. */
function isCroppable(box: EvidenceBox): boolean {
  return clamp01(box.x1) > clamp01(box.x0) && clamp01(box.y1) > clamp01(box.y0);
}

interface PaddedParts {
  padded: EvidenceBox;
  padY: number;
  rawY0: number;
  rawY1: number;
}

/**
 * padModelBox's arithmetic, with the intermediate values a bounded box needs
 * (the raw bottom edge and the vertical padding) handed back alongside.
 */
function padModelBoxParts(box: EvidenceBox): PaddedParts | null {
  const rawX0 = clamp01(box.x0);
  const rawY0 = clamp01(box.y0);
  const rawX1 = clamp01(box.x1);
  const rawY1 = clamp01(box.y1);
  if (rawX1 <= rawX0 || rawY1 <= rawY0) return null;

  const padX = Math.max((rawX1 - rawX0) * PAD_PROPORTION, PAD_FLOOR);
  const padY = Math.max((rawY1 - rawY0) * PAD_PROPORTION, PAD_FLOOR);

  return {
    padded: {
      page: box.page,
      x0: clamp01(rawX0 - padX),
      y0: clamp01(rawY0 - padY),
      x1: clamp01(rawX1 + padX),
      y1: clamp01(rawY1 + padY + MODEL_DOWNWARD_BIAS),
    },
    padY,
    rawY0,
    rawY1,
  };
}

/**
 * Clamp, reject, and pad one model-reported box, on its own.
 *
 * Returns null for a box that cannot be cropped at all -- inverted or
 * zero-width/height after clamping. That is the same "skip this part, keep
 * grading" outcome the grading route has always taken; a missing crop is fine,
 * a nonsense one is not.
 *
 * The three other edges stay byte-compatible with what is already in
 * ai_grade_results.evidence_box: lib/evidence-crops.test.ts replays real
 * padded boxes from a graded paper through it and requires exact equality on
 * x0/y0/x1, so a change in that arithmetic cannot pass unnoticed. Only the
 * bottom edge moved, and it moved on purpose -- see MODEL_DOWNWARD_BIAS.
 *
 * This is the UNBOUNDED form: the full bias, whatever sits below the box. The
 * grading run and the re-cut go through boundModelBoxes, which gives exactly
 * this result for a part with no reported neighbour below it on the page.
 */
export function padModelBox(box: EvidenceBox): EvidenceBox | null {
  return padModelBoxParts(box)?.padded ?? null;
}

/**
 * The top of the nearest box that starts BELOW this one on the same page, or
 * null when nothing does. Strictly below: a box reported at the same top is
 * the same region seen twice, not a neighbour. Order is by position, never by
 * part order -- the paper decides what is underneath, not the numbering.
 */
export function nextTopBelow(box: EvidenceBox, others: EvidenceBox[]): number | null {
  let next: number | null = null;
  for (const other of others) {
    if (other === box || other.page !== box.page) continue;
    if (other.y0 > box.y0 && (next === null || other.y0 < next)) next = other.y0;
  }
  return next;
}

/** Where the region of the box below this one ends -- see NEXT_PART_OVERLAP. */
export interface RegionEndBelow {
  /** The second box's top, or the next box's bottom when it is the last on the page. */
  y: number;
  kind: "second-top" | "next-bottom";
}

/**
 * The end of the NEXT box's region on this page: the top of the box after
 * it, else its own bottom. Null when nothing is below this box at all.
 */
export function regionEndBelow(box: EvidenceBox, others: EvidenceBox[]): RegionEndBelow | null {
  let next: EvidenceBox | null = null;
  for (const other of others) {
    if (other === box || other.page !== box.page) continue;
    if (other.y0 > box.y0 && (next === null || other.y0 < next.y0)) next = other;
  }
  if (!next) return null;
  const second = nextTopBelow(next, others);
  return second === null ? { y: next.y1, kind: "next-bottom" } : { y: second, kind: "second-top" };
}

/** One model-located box after bounding, with the growth ceiling that goes with it. */
export interface BoundedModelBox<K = string> {
  key: K;
  box: EvidenceBox;
  /**
   * Where the CV service's downward growth must stop, as a fraction of the
   * page, or null for "the page edge". Below the box's own bottom edge it
   * simply suppresses growth; it is never used to shrink the box.
   */
  ceiling: number | null;
}

/**
 * Pad and bound every model-reported box on one run (the RAW rule).
 *
 * x0/y0/x1 are padModelBox's exactly. The bottom edge drops by up to
 * MODEL_DOWNWARD_BIAS, but no further than the end of the next part's region
 * (regionEndBelow, plus NEXT_PART_OVERLAP past a second box's top or
 * PAD_FLOOR past the next box's own bottom), and never above the padded
 * box's own bottom (rawY1 + padY) -- a bound inside the box limits the bias
 * to nothing, it does not cut into the box.
 *
 * `neighbours` is every box the marker reported on the run, including parts
 * that will be cut from a paper layout instead: their reported top still says
 * where the next part's writing begins. It defaults to the inputs' own raws.
 * A degenerate box (inverted or empty after clamping) is dropped from the
 * output and never acts as a neighbour.
 */
export function boundModelBoxes<K>(
  inputs: { key: K; raw: EvidenceBox }[],
  neighbours?: EvidenceBox[]
): BoundedModelBox<K>[] {
  const pool = (neighbours ?? inputs.map((i) => i.raw)).filter(isCroppable);
  const out: BoundedModelBox<K>[] = [];
  for (const { key, raw } of inputs) {
    const parts = padModelBoxParts(raw);
    if (!parts) continue;
    const end = regionEndBelow(raw, pool);
    if (end === null) {
      out.push({ key, box: parts.padded, ceiling: null });
      continue;
    }
    const floor = parts.rawY1 + parts.padY;
    const ceiling = end.y + (end.kind === "second-top" ? NEXT_PART_OVERLAP : PAD_FLOOR);
    const y1 = clamp01(Math.max(floor, Math.min(floor + MODEL_DOWNWARD_BIAS, ceiling)));
    out.push({ key, box: { ...parts.padded, y1 }, ceiling });
  }
  return out;
}

/**
 * Bound one box that was stored without its raw counterpart (the LEGACY
 * rule): cut the bottom edge back to `regionEnd`, the end of the next part's
 * region as boundStoredModelBoxes reads it off the run. Never widens, so
 * applying it twice gives the same box, and a box with nothing below it is
 * returned as it is.
 */
export function boundStoredModelBox(stored: EvidenceBox, regionEnd: number | null): EvidenceBox {
  if (regionEnd === null) return stored;
  return { ...stored, y1: clamp01(Math.min(stored.y1, regionEnd)) };
}

/**
 * The legacy rule over a whole run. `neighbours` should be every stored box
 * on the run whatever its source -- a teacher-drawn or layout-cut neighbour's
 * top is real, and bounding against it is better than not. Defaults to the
 * inputs' own boxes. Degenerate boxes are dropped and never neighbours.
 *
 * The bound is LEGACY_NEXT_ALLOWANCE past a second box's stored top, or the
 * next box's stored bottom when it is the last on the page (that bottom
 * already carries padding and bias, so nothing is added to it).
 */
export function boundStoredModelBoxes<K>(
  inputs: { key: K; stored: EvidenceBox }[],
  neighbours?: EvidenceBox[]
): BoundedModelBox<K>[] {
  const pool = (neighbours ?? inputs.map((i) => i.stored)).filter(isCroppable);
  const out: BoundedModelBox<K>[] = [];
  for (const { key, stored } of inputs) {
    if (!isCroppable(stored)) continue;
    const end = regionEndBelow(stored, pool);
    const regionEnd = end === null ? null : end.y + (end.kind === "second-top" ? LEGACY_NEXT_ALLOWANCE : 0);
    out.push({
      key,
      box: boundStoredModelBox(stored, regionEnd),
      ceiling: regionEnd,
    });
  }
  return out;
}

/**
 * Growth caps for a model-located region. Right: the page edge, as for
 * per-paper regions (see computeExpansionCaps). Down: the bounded ceiling in
 * points, or the page edge when there is none.
 *
 * Deliberately NOT floored at the region's own bottom edge, unlike
 * computeExpansionCaps: a cap that lands inside the box just suppresses
 * growth (scripts/cv_crop_extract.py's _adaptive_crop_bounds only ever grows
 * from the box's edge and never shrinks it), which is exactly what a crop
 * already reaching the next part wants, and what noExpansionCaps relies on.
 */
export function modelExpansionCaps(ceiling: number | null, size: PageSizePt): ExpansionCaps {
  return {
    expandMaxX1Pt: size.widthPt,
    expandMaxY1Pt: ceiling === null ? size.heightPt : Math.min(size.heightPt, ceiling * size.heightPt),
  };
}

/** Same page and the same four edges to within `epsilon` -- for "nothing to re-cut". */
export function sameBox(
  a: EvidenceBox | null | undefined,
  b: EvidenceBox | null | undefined,
  epsilon = 1e-6
): boolean {
  if (!a || !b || a.page !== b.page) return false;
  return (
    Math.abs(a.x0 - b.x0) <= epsilon &&
    Math.abs(a.y0 - b.y0) <= epsilon &&
    Math.abs(a.x1 - b.x1) <= epsilon &&
    Math.abs(a.y1 - b.y1) <= epsilon
  );
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

/**
 * How far a student's writing may sit from where a per-paper region puts it,
 * in points.
 *
 * Measured across six classmates' scans of the same booklet: vertical offset
 * between two students on the same printed page is bimodal -- either 0pt or
 * about 27pt, never in between. It is a grey scanner band at the top of the
 * image, present on some pages and not others, which shifts everything below
 * it down. Horizontal drift over the same sample was under 6pt, so no
 * corresponding x tolerance is warranted.
 *
 * Applied to BOTH edges. Adaptive expansion looked like it covered the
 * downward direction, but it only grows while ink is still touching the edge,
 * and the whitespace between two answers stops it dead -- verified by cropping
 * one student's regions out of another's scan, where Q2(b) came back showing
 * Q2(a)'s answer for exactly this reason. The downward tolerance is bounded by
 * the region's expansion cap so it still cannot reach into the next part.
 *
 * This is deliberately not a detected per-scan offset: detecting one needs the
 * page rasterised, and a fixed tolerance costs a line of extra context against
 * a model error that measured 89pt on average.
 */
export const ANCHOR_TOLERANCE_PT = 28;

/** One part's two independent opinions about which page its work is on. */
export interface AnchorPageObservation {
  /** 1-indexed page the locked layout puts this part on. */
  anchorPage: number;
  /** 1-indexed page the grading model reported finding the handwriting on. */
  modelPage: number;
}

/**
 * The page from which a locked layout stops describing THIS scan, or null
 * while it still does.
 *
 * Anchors address a student's scan by absolute page index, which holds only
 * while the scan's pages 1..N are the booklet's pages 1..N in order. The
 * caller's page-count guard catches a scan that is too SHORT, where a lost
 * page puts everything after the gap on the wrong page. It deliberately lets
 * a LONGER scan through, because the common cause is a trailing loose sheet
 * after the booklet -- three of six sampled scans had one -- and that leaves
 * every anchored page exactly where it was.
 *
 * What it cannot see is a page inserted anywhere but the end: a redone cover
 * sheet at the front, a working sheet in the middle. The count still passes,
 * and every anchor from the insertion onward then cuts one page early. That
 * failure is silent, which is the worst property a crop can have -- the panel
 * shows a confident crop of the wrong question's work, with nothing saying so.
 *
 * The only evidence available is that the model ALSO reports a page per part,
 * read from the content rather than counted, so the two disagree exactly when
 * the mapping has broken. They are not equally reliable -- the model's box
 * measured 89pt of average error, which is why anchors exist at all -- so a
 * disagreement is read as a shift only when it has the shape of one:
 *
 *   - Fewer than two disagreements is model noise. One anchor is not overruled
 *     by one vision call.
 *   - Disagreements by DIFFERENT amounts are noise too. A shift moves every
 *     page after it by the same number.
 *   - A constant offset over a contiguous TAIL of the paper is a shift. A
 *     student who continued two answers onto a later sheet disagrees in the
 *     same direction, but the parts printed between those pages still agree,
 *     and that is what separates the two.
 *
 * It returns the page rather than a yes/no because the answer is not
 * all-or-nothing, unlike the short-scan case: pages before an insertion are
 * still the pages their regions were drawn on, so their anchors stay. Only
 * parts at or past the returned page fall back to the model's own box. That
 * is also what keeps the cost of a wrong call small -- a student who finished
 * two answers on a loose back sheet loses the anchors for those parts, which
 * were going to crop the page they abandoned, and keeps the other thirty-odd.
 *
 * Two shifted parts with no counter-evidence is thin, and it is allowed to
 * decide, for that reason.
 */
export function firstShiftedAnchorPage(observations: AnchorPageObservation[]): number | null {
  const disagreeing = observations.filter((o) => o.modelPage !== o.anchorPage);
  if (disagreeing.length < 2) return null;

  const offset = disagreeing[0].modelPage - disagreeing[0].anchorPage;
  if (disagreeing.some((o) => o.modelPage - o.anchorPage !== offset)) return null;

  // A shift runs to the end of the paper. Anything still agreeing at or after
  // the first shifted page means the pages did not move under it.
  const firstShifted = Math.min(...disagreeing.map((o) => o.anchorPage));
  const stillHolds = observations.some(
    (o) => o.anchorPage >= firstShifted && o.modelPage === o.anchorPage
  );
  return stillHolds ? null : firstShifted;
}

/** Absolute points on a page -> fractions of that same page. */
export function pointsToFractions(points: PointBox, size: PageSizePt): Omit<EvidenceBox, "page"> {
  return {
    x0: points.x0Pt / size.widthPt,
    y0: points.y0Pt / size.heightPt,
    x1: points.x1Pt / size.widthPt,
    y1: points.y1Pt / size.heightPt,
  };
}

/**
 * Turn a stored per-paper region into the box to crop from one student's scan.
 *
 * Everything crosses through FRACTIONS of the reference page rather than being
 * copied as points. That is what makes the geometry survive a student scanned
 * at a different paper size or scanner scale: the same proportion of the page
 * is cut either way, and the route multiplies the result by the actual scan
 * page's own size. Copying points straight across is the gap na_anchors leaves
 * open, where a Letter-vs-A4 scan would shift every crop with no signal.
 *
 * `page` is the 1-indexed page in the STUDENT's scan, which is the anchor's
 * own page index plus one whenever the deterministic page mapping holds. The
 * caller owns deciding whether it does.
 */
export function anchorToEvidenceBox(args: {
  anchor: PointBox;
  referenceSize: PageSizePt;
  page: number;
  tolerancePt?: number;
  /** The region's growth cap in reference points; the downward tolerance stops here. */
  maxY1Pt?: number;
}): EvidenceBox {
  const tolerance = args.tolerancePt ?? ANCHOR_TOLERANCE_PT;
  const ceiling = args.maxY1Pt ?? args.referenceSize.heightPt;
  const withTolerance: PointBox = {
    ...args.anchor,
    y0Pt: Math.max(0, args.anchor.y0Pt - tolerance),
    // Grow down by the tolerance, but never past the cap (the next region's
    // top) and never above the region's own bottom edge if the cap is tighter.
    y1Pt: Math.min(
      args.referenceSize.heightPt,
      Math.max(args.anchor.y1Pt, Math.min(args.anchor.y1Pt + tolerance, ceiling))
    ),
  };
  const fractions = pointsToFractions(withTolerance, args.referenceSize);
  return {
    page: args.page,
    x0: clamp01(fractions.x0),
    y0: clamp01(fractions.y0),
    x1: clamp01(fractions.x1),
    y1: clamp01(fractions.y1),
  };
}

/** A test_item_anchors row as the crop builders read it, in reference points. */
export interface StoredAnchor {
  /** 0-indexed page of the reference PDF. */
  pageIndex: number;
  x0Pt: number;
  y0Pt: number;
  x1Pt: number;
  y1Pt: number;
  expandMaxX1Pt: number | null;
  expandMaxY1Pt: number | null;
}

/** What one crop needs: the box to record, and the region to send the CV service. */
export interface CropPlan {
  box: EvidenceBox;
  region: { pageIndex: number } & PointBox & ExpansionCaps;
}

/**
 * The crop for one part from a per-paper region, on one student's scan.
 *
 * This used to be spelled out in both the grading run and the re-cut script,
 * which is one copy more than a conversion between three coordinate spaces
 * can afford. The box crosses through reference fractions
 * (anchorToEvidenceBox), and so do the caps: passed straight across as points
 * they would cap growth at the wrong place on a differently sized scan.
 */
export function anchorCropPlan(args: {
  anchor: StoredAnchor;
  referenceSize: PageSizePt;
  scanSize: PageSizePt;
}): CropPlan {
  const { anchor, referenceSize, scanSize } = args;
  const box = anchorToEvidenceBox({
    anchor: { x0Pt: anchor.x0Pt, y0Pt: anchor.y0Pt, x1Pt: anchor.x1Pt, y1Pt: anchor.y1Pt },
    referenceSize,
    page: anchor.pageIndex + 1,
    // The tolerance may grow the region down, but not past the cap -- which
    // is the next region's top, so it cannot reach the next part.
    maxY1Pt: anchor.expandMaxY1Pt === null ? undefined : anchor.expandMaxY1Pt,
  });
  const capFractions = pointsToFractions(
    {
      x0Pt: 0,
      y0Pt: 0,
      x1Pt: anchor.expandMaxX1Pt ?? referenceSize.widthPt,
      y1Pt: anchor.expandMaxY1Pt ?? referenceSize.heightPt,
    },
    referenceSize
  );
  return {
    box,
    region: {
      pageIndex: anchor.pageIndex,
      ...fractionBoxToPoints(box, scanSize),
      expandMaxX1Pt: capFractions.x1 * scanSize.widthPt,
      expandMaxY1Pt: capFractions.y1 * scanSize.heightPt,
    },
  };
}

/** The crop for one bounded model box (see boundModelBoxes / boundStoredModelBoxes). */
export function modelCropPlan(
  bounded: { box: EvidenceBox; ceiling: number | null },
  scanSize: PageSizePt
): CropPlan {
  return {
    box: bounded.box,
    region: {
      pageIndex: bounded.box.page - 1,
      ...fractionBoxToPoints(bounded.box, scanSize),
      ...modelExpansionCaps(bounded.ceiling, scanSize),
    },
  };
}
