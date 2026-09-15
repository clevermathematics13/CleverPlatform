import { describe, expect, it } from "vitest";
import { PDFDocument, degrees } from "pdf-lib";
import {
  PAGE_ORIENTATION_MODEL,
  collectInvertedPages,
  correctPageOrientation,
  validatePageOrientation,
  type PageOrientation,
} from "./page-orientation";
import { COVER_PAGE_CHECK_MODEL } from "./na-scanning";

/**
 * What these pin: an upside-down scan is a SILENT failure -- the model graded
 * Block A's inverted pages at 77.9% high confidence without flagging anything
 * -- so the safety here cannot come from noticing at runtime. It has to come
 * from the decision rule (only high-confidence inversions are rotated) and
 * from the rotation itself being exactly what it claims (content moved, no
 * /Rotate left behind for a downstream coordinate calculation to trip over).
 */

/**
 * A PDF with `n` pages of distinct sizes, so page identity survives
 * assertions. Each page is drawn on: a page with no content stream cannot be
 * embedded at all, which is its own case below.
 */
async function makePdf(n: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) {
    const page = doc.addPage([300 + i, 400 + i]);
    page.drawRectangle({ x: 10, y: 10, width: 40 + i, height: 20 });
  }
  return Buffer.from(await doc.save());
}

const verdict = (upsideDown: boolean, confidence: PageOrientation["confidence"]): PageOrientation => ({
  upsideDown,
  confidence,
  note: "",
});

describe("collectInvertedPages", () => {
  it("collects only high-confidence inversions", () => {
    const scan = collectInvertedPages([
      verdict(true, "high"), // 0 -> rotate
      verdict(false, "high"), // 1
      verdict(true, "medium"), // 2 -> too uncertain
      verdict(true, "low"), // 3 -> too uncertain
      verdict(true, "high"), // 4 -> rotate
    ]);
    expect(scan.invertedPages).toEqual([0, 4]);
  });

  it("rotates nothing on a clean scan", () => {
    const scan = collectInvertedPages([verdict(false, "high"), verdict(false, "low")]);
    expect(scan.invertedPages).toEqual([]);
  });

  // Rotating an upright page is the worse error of the two: an inverted page
  // is visibly wrong in the crop a teacher reviews, a wrongly-rotated one
  // turns good evidence into bad and looks like the very defect it fixed.
  it("never rotates on a medium-confidence guess alone", () => {
    expect(collectInvertedPages([verdict(true, "medium")]).invertedPages).toEqual([]);
  });

  it("keeps every verdict for the audit trail, not just the rotated ones", () => {
    const perPage = [verdict(true, "high"), verdict(false, "low")];
    expect(collectInvertedPages(perPage).perPage).toEqual(perPage);
  });
});

describe("correctPageOrientation", () => {
  it("returns the bytes untouched when there is nothing to rotate", async () => {
    const original = await makePdf(3);
    const out = await correctPageOrientation(original, []);
    expect(out.equals(original)).toBe(true);
  });

  it("preserves page count and every page's size", async () => {
    const out = await correctPageOrientation(await makePdf(4), [1, 3]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(4);
    doc.getPages().forEach((p, i) => {
      expect(Math.round(p.getSize().width)).toBe(300 + i);
      expect(Math.round(p.getSize().height)).toBe(400 + i);
    });
  });

  // The reason this module redraws content instead of calling setRotation:
  // the next readers do coordinate maths, and cv_crop_extract.py records two
  // real bugs from rotation living in metadata. A corrected page must look
  // like a page that was simply scanned the right way up.
  it("leaves no /Rotate behind for downstream coordinate maths to trip over", async () => {
    const out = await correctPageOrientation(await makePdf(3), [0, 2]);
    const doc = await PDFDocument.load(out);
    for (const page of doc.getPages()) {
      expect(page.getRotation().angle % 360).toBe(0);
    }
  });

  it("strips a /Rotate that was already on the source page", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 400]);
    page.drawRectangle({ x: 10, y: 10, width: 40, height: 20 });
    page.setRotation(degrees(180));
    const out = await correctPageOrientation(Buffer.from(await doc.save()), [0]);
    const reloaded = await PDFDocument.load(out);
    expect(reloaded.getPages()[0].getRotation().angle % 360).toBe(0);
  });

  // A blank back side is ordinary in a duplex scan. It cannot be embedded
  // (no content stream) and has no ink to be upside down, but dropping or
  // resizing it would shift every later crop, since the crop stage maps scan
  // page N onto master page N-1 by position.
  it("carries a contentless page through at the same size instead of failing", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 400]).drawRectangle({ x: 5, y: 5, width: 10, height: 10 });
    doc.addPage([321, 456]); // no content stream at all
    doc.addPage([300, 400]).drawRectangle({ x: 5, y: 5, width: 10, height: 10 });

    const out = await correctPageOrientation(Buffer.from(await doc.save()), [0, 1, 2]);
    const reloaded = await PDFDocument.load(out);
    expect(reloaded.getPageCount()).toBe(3);
    expect(Math.round(reloaded.getPages()[1].getSize().width)).toBe(321);
    expect(Math.round(reloaded.getPages()[1].getSize().height)).toBe(456);
  });

  it("rejects a page index the document does not have, rather than silently skipping", async () => {
    await expect(correctPageOrientation(await makePdf(2), [5])).rejects.toThrow(/has 2 pages/);
    await expect(correctPageOrientation(await makePdf(2), [-1])).rejects.toThrow(/Cannot rotate page index/);
  });

  it("is idempotent in shape: rotating twice returns to a readable document", async () => {
    const once = await correctPageOrientation(await makePdf(2), [0]);
    const twice = await correctPageOrientation(once, [0]);
    const doc = await PDFDocument.load(twice);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPages()[0].getRotation().angle % 360).toBe(0);
  });
});

describe("validatePageOrientation", () => {
  it("accepts a well-formed verdict", () => {
    const r = validatePageOrientation('{"upsideDown":true,"confidence":"high","note":"header at bottom"}');
    expect(r).toEqual({
      ok: true,
      result: { upsideDown: true, confidence: "high", note: "header at bottom" },
    });
  });

  it("accepts a verdict wrapped in prose or fences", () => {
    const r = validatePageOrientation('Here you go:\n```json\n{"upsideDown":false,"confidence":"low"}\n```');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result).toEqual({ upsideDown: false, confidence: "low", note: "" });
  });

  it("rejects a missing verdict rather than defaulting it", () => {
    const r = validatePageOrientation('{"confidence":"high"}');
    expect(r.ok).toBe(false);
  });

  it("rejects an unknown confidence level", () => {
    expect(validatePageOrientation('{"upsideDown":true,"confidence":"certain"}').ok).toBe(false);
  });

  it("reports no-JSON and bad-JSON distinctly", () => {
    expect(validatePageOrientation("it looks fine to me")).toEqual({
      ok: false,
      error: "No JSON object found in page-orientation response",
    });
    const bad = validatePageOrientation("{ upsideDown: tru");
    expect(bad.ok).toBe(false);
  });
});

describe("model choice", () => {
  // Shared so the two per-page checks can never drift onto different models.
  it("uses the same Haiku as the cover-page check", () => {
    expect(PAGE_ORIENTATION_MODEL).toBe(COVER_PAGE_CHECK_MODEL);
  });
});
