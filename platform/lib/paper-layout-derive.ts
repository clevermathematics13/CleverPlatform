/**
 * paper-layout-derive.ts
 * -----------------------------------------------------------------------------
 * Reads the invisible marks lib/paper-anchor-marks.ts printed into a generated
 * paper back out of the finished PDF, as one region per part.
 *
 * This is the other half of the contract. The renderer knows where it put each
 * answer box but not which printed page it landed on; the PDF knows both. So
 * the geometry is not measured, inferred or guessed anywhere -- it is read off
 * the same document the students are handed, in the same points the crop
 * service cuts in.
 *
 * Server-only: pdfjs is loaded on demand so a client bundle never pulls it in.
 * -----------------------------------------------------------------------------
 */

import { parseAnchorMarks, type AnchorMarkCorner } from "./paper-anchor-marks";
import type { PageSizePt } from "./evidence-crops";

export interface DerivedAnchor {
  questionNumber: number;
  /** null for a question with no subparts, matching what the editor stores. */
  partLabel: string | null;
  /** 0-indexed page of the paper. */
  pageIndex: number;
  x0Pt: number;
  y0Pt: number;
  x1Pt: number;
  y1Pt: number;
}

export interface DerivedLayout {
  anchors: DerivedAnchor[];
  pageSizes: PageSizePt[];
  pageCount: number;
  /** Parts whose marks were incomplete or nonsensical, named for the caller to report. */
  warnings: string[];
}

interface MarkHit {
  corner: AnchorMarkCorner;
  pageIndex: number;
  xPt: number;
  /** Distance from the TOP of the page, the convention test_item_anchors uses. */
  yTopPt: number;
}

const key = (q: number, p: string) => `${q}|${p}`;

/**
 * Find every mark in the paper and pair the two corners of each box.
 *
 * A PDF text layer may split a run anywhere -- "@@A4b@@" can arrive as three
 * items -- so each page's items are joined into one string, matched there, and
 * the match offset mapped back to the item it started in for a position. That
 * is why parseAnchorMarks reports an index rather than taking one item.
 */
export async function deriveLayoutFromPaper(pdf: Buffer): Promise<DerivedLayout> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true }).promise;

  const pageSizes: PageSizePt[] = [];
  const hits = new Map<string, MarkHit[]>();

  for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
    const page = await doc.getPage(pageNo);
    const viewport = page.getViewport({ scale: 1 });
    pageSizes.push({ widthPt: viewport.width, heightPt: viewport.height });

    const content = await page.getTextContent();
    let joined = "";
    const starts: { at: number; xPt: number; yPt: number }[] = [];
    for (const raw of content.items) {
      const item = raw as { str?: string; transform?: number[] };
      if (typeof item.str !== "string" || !item.transform) continue;
      starts.push({ at: joined.length, xPt: item.transform[4], yPt: item.transform[5] });
      joined += item.str;
    }

    for (const mark of parseAnchorMarks(joined)) {
      // The item the match began in. Linear rather than a binary search: a
      // page holds a few hundred items and this runs once per paper.
      let owner = starts[0];
      for (const s of starts) {
        if (s.at > mark.index) break;
        owner = s;
      }
      if (!owner) continue;
      const k = key(mark.questionNumber, mark.partLabel);
      const list = hits.get(k) ?? [];
      list.push({
        corner: mark.corner,
        pageIndex: pageNo - 1,
        xPt: owner.xPt,
        // pdfjs measures from the bottom; anchors are stored from the top.
        yTopPt: viewport.height - owner.yPt,
      });
      hits.set(k, list);
    }
  }

  const anchors: DerivedAnchor[] = [];
  const warnings: string[] = [];

  for (const [k, marks] of hits) {
    const [questionNumber, partLabel] = [Number(k.split("|")[0]), k.split("|")[1]];
    const label = `Q${questionNumber}${partLabel ? `(${partLabel})` : ""}`;
    const a = marks.find((m) => m.corner === "A");
    const z = marks.find((m) => m.corner === "Z");
    if (!a || !z) {
      warnings.push(`${label}: only the ${a ? "top" : "bottom"} of its answer box was found, so it has no region.`);
      continue;
    }
    if (a.pageIndex !== z.pageIndex) {
      // Chromium is told not to break an answer box (break-inside: avoid), so
      // this means the box was taller than a page and got split anyway. One
      // anchor cannot describe two pages, and half a region is worse than
      // none: the part falls back to the marker's own box.
      warnings.push(`${label}: its answer box is split across pages ${a.pageIndex + 1} and ${z.pageIndex + 1}, so it has no region.`);
      continue;
    }
    const size = pageSizes[a.pageIndex];
    // The left mark sits at the box's left edge. The right mark's x is where
    // its own text STARTS, so it under-reads the right edge; the box spans the
    // content width, whose right margin mirrors the left. Growth to the right
    // is capped at the page by computeExpansionCaps either way.
    const x0Pt = Math.min(a.xPt, z.xPt);
    const x1Pt = Math.max(z.xPt, size ? size.widthPt - x0Pt : z.xPt);
    const y0Pt = Math.min(a.yTopPt, z.yTopPt);
    const y1Pt = Math.max(a.yTopPt, z.yTopPt);
    if (!(x1Pt > x0Pt) || !(y1Pt > y0Pt)) {
      // test_item_anchors has a CHECK for this; refuse it here with a name
      // attached rather than letting the insert fail anonymously.
      warnings.push(`${label}: its marks give an empty region, so it was skipped.`);
      continue;
    }
    anchors.push({
      questionNumber,
      partLabel: partLabel === "" ? null : partLabel,
      pageIndex: a.pageIndex,
      x0Pt,
      y0Pt,
      x1Pt,
      y1Pt,
    });
  }

  // Reading order, so expansion caps find the nearest region BELOW each one
  // and sort_order matches the paper.
  anchors.sort((p, q) =>
    p.pageIndex !== q.pageIndex ? p.pageIndex - q.pageIndex : p.y0Pt - q.y0Pt || p.x0Pt - q.x0Pt
  );

  return { anchors, pageSizes, pageCount: doc.numPages, warnings };
}
