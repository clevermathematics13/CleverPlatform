import { MAX_BATCH_PAGES, MAX_SCAN_BYTES } from "./ai-grading";

/**
 * Splitting an oversized batch scan into chunks the segmentation model can
 * actually be sent.
 *
 * The formative-assessment batch route hands the WHOLE batch PDF to the
 * segmentation model in one call (a student's work can spill onto loose
 * sheets anywhere in the document, so unlike the NA pipeline there is no
 * fixed packet length to walk). That single call is bounded by two hard
 * Anthropic limits: 100 pages per PDF document block (MAX_BATCH_PAGES) and
 * 32MB per request (MAX_SCAN_BYTES). A full class of a 10-page formative
 * assessment breaks the first one easily.
 *
 * This module plans how to cut such an upload into chunks, each of which
 * becomes an ordinary batch (segmented, reviewed, split and graded exactly
 * like a small upload). The one thing worth being careful about is WHERE
 * to cut: a cut in the middle of a student's script leaves half of it in
 * each chunk, and the model in the second chunk has no cover page to
 * attribute the orphaned pages to. So each hard boundary is pulled back to
 * the nearest cover page before it, found by asking a cheap single-page
 * model check ("is this page a cover page?") for the pages just before the
 * boundary. The caller supplies that check; this module is pure and
 * testable with a fake.
 *
 * Nothing here touches a PDF or the database -- it only decides page
 * ranges. The route does the pdf-lib copying and storage uploads.
 */

export interface BatchChunk {
  /** 0-based position of this chunk within the upload. */
  index: number;
  /** 1-indexed first page of the chunk in the SOURCE document. */
  firstPage: number;
  /** 1-indexed last page of the chunk in the SOURCE document, inclusive. */
  lastPage: number;
  /** Convenience: lastPage - firstPage + 1. */
  pageCount: number;
  /**
   * Whether the chunk AFTER this one starts on a confirmed cover page, so
   * no student's script straddles the cut. Always true for the final
   * chunk (there is no cut after it).
   */
  cleanCutAfter: boolean;
}

export interface ChunkPlan {
  chunks: BatchChunk[];
  warnings: string[];
  /** How many single-page cover checks were made -- the cost driver. */
  pagesChecked: number;
}

export interface ChunkLimits {
  maxPages?: number;
  maxBytes?: number;
}

/**
 * Whether an upload of this size can be sent to the segmentation model in
 * one piece at all.
 */
export function needsChunking(
  pageCount: number,
  byteLength: number,
  { maxPages = MAX_BATCH_PAGES, maxBytes = MAX_SCAN_BYTES }: ChunkLimits = {}
): boolean {
  return pageCount > maxPages || byteLength > maxBytes;
}

/**
 * Fraction of the byte limit a chunk is planned to use. A chunk's real
 * size is not exactly proportional to its page count (pdf-lib carries
 * over every resource a copied page references, and image-heavy pages
 * vary), so plan with headroom rather than right at the ceiling.
 */
export const CHUNK_BYTE_HEADROOM = 0.8;

/**
 * The most pages a single chunk may hold: the document page limit, tightened
 * further when the scan's bytes-per-page would push a full-length chunk past
 * the request size limit.
 */
export function maxPagesPerChunk(
  pageCount: number,
  byteLength: number,
  { maxPages = MAX_BATCH_PAGES, maxBytes = MAX_SCAN_BYTES }: ChunkLimits = {}
): number {
  if (pageCount < 1 || byteLength < 1) return maxPages;
  const bytesPerPage = byteLength / pageCount;
  const byBytes = Math.floor((maxBytes * CHUNK_BYTE_HEADROOM) / bytesPerPage);
  return Math.max(1, Math.min(maxPages, byBytes));
}

/**
 * How many pages before a hard boundary to look for a cover page. A Grade 9
 * formative assessment runs to roughly 4-12 pages per student, so this
 * comfortably covers one whole script; if no cover page is found within it
 * the cut falls on the hard boundary and is flagged for the teacher.
 */
export const COVER_SEARCH_WINDOW = 24;

/** How many cover checks are in flight at once during a boundary search. */
export const COVER_SEARCH_CONCURRENCY = 4;

export interface PlanBatchChunksOptions extends ChunkLimits {
  pageCount: number;
  byteLength: number;
  /**
   * Whether the given 1-indexed source page is the first page of a
   * student's script. Called only for pages near a planned cut, never for
   * the whole document. May be called concurrently.
   */
  isCoverPage: (page: number) => Promise<boolean>;
  searchWindow?: number;
  concurrency?: number;
}

