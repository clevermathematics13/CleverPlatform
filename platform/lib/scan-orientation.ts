/**
 * scan-orientation.ts -- turn an upside-down scanned page the right way up
 * before it is marked.
 * -----------------------------------------------------------------------------
 * A duplex scanner that feeds the sheet back through for its reverse side
 * delivers every even page rotated 180 degrees, with the rotation baked into
 * the pixels and no /Rotate entry to say so. Until now nothing in the
 * grading path noticed: the marker read the inverted page and returned a
 * confabulated reading of it (measured 14 Sep 2026, see docs/HANDOFF.md), and
 * every evidence crop cut from that page came out upside down in the review
 * panel. Key Assessment 1's second batch (13 students, 16 Sep 2026) arrived
 * exactly like that, and the teacher's only remedy was Acrobat's Rotate
 * Pages / Even Pages Only / 180 before upload, which the first batch had and
 * the second had not.
 *
 * WHAT THIS DOES. One cheap call (Haiku, the same model the segmenter uses
 * for its cover-page check) reads the whole student scan and says, page by
 * page, whether the PRINTED text is upright. Any page it reports upside down
 * gets a /Rotate 180 written on it with pdf-lib -- the same thing Acrobat
 * writes -- and the corrected PDF replaces the stored one at the same path.
 * Nothing downstream needs to know: the Anthropic document block, PyMuPDF's
 * page render behind the CV crop service, and the browser all honour
 * /Rotate, and 180 degrees keeps width and height, so no stored geometry
 * (anchors, evidence boxes, page sizes) changes. Verified on the first batch,
 * which carries exactly that flag from Acrobat: the check reads those pages
 * as upright, so a scan that was already fixed is left alone.
 *
 * WHY THE MODEL AND NOT THE PIXELS. There is no reference to correlate
 * against -- a test need not have a locked paper layout or a master PDF (Key
 * Assessment 1 has neither), and a reference-free rule on ink distribution
 * is exactly the kind of heuristic that fails silently on a page of
 * handwriting. Reading which way the question stems face is a trivial visual
 * task, and one call per scan costs about 13k input tokens at Haiku prices.
 *
 * WHY IT NEVER THROWS. Orientation is a correction on the way to marking,
 * not a precondition for it: if the check fails, or answers for the wrong
 * number of pages, the scan is graded as it is, which is what happened
 * before this module existed. The failure is reported in the return value so
 * a sender can log it, never raised.
 * -----------------------------------------------------------------------------
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument, degrees } from "pdf-lib";
import { z } from "zod";
import { extractJsonBlock } from "./ai-grading";
import { recordUsage, type UsageRefType } from "./ai-usage";
import { COVER_PAGE_CHECK_MODEL } from "./na-scanning";

/**
 * Haiku, for the same reason the cover-page check uses it: "which way up is
 * the printed text on each page" is a simple visual read, and this runs once
 * for every scan that is marked.
 */
export const ORIENTATION_CHECK_MODEL = COVER_PAGE_CHECK_MODEL;

/**
 * The Anthropic document block takes at most this many pages in one request.
 * A student scan is 8-12 pages; anything past this is not a booklet this
 * check should be looking at, and is left as it is.
 */
export const ORIENTATION_CHECK_MAX_PAGES = 100;

export const OrientationCheckSchema = z.object({
  pages: z.array(
    z.object({
      /** 1-indexed, as the model counts them. */
      page: z.number().int().min(1),
      upsideDown: z.boolean(),
    })
  ),
});

export type OrientationCheck = z.infer<typeof OrientationCheckSchema>;

export const ORIENTATION_CHECK_SYSTEM_PROMPT = `You are checking the page orientation of a scanned exam booklet before it is marked. Duplex scanners often deliver every second page rotated 180 degrees, so some pages may be upside down while the rest are upright.

For EVERY page of the document, in order, decide whether the page's PRINTED text (question stems, headers, footers, page numbers) reads normally (upright) or is rotated 180 degrees (upside down). Judge by the printed text, not the handwriting. A blank page is upright.

Return ONLY a JSON object, no markdown fences, no commentary, of the form
{ "pages": [ { "page": 1, "upsideDown": false }, { "page": 2, "upsideDown": true } ] }
with exactly one entry per page of the document, in page order.`;

export function buildOrientationCheckUserPrompt(pageCount: number): string {
  return `This document has ${pageCount} page${pageCount === 1 ? "" : "s"}. Return the JSON object now.`;
}

/**
 * Validate a raw orientation-check response against the scan it was asked
 * about. The answer is trusted only when it names every page exactly once,
 * in order: a list that is short, long, or out of sequence is a model that
 * lost count, and rotating pages on its say-so would be worse than leaving
 * them. Returns the 0-INDEXED pages to rotate.
 */
