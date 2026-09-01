/**
 * na-anchor-emit.ts
 * -----------------------------------------------------------------------------
 * Turns the Typst compiler's <na-anchor> metadata query results into
 * na_anchors-shaped geometry -- the `anchor_source = 'typst_metadata'` path
 * the scan-pipeline schema always anticipated but never had an
 * implementation for.
 *
 * WHY EMIT INSTEAD OF DETECT: every anchor-geometry incident in
 * docs/HANDOFF.md (auto_fillrect missing Q26(a)'s grid, authored y0/y1
 * undershooting printed borders, students answering inline in regions the
 * box never covered, and finally the 1 Sep discovery that scanner auto-crop
 * / photocopier scaling had silently invalidated geometry for a whole
 * cohort) traces back to the same root: geometry was measured FROM the
 * printed artefact after the fact. The renderer, by contrast, knows the
 * exact position of every element at compile time. The Typst template
 * plants a zero-size `#metadata((...)) <na-anchor>` marker pair around each
 * question block and this module pairs them into rectangles.
 *
 * THE ANCHOR SPANS THE WHOLE QUESTION BLOCK -- prompt, sub-items, and
 * answer box together -- not just the drawn box. That is a deliberate
 * design rule, not laziness: A.1's Q1/Q2/Q15/Q17 all lost real student
 * answers because students annotate printed sub-items ABOVE the box, and a
 * crop that starts at the box top structurally cannot see them (there is no
 * upward expansion). Printed prompt content inside a crop is harmless (the
 * grader receives the question text anyway); missing handwriting is not.
 * This also removes the need for separate prompt crops entirely.
 */

export interface AnchorMarkerRow {
  /** Raw metadata value from the Typst query. */
  value: {
    qid: string;
    kind: "start" | "end" | "doc-end";
    pos: { page: number; x: string; y: string };
  };
}

export interface EmittedAnchor {
  qid: string;
  sortOrder: number;
  /** 0-indexed, matching na_anchors.page_index convention. */
  pageIndex: number;
  x0Pt: number;
  y0Pt: number;
  x1Pt: number;
  y1Pt: number;
  expandMaxX1Pt: number;
  expandMaxY1Pt: number;
}

export interface EmitOptions {
  /** Content column bounds in pt (defaults match A4 with 18mm margins). */
  contentX0Pt?: number;
  contentX1Pt?: number;
  pageHeightPt?: number;
  pageWidthPt?: number;
}

const PT_PER_MM = 72 / 25.4;

/** Parses Typst's "123.45pt" length strings. */
export function parsePt(v: string): number {
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n)) throw new Error(`Unparseable Typst length: ${JSON.stringify(v)}`);
  return n;
}

export function mmToPt(mm: number): number {
  return mm * PT_PER_MM;
}

/**
 * Pairs start/end markers into anchors and derives expansion caps.
 *
 * Caps use each NEIGHBOR'S MEASURED position, never an authored guess --
 * the "expand_max derived from a neighbour's authored coordinate" bug class
 * (HANDOFF, Q6) cannot occur when both sides come from the same compile.
 * A vertical pad absorbs handwriting that strays a few pt past the block.
 */
export function pairAnchorMarkers(
  rows: AnchorMarkerRow[],
  opts: EmitOptions = {}
): { anchors: EmittedAnchor[]; pageCount: number | null } {
  const contentX0 = opts.contentX0Pt ?? mmToPt(18);
  const contentX1 = opts.contentX1Pt ?? 595 - mmToPt(18);
  const pageH = opts.pageHeightPt ?? 842;
  const pageW = opts.pageWidthPt ?? 595;

  let pageCount: number | null = null;
  const starts: { qid: string; page: number; y: number }[] = [];
  const ends = new Map<string, { page: number; y: number }>();

  for (const row of rows) {
    const v = row.value;
    if (!v || typeof v !== "object") continue;
    if (v.kind === "doc-end") {
      pageCount = v.pos.page;
      continue;
    }
    const y = parsePt(v.pos.y);
    if (v.kind === "start") {
      starts.push({ qid: v.qid, page: v.pos.page, y });
    } else if (v.kind === "end") {
      // Last end wins if a qid somehow repeats -- but repeats are a bug.
      if (ends.has(v.qid)) throw new Error(`Duplicate end marker for ${v.qid}`);
      ends.set(v.qid, { page: v.pos.page, y });
    }
  }

  const anchors: EmittedAnchor[] = starts.map((s, i) => {
    const e = ends.get(s.qid);
    if (!e) throw new Error(`No end marker for ${s.qid}`);
    if (e.page !== s.page) {
      // Question blocks are breakable:false in the template, so a pair
      // spanning pages means the template contract was violated.
      throw new Error(`${s.qid} spans pages ${s.page}-${e.page}; question blocks must not break`);
    }
    return {
      qid: s.qid,
      sortOrder: i,
      pageIndex: s.page - 1,
      x0Pt: round2(contentX0),
      y0Pt: round2(Math.max(0, s.y - 3)),
      x1Pt: round2(contentX1),
      y1Pt: round2(Math.min(pageH, e.y + 3)),
      expandMaxX1Pt: round2(Math.min(pageW - 3, contentX1 + 36)),
      expandMaxY1Pt: 0, // filled below once page neighbours are known
    };
  });

  // Expansion cap: down to just above the next block on the same page, or
  // the bottom content edge for the last block on a page.
  const byPage = new Map<number, EmittedAnchor[]>();
  for (const a of anchors) {
    const list = byPage.get(a.pageIndex) ?? [];
    list.push(a);
    byPage.set(a.pageIndex, list);
  }
  for (const list of byPage.values()) {
    list.sort((a, b) => a.y0Pt - b.y0Pt);
    for (let i = 0; i < list.length; i++) {
      const next = list[i + 1];
      const cap = next ? next.y0Pt - 4 : pageH - 12;
      // Never cap above the block's own bottom.
      list[i].expandMaxY1Pt = round2(Math.max(cap, list[i].y1Pt));
    }
  }

  return { anchors, pageCount };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
