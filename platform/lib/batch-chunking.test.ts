import { describe, expect, it } from "vitest";
import {
  chunkFileName,
  maxPagesPerChunk,
  needsChunking,
  planBatchChunks,
  type BatchChunk,
} from "./batch-chunking";

/** A fake cover-page check: cover pages at every `every`-th page from 1. */
function coversEvery(every: number) {
  const calls: number[] = [];
  const isCoverPage = async (page: number) => {
    calls.push(page);
    return (page - 1) % every === 0;
  };
  return { isCoverPage, calls };
}

function coverage(chunks: BatchChunk[]): number[] {
  return chunks.flatMap((c) => Array.from({ length: c.pageCount }, (_, i) => c.firstPage + i));
}

describe("needsChunking", () => {
  it("is false at or under both limits", () => {
    expect(needsChunking(100, 1000, { maxPages: 100, maxBytes: 1000 })).toBe(false);
  });
  it("is true past the page limit", () => {
    expect(needsChunking(101, 1000, { maxPages: 100, maxBytes: 1000 })).toBe(true);
  });
  it("is true past the byte limit even with few pages", () => {
    expect(needsChunking(10, 1001, { maxPages: 100, maxBytes: 1000 })).toBe(true);
  });
});

describe("maxPagesPerChunk", () => {
  it("is the page limit when bytes are no constraint", () => {
    expect(maxPagesPerChunk(300, 300, { maxPages: 100, maxBytes: 1_000_000 })).toBe(100);
  });
  it("shrinks below the page limit when a full chunk would exceed the byte limit", () => {
    // 1000 bytes/page, 8000-byte limit at 0.8 headroom -> 6 pages.
    expect(maxPagesPerChunk(300, 300_000, { maxPages: 100, maxBytes: 8000 })).toBe(6);
  });
  it("never drops below one page", () => {
    expect(maxPagesPerChunk(10, 10_000_000, { maxPages: 100, maxBytes: 10 })).toBe(1);
  });
});