export function validateOrientationCheck(
  rawText: string,
  pageCount: number
): { ok: true; invertedPageIndexes: number[] } | { ok: false; error: string } {
  const json = extractJsonBlock(rawText);
  if (!json) return { ok: false, error: "No JSON object found in the orientation response" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: "Orientation response was not valid JSON" };
  }

  const result = OrientationCheckSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: `Orientation response did not match the schema: ${result.error.message}` };
  }

  const { pages } = result.data;
  if (pages.length !== pageCount) {
    return {
      ok: false,
      error: `Orientation response covered ${pages.length} page(s) of a ${pageCount}-page scan`,
    };
  }
  for (let i = 0; i < pages.length; i++) {
    if (pages[i].page !== i + 1) {
      return { ok: false, error: `Orientation response listed page ${pages[i].page} in position ${i + 1}` };
    }
  }

  return {
    ok: true,
    invertedPageIndexes: pages.filter((p) => p.upsideDown).map((p) => p.page - 1),
  };
}

/**
 * Write a /Rotate 180 onto each listed page (0-indexed), on top of whatever
 * rotation the page already carries, so a page that is upside down BECAUSE
 * of a stray /Rotate 180 is corrected too. Pages not listed are untouched.
 * With nothing to rotate the input bytes are returned as they are, so a
 * scan that needs no correction is not re-serialised (and not re-uploaded).
 */
export async function rotatePagesUpright(
  pdfBytes: Uint8Array,
  invertedPageIndexes: readonly number[]
): Promise<Uint8Array> {
  if (invertedPageIndexes.length === 0) return pdfBytes;
  const doc = await PDFDocument.load(pdfBytes);
  const pages = doc.getPages();
  for (const index of invertedPageIndexes) {
    const page = pages[index];
    if (!page) continue;
    page.setRotation(degrees((page.getRotation().angle + 180) % 360));
  }
  return doc.save();
}

export type UprightScanResult = {
  /** The scan to mark: corrected when pages were rotated, otherwise the input. */
  buffer: Buffer;
  base64: string;
  /** 1-indexed pages that were rotated; empty when the scan was already upright. */
  rotatedPages: number[];
  /** Why the check was skipped or not believed, when it was. The scan is graded as it is. */
  warning?: string;
};

/**
 * Check a student scan's page orientation and, where pages are upside down,
 * rotate them and replace the stored scan so every later reader (the crop
 * service, the full-page view behind "Locate on page") sees it upright too.
 *
 * Never throws. Any failure leaves the scan as it was and says so in
 * `warning`, because grading an inverted page is the status quo this
 * improves on, not a reason to refuse to grade.
 */
export async function uprightScan(args: {
  anthropic: Anthropic;
  supabase: SupabaseClient;
  bucket: string;
  storagePath: string;
  buffer: Buffer;
  usageRef?: { type: UsageRefType; id: string };
}): Promise<UprightScanResult> {
  const { anthropic, supabase, bucket, storagePath, buffer, usageRef } = args;
  const asIs = (warning?: string): UprightScanResult => ({
    buffer,
    base64: buffer.toString("base64"),
    rotatedPages: [],
    ...(warning ? { warning } : {}),
  });

  let pageCount: number;
  try {
    pageCount = (await PDFDocument.load(buffer)).getPageCount();
  } catch (e) {
    return asIs(`Orientation check skipped: could not read the PDF (${e instanceof Error ? e.message : String(e)})`);
  }
  if (pageCount === 0) return asIs("Orientation check skipped: the scan has no pages");
  if (pageCount > ORIENTATION_CHECK_MAX_PAGES) {
    return asIs(`Orientation check skipped: ${pageCount} pages is more than one request can read`);
  }

  let text: string;
  try {
    const message = await anthropic.messages.create({
      model: ORIENTATION_CHECK_MODEL,
      max_tokens: 2048,
      temperature: 0,
      system: ORIENTATION_CHECK_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") },
            },
            { type: "text", text: buildOrientationCheckUserPrompt(pageCount) },
          ],
        },
      ],
    });
    await recordUsage(supabase, {
      pipeline: "ai_grade_orientation",
      model: ORIENTATION_CHECK_MODEL,
      usage: message.usage,
      ...(usageRef ? { ref: usageRef } : {}),
    });
    text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
  } catch (e) {
    return asIs(`Orientation check failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  const validated = validateOrientationCheck(text, pageCount);
  if (!validated.ok) return asIs(validated.error);
  if (validated.invertedPageIndexes.length === 0) return asIs();

  let rotated: Uint8Array;
  try {
    rotated = await rotatePagesUpright(buffer, validated.invertedPageIndexes);
  } catch (e) {
    return asIs(`Could not rotate pages: ${e instanceof Error ? e.message : String(e)}`);
  }
  const corrected = Buffer.from(rotated);

  // Replace the stored scan so the crop service and the full-page view read
  // the same upright pages the marker did. A failed replace still grades
  // from the corrected bytes: the marks and crops of THIS run are right, and
  // only a later re-read of the stored file would see the old orientation --
  // and that re-read runs this check again.
  const { error: uploadErr } = await supabase.storage
    .from(bucket)
    .upload(storagePath, corrected, { contentType: "application/pdf", upsert: true });

  const rotatedPages = validated.invertedPageIndexes.map((i) => i + 1);
  return {
    buffer: corrected,
    base64: corrected.toString("base64"),
    rotatedPages,
    ...(uploadErr
      ? { warning: `Rotated page(s) ${rotatedPages.join(", ")} for marking, but could not replace the stored scan: ${uploadErr.message}` }
      : {}),
  };
}
