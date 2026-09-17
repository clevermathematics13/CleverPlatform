import { describe, expect, it } from "vitest";
import { PDFDocument, degrees } from "pdf-lib";
import {
  buildOrientationCheckUserPrompt,
  rotatePagesUpright,
  validateOrientationCheck,
} from "./scan-orientation";

const answer = (flags: boolean[]) =>
  JSON.stringify({ pages: flags.map((upsideDown, i) => ({ page: i + 1, upsideDown })) });

describe("validateOrientationCheck", () => {
  // What the check returned for Kaito Fujii's Key Assessment 1 scan on
  // 16 Sep 2026: an 8-page duplex scan with every even page inverted.
  it("returns the inverted pages, 0-indexed, from a well-formed answer", () => {
    const v = validateOrientationCheck(answer([false, true, false, true, false, true, false, true]), 8);
    expect(v).toEqual({ ok: true, invertedPageIndexes: [1, 3, 5, 7] });
  });

  it("returns no pages for an upright scan", () => {
    expect(validateOrientationCheck(answer([false, false, false]), 3)).toEqual({
      ok: true,
      invertedPageIndexes: [],
    });
  });

  it("tolerates a fenced or prefaced answer", () => {
    const fenced = "Here is the result:\n```json\n" + answer([true, false]) + "\n```";
    expect(validateOrientationCheck(fenced, 2)).toEqual({ ok: true, invertedPageIndexes: [0] });
  });

  // A model that lost count of the pages must not be allowed to rotate any.
  it("rejects an answer covering the wrong number of pages", () => {
    expect(validateOrientationCheck(answer([false, true]), 3)).toMatchObject({ ok: false });
    expect(validateOrientationCheck(answer([false, true, false, true]), 3)).toMatchObject({ ok: false });
  });

  it("rejects an answer whose pages are out of sequence", () => {
    const shuffled = JSON.stringify({
      pages: [
        { page: 1, upsideDown: false },
        { page: 3, upsideDown: true },
        { page: 2, upsideDown: false },
      ],
    });
    expect(validateOrientationCheck(shuffled, 3)).toMatchObject({ ok: false });
  });

  it("rejects non-JSON and off-schema answers", () => {
    expect(validateOrientationCheck("all pages look fine", 2)).toMatchObject({ ok: false });
    expect(validateOrientationCheck('{"pages":[{"page":1,"upsideDown":"no"}]}', 1)).toMatchObject({
      ok: false,
    });
  });
});

describe("buildOrientationCheckUserPrompt", () => {
  it("tells the model how many pages to answer for", () => {
    expect(buildOrientationCheckUserPrompt(8)).toContain("8 pages");
    expect(buildOrientationCheckUserPrompt(1)).toContain("1 page.");
  });
});

async function threePagePdf(rotations: number[] = [0, 0, 0]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const r of rotations) {
    const page = doc.addPage([595, 842]);
    page.setRotation(degrees(r));
  }
  return doc.save();
}

async function rotationsOf(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => p.getRotation().angle);
}

describe("rotatePagesUpright", () => {
  it("writes /Rotate 180 on exactly the listed pages", async () => {
    const out = await rotatePagesUpright(await threePagePdf(), [1]);
    expect(await rotationsOf(out)).toEqual([0, 180, 0]);
  });

  it("keeps every page's width and height, so stored geometry still applies", async () => {
    const out = await rotatePagesUpright(await threePagePdf(), [0, 1, 2]);
    const doc = await PDFDocument.load(out);
    for (const page of doc.getPages()) {
      expect([page.getWidth(), page.getHeight()]).toEqual([595, 842]);
    }
  });

  // A page already carrying /Rotate 180 (Acrobat's fix) that the check still
  // reads as inverted is one whose pixels were fine all along: undo the flag.
  it("adds to a rotation the page already carries", async () => {
    const out = await rotatePagesUpright(await threePagePdf([0, 180, 90]), [1, 2]);
    expect(await rotationsOf(out)).toEqual([0, 0, 270]);
  });

  it("returns the input untouched when there is nothing to rotate", async () => {
    const input = await threePagePdf();
    expect(await rotatePagesUpright(input, [])).toBe(input);
  });

  it("ignores an index past the last page", async () => {
    const out = await rotatePagesUpright(await threePagePdf(), [7]);
    expect(await rotationsOf(out)).toEqual([0, 0, 0]);
  });
});
