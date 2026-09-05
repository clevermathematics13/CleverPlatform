/**
 * Decisions behind POST .../ai-grade/batch/[batchId]/split, kept pure so
 * they can be unit-tested without a PDF or a database.
 */

/**
 * Whether a segment can be served by copying the batch's source PDF as-is
 * in Storage, instead of downloading it, rebuilding a new PDF from the
 * chosen pages with pdf-lib, and uploading the result.
 *
 * True when the segment claims every page of the source except pages the
 * segmentation pass confirmed blank. That is exactly the shape of a part
 * cut from an oversized upload (lib/batch-chunking.ts): the cutter lands
 * each part on a cover page, so a part is usually one student's whole
 * booklet plus its unused back page. Sending that blank page along with
 * the script changes nothing for marking, and skipping the rebuild means
 * the split costs one Storage-side copy rather than shuttling 12-18MB in
 * and out of a serverless function -- which is what made a class-sized
 * upload, with every part splitting at once, run past the function's
 * time limit.
 */
export function canCopySourceWhole(
  segmentPages: number[],
  pageCount: number,
  blankPages: number[]
): boolean {
  if (pageCount < 1) return false;
  const claimed = new Set(segmentPages);
  const blank = new Set(blankPages);
  for (let page = 1; page <= pageCount; page++) {
    if (!claimed.has(page) && !blank.has(page)) return false;
  }
  return true;
}
