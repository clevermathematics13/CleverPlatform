/**
 * Detecting and correcting upside-down scan pages.
 *
 * Why this exists: on 14 Sep 2026 Block A's Key Assessment 1 was marked from a
 * scan in which every EVEN page was rotated 180 degrees -- the ordinary
 * duplex-ADF artifact, where the reverse side of each sheet comes out
 * inverted. 271 of the 504 graded parts took their evidence from one of those
 * pages, and roughly half the evidence crops a teacher would have reviewed
 * were upside down.
 *
 * The part that makes this worth code rather than care: the model did not
 * notice. On the inverted pages it reported 0% "no work found" and 77.9% high
 * confidence, against 1% and 89.1% on the upright ones. It read them, or
 * believed it had, and nothing in the output said otherwise. An upside-down
 * scan is therefore not a loud failure that a teacher will catch -- it is a
 * quiet one that produces confident marks off pages nobody could read.
 *
 * scripts/cv_crop_extract.py already anticipated this in its header: pages
 * reaching the crop stage "are assumed right-side-up", with a rotation_hint
 * that "lets a caller override this per page if a future batch turns out to
 * need it; default is 0". Nothing ever set it. This module is what sets it.
 */

import { PDFDocument, degrees } from "pdf-lib";
import { z } from "zod";
import { extractJsonBlock } from "./ai-grading";
import { COVER_PAGE_CHECK_MODEL } from "./na-scanning";

/**
 * Same Haiku the cover-page check uses, for the same reason: this is a simple
 * visual question asked once per page, so the model choice dominates what the
 * whole orientation pass costs. Re-exported rather than redeclared so the two
 * per-page checks can never drift onto different models.
 */
export const PAGE_ORIENTATION_MODEL = COVER_PAGE_CHECK_MODEL;

export const PageOrientationSchema = z.object({
  /** True only for a page rotated ~180 degrees. Sideways is not this. */
  upsideDown: z.boolean(),
  confidence: z.enum(["high", "medium", "low"]),
  /** Brief justification, e.g. "printed header runs along the bottom, inverted". */
  note: z.string().default(""),
});

export type PageOrientation = z.infer<typeof PageOrientationSchema>;

export const PAGE_ORIENTATION_SYSTEM_PROMPT = `You are looking at a single page from a scanned batch of student worksheets. Decide whether this page is rotated 180 degrees (upside down).

An upright page reads normally: printed headings sit at the top, text runs left to right, handwriting sits on the ruled lines the right way up.

An upside-down page is one you would have to turn the paper around to read: the printed header appears at the BOTTOM of the image, the text is inverted, and handwriting reads bottom-to-top when scanned in a duplex feeder.

Judge this from the PRINTED text and layout first -- printed headers, question numbers, and mark boxes have a reliable position and orientation on every page of a worksheet. Handwriting is a weaker signal: students write at odd angles, and a page can be upright while a student's answer is slanted or squeezed in sideways.

Two things that are NOT "upside down", and must return false:
- A page rotated 90 degrees (sideways/landscape). That is a different defect; answer false and say so in the note.
- A page that is simply blank, faint, or sparse. With no printed anchor visible, answer false with low confidence rather than guessing.

Return ONLY a JSON object, no markdown fences, no commentary:

{ "upsideDown": true, "confidence": "high", "note": "printed 'LEVEL 2 -- TRANSLATE AND INTERPRET' heading sits along the bottom edge, inverted" }`;

export function buildPageOrientationUserPrompt(pageNumber: number, pageCount: number): string {
  return `This is page ${pageNumber} of ${pageCount} from one student's scanned packet. Is it rotated 180 degrees (upside down)?\n\nReturn the JSON object now.`;
}