/**
 * Plan the chunks for an oversized upload.
 *
 * Walks forward from page 1. Each chunk is allowed at most maxPagesPerChunk
 * pages; the page after that allowance is the "hard" boundary. Starting
 * from that boundary page and working backwards (highest page first, in
 * small parallel groups), the first page confirmed as a cover page becomes
 * the start of the next chunk, so the current chunk ends on the page before
 * it. If nothing within the search window is a cover page, the chunk is
 * cut at the hard boundary anyway and a warning names the two chunks that
 * may share a student's script -- the teacher confirms every mapping in the
 * review UI regardless, so a bad cut is visible rather than silent.
 *
 * Every page 1..pageCount lands in exactly one chunk, in order.
 */
export async function planBatchChunks(options: PlanBatchChunksOptions): Promise<ChunkPlan> {
  const {
    pageCount,
    byteLength,
    isCoverPage,
    searchWindow = COVER_SEARCH_WINDOW,
    concurrency = COVER_SEARCH_CONCURRENCY,
  } = options;

  if (pageCount < 1) return { chunks: [], warnings: ["Empty document."], pagesChecked: 0 };

  const maxChunkPages = maxPagesPerChunk(pageCount, byteLength, options);
  const warnings: string[] = [];
  let pagesChecked = 0;

  // A page is never checked twice, even when two boundary searches overlap
  // (possible when the window is wider than a chunk's page allowance).
  const verdicts = new Map<number, boolean>();
  const check = async (page: number): Promise<boolean> => {
    const cached = verdicts.get(page);
    if (cached !== undefined) return cached;
    pagesChecked++;
    let verdict = false;
    try {
      verdict = await isCoverPage(page);
    } catch {
      // A failed check reads as "not a cover page" -- the search keeps
      // going and at worst falls back to the hard boundary with a warning,
      // which beats aborting the whole upload over one bad request.
      verdict = false;
    }
    verdicts.set(page, verdict);
    return verdict;
  };

  /**
   * Highest page in [lowest, highest] that is a cover page, or null.
   * Checks descend from `highest` in parallel groups of `concurrency`;
   * within a group the highest confirmed cover wins, so the cut stays as
   * close to the hard boundary as possible (fewer, fuller chunks).
   */
  const findCoverPageAtOrBelow = async (highest: number, lowest: number): Promise<number | null> => {
    for (let top = highest; top >= lowest; top -= concurrency) {
      const group: number[] = [];
      for (let p = top; p > top - concurrency && p >= lowest; p--) group.push(p);
      const results = await Promise.all(group.map((p) => check(p).then((v) => [p, v] as const)));
      const hit = results.find(([, v]) => v);
      if (hit) return hit[0];
    }
    return null;
  };

  const chunks: BatchChunk[] = [];
  let start = 1;
  while (start <= pageCount) {
    const hardEnd = Math.min(pageCount, start + maxChunkPages - 1);
    if (hardEnd === pageCount) {
      chunks.push({
        index: chunks.length,
        firstPage: start,
        lastPage: pageCount,
        pageCount: pageCount - start + 1,
        cleanCutAfter: true,
      });
      break;
    }

    // The next chunk must start somewhere in (start, hardEnd + 1]: the page
    // right after the allowance is the ideal cut, and we look back from it.
    // It can never be `start` itself -- that would make this chunk empty.
    const hardNext = hardEnd + 1;
    const lowest = Math.max(start + 1, hardNext - searchWindow);
    const cover = await findCoverPageAtOrBelow(hardNext, lowest);

    const nextStart = cover ?? hardNext;
    const clean = cover !== null;
    if (!clean) {
      warnings.push(
        `No cover page was found in the ${hardNext - lowest + 1} pages before page ${hardNext}, so the scan was cut there. ` +
          `A student's script may be split across parts ${chunks.length + 1} and ${chunks.length + 2} -- check the last student of part ${chunks.length + 1} and the first pages of part ${chunks.length + 2}.`
      );
    }
    chunks.push({
      index: chunks.length,
      firstPage: start,
      lastPage: nextStart - 1,
      pageCount: nextStart - start,
      cleanCutAfter: clean,
    });
    start = nextStart;
  }

  return { chunks, warnings, pagesChecked };
}

/**
 * The file name a chunk is stored and listed under, e.g.
 * "class-scan.pdf (part 2 of 3, pages 98-190)". Page numbers are those of
 * the ORIGINAL upload, so a teacher can find the pages in their scanner's
 * output if a boundary needs checking.
 */
export function chunkFileName(originalFileName: string, chunk: BatchChunk, chunkCount: number): string {
  return `${originalFileName} (part ${chunk.index + 1} of ${chunkCount}, pages ${chunk.firstPage}-${chunk.lastPage})`;
}