describe("planBatchChunks", () => {
  it("cuts on cover pages so no script straddles a chunk", async () => {
    // 30 pages, 8-page scripts starting at 1, 9, 17, 25. Max 12 pages per
    // chunk. Hard boundary after page 12 -> nearest cover at or below 13
    // is 9. Next hard boundary from 9 is after page 20 -> cover at 17.
    // Then 17..28 -> cover at 25. Then 25..30 is the tail.
    const { isCoverPage, calls } = coversEvery(8);
    const plan = await planBatchChunks({
      pageCount: 30,
      byteLength: 30,
      maxPages: 12,
      maxBytes: 1_000_000,
      isCoverPage,
      searchWindow: 6,
      concurrency: 2,
    });
    expect(plan.chunks.map((c) => [c.firstPage, c.lastPage])).toEqual([
      [1, 8],
      [9, 16],
      [17, 24],
      [25, 30],
    ]);
    expect(plan.chunks.every((c) => c.cleanCutAfter)).toBe(true);
    expect(plan.warnings).toEqual([]);
    expect(coverage(plan.chunks)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect(plan.chunks.map((c) => c.index)).toEqual([0, 1, 2, 3]);
    // Only pages near boundaries were checked, never the whole document.
    expect(plan.pagesChecked).toBe(calls.length);
    expect(plan.pagesChecked).toBeLessThan(30);
    expect(Math.max(...calls)).toBeLessThanOrEqual(29);
  });

  it("prefers the cover page closest to the hard boundary", async () => {
    // Cover pages every 2 pages; the boundary page 13 is itself a cover
    // (13 = 1 + 6*2), so the cut lands exactly on the allowance.
    const { isCoverPage } = coversEvery(2);
    const plan = await planBatchChunks({
      pageCount: 20,
      byteLength: 20,
      maxPages: 12,
      maxBytes: 1_000_000,
      isCoverPage,
      searchWindow: 6,
      concurrency: 4,
    });
    expect(plan.chunks.map((c) => [c.firstPage, c.lastPage])).toEqual([
      [1, 12],
      [13, 20],
    ]);
  });

  it("falls back to the hard boundary with a warning when no cover page is nearby", async () => {
    const isCoverPage = async () => false;
    const plan = await planBatchChunks({
      pageCount: 25,
      byteLength: 25,
      maxPages: 10,
      maxBytes: 1_000_000,
      isCoverPage,
      searchWindow: 4,
      concurrency: 2,
    });
    expect(plan.chunks.map((c) => [c.firstPage, c.lastPage])).toEqual([
      [1, 10],
      [11, 20],
      [21, 25],
    ]);
    expect(plan.chunks.map((c) => c.cleanCutAfter)).toEqual([false, false, true]);
    expect(plan.warnings).toHaveLength(2);
    expect(plan.warnings[0]).toContain("parts 1 and 2");
    expect(plan.warnings[1]).toContain("parts 2 and 3");
    expect(coverage(plan.chunks)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  it("treats a failed check as not-a-cover rather than aborting", async () => {
    const isCoverPage = async (page: number) => {
      if (page === 11) throw new Error("model down");
      return page === 9;
    };
    const plan = await planBatchChunks({
      pageCount: 15,
      byteLength: 15,
      maxPages: 10,
      maxBytes: 1_000_000,
      isCoverPage,
      searchWindow: 4,
      concurrency: 1,
    });
    expect(plan.chunks.map((c) => [c.firstPage, c.lastPage])).toEqual([
      [1, 8],
      [9, 15],
    ]);
    expect(plan.warnings).toEqual([]);
  });

  it("never checks the same page twice across overlapping searches", async () => {
    const { isCoverPage, calls } = coversEvery(50); // only page 1 is a cover
    const plan = await planBatchChunks({
      pageCount: 12,
      byteLength: 12,
      maxPages: 3,
      maxBytes: 1_000_000,
      isCoverPage,
      searchWindow: 10, // wider than the chunk allowance
      concurrency: 3,
    });
    expect(new Set(calls).size).toBe(calls.length);
    expect(plan.pagesChecked).toBe(calls.length);
    expect(coverage(plan.chunks)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    // A chunk can never start on its own first page, so every chunk is non-empty.
    expect(plan.chunks.every((c) => c.pageCount >= 1)).toBe(true);
  });

  it("returns a single chunk when everything already fits", async () => {
    const plan = await planBatchChunks({
      pageCount: 40,
      byteLength: 40,
      maxPages: 100,
      maxBytes: 1_000_000,
      isCoverPage: async () => {
        throw new Error("should not be called");
      },
    });
    expect(plan.chunks).toEqual([
      { index: 0, firstPage: 1, lastPage: 40, pageCount: 40, cleanCutAfter: true },
    ]);
    expect(plan.pagesChecked).toBe(0);
  });

  it("tightens the chunk size for a scan whose bytes would blow the request limit", async () => {
    // 200 pages at 1MB each with a 10MB limit and 0.8 headroom -> 8 pages max.
    const { isCoverPage } = coversEvery(4);
    const plan = await planBatchChunks({
      pageCount: 200,
      byteLength: 200 * 1024 * 1024,
      maxPages: 100,
      maxBytes: 10 * 1024 * 1024,
      isCoverPage,
      searchWindow: 8,
      concurrency: 4,
    });
    expect(plan.chunks.every((c) => c.pageCount <= 8)).toBe(true);
    expect(plan.chunks.every((c) => c.cleanCutAfter)).toBe(true);
    expect(coverage(plan.chunks)).toEqual(Array.from({ length: 200 }, (_, i) => i + 1));
  });
});

describe("chunkFileName", () => {
  it("names the part and its source page range", () => {
    const chunk: BatchChunk = { index: 1, firstPage: 98, lastPage: 190, pageCount: 93, cleanCutAfter: true };
    expect(chunkFileName("class-scan.pdf", chunk, 3)).toBe("class-scan.pdf (part 2 of 3, pages 98-190)");
  });
});