/** Validate a raw page-orientation response. */
export function validatePageOrientation(
  rawText: string
): { ok: true; result: PageOrientation } | { ok: false; error: string } {
  const json = extractJsonBlock(rawText);
  if (!json) return { ok: false, error: "No JSON object found in page-orientation response" };
  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(json);
  } catch (e) {
    return {
      ok: false,
      error: `Page-orientation response was not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  const parsed = PageOrientationSchema.safeParse(parsedUnknown);
  if (!parsed.success) {
    return {
      ok: false,
      error: `Page-orientation response failed schema validation: ${parsed.error.message}`,
    };
  }
  return { ok: true, result: parsed.data };
}

export interface OrientationScan {
  /** 0-based indices of pages judged upside down and worth correcting. */
  invertedPages: number[];
  /** Every page's verdict, in page order, for reporting and for the audit trail. */
  perPage: PageOrientation[];
}

/**
 * Ask `checkPage` about every page and collect the ones to rotate.
 *
 * Injectable in the same shape as scanCoverPages: the caller owns the model
 * call (and therefore the PDF slicing, the API key and the usage logging),
 * this owns the decision rule. That rule is deliberately conservative --
 * only a `high`-confidence `upsideDown` counts.
 *
 * Rotating a page that was actually upright is worse than leaving one
 * inverted: an inverted page is at least visibly wrong to the teacher
 * reviewing the crop, whereas a wrongly-rotated upright page turns good
 * evidence into bad and looks exactly like the defect it was supposed to fix.
 * A medium-confidence guess is not enough to earn that risk.
 */
export function collectInvertedPages(perPage: PageOrientation[]): OrientationScan {
  const invertedPages: number[] = [];
  perPage.forEach((verdict, i) => {
    if (verdict.upsideDown && verdict.confidence === "high") invertedPages.push(i);
  });
  return { invertedPages, perPage };
}

/**
 * Return a copy of `pdfBytes` with the named pages turned the right way up.
 *
 * Rotates the page CONTENT rather than setting the /Rotate entry, and that is
 * the whole point. /Rotate is a instruction to the renderer, and this
 * document's next readers are a model and a CV service doing coordinate maths
 * on the result -- exactly the ground on which this repo has already lost a
 * fight: cv_crop_extract.py records the pilot's two real bugs as "expansion
 * math done in raw rotated-scan pixel space silently inverting right/down,
 * and a duplicate rotation call". Redrawing the content leaves a document with
 * no rotation metadata to interpret and pixels that are simply upright, which
 * is indistinguishable from a scan that was fed in correctly.
 *
 * Page objects are embedded, not re-rasterised, so this costs no image quality
 * and barely any bytes.
 */
export async function correctPageOrientation(
  pdfBytes: Buffer | Uint8Array,
  invertedPages: number[]
): Promise<Buffer> {
  const inverted = new Set(invertedPages);
  const src = await PDFDocument.load(pdfBytes, { updateMetadata: false });

  // Nothing to do: hand back the bytes untouched rather than rebuilding the
  // document for no reason, so a clean scan is never rewritten.
  if (inverted.size === 0) return Buffer.from(pdfBytes);

  const pages = src.getPages();
  for (const i of inverted) {
    if (i < 0 || i >= pages.length || !Number.isInteger(i)) {
      throw new Error(
        `Cannot rotate page index ${i}: this PDF has ${pages.length} pages (0-based indices 0..${pages.length - 1})`
      );
    }
  }

  // A page with no content stream cannot be embedded -- pdf-lib throws
  // "Can't embed page with missing Contents" -- and one such page would
  // otherwise fail the whole student's repair. It is also nothing worth
  // rotating: there is no ink on it to be the wrong way up. Carried through
  // as a blank page of the same size, so page COUNT and page SIZE survive;
  // the crop stage maps scan page N onto master page N-1 positionally, and
  // dropping or resizing a page would silently shift every crop after it.
  const out = await PDFDocument.create();
  const embeddable = pages.filter((p) => p.node.Contents() !== undefined);
  const embedded = await out.embedPages(embeddable);

  let nextEmbedded = 0;
  pages.forEach((page, i) => {
    const { width, height } = page.getSize();
    const target = out.addPage([width, height]);
    if (page.node.Contents() === undefined) return; // blank: nothing to draw
    const source = embedded[nextEmbedded++];
    if (inverted.has(i)) {
      // Origin moves to the far corner because the rotation is about (x, y).
      target.drawPage(source, { x: width, y: height, width, height, rotate: degrees(180) });
    } else {
      target.drawPage(source, { x: 0, y: 0, width, height });
    }
  });

  return Buffer.from(await out.save());
}
