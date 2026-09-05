import { describe, expect, it } from "vitest";
import { groupUnfinishedBatches, isUnfinished, parsePartFileName, type RestorableBatch } from "./batch-restore";

const row = (over: Partial<RestorableBatch> & { id: string }): RestorableBatch => ({
  status: "segmented",
  file_name: "scan.pdf",
  page_count: 12,
  proposed_segments: [{}],
  created_at: "2026-09-05T00:00:00Z",
  graded_runs: 0,
  ...over,
});

describe("parsePartFileName", () => {
  it("reads the parent name, part index, count and page range", () => {
    expect(parsePartFileName("U1_C_Form_2.pdf (part 2 of 13, pages 13-24)")).toEqual({
      parent: "U1_C_Form_2.pdf",
      index: 1,
      count: 13,
      firstPage: 13,
      lastPage: 24,
    });
  });

  it("returns null for a plain file name", () => {
    expect(parsePartFileName("U1_G_Form_1_comp.pdf")).toBeNull();
  });
});

describe("isUnfinished", () => {
  it("keeps segmented batches and split-but-ungraded ones", () => {
    expect(isUnfinished(row({ id: "a" }))).toBe(true);
    expect(isUnfinished(row({ id: "b", status: "split", graded_runs: 0 }))).toBe(true);
  });

  it("drops graded, failed, still-segmenting and proposal-less batches", () => {
    expect(isUnfinished(row({ id: "c", status: "split", graded_runs: 1 }))).toBe(false);
    expect(isUnfinished(row({ id: "d", status: "failed" }))).toBe(false);
    expect(isUnfinished(row({ id: "e", status: "segmenting", proposed_segments: null }))).toBe(false);
    expect(isUnfinished(row({ id: "f", proposed_segments: null }))).toBe(false);
  });
});

describe("groupUnfinishedBatches", () => {
  it("groups parts under their parent upload in part order", () => {
    const uploads = groupUnfinishedBatches([
      row({ id: "p3", file_name: "A.pdf (part 3 of 3, pages 25-36)" }),
      row({ id: "p1", file_name: "A.pdf (part 1 of 3, pages 1-12)" }),
      row({ id: "whole", file_name: "B.pdf", page_count: 48 }),
    ]);
    expect(uploads.map((u) => u.fileName)).toEqual(["A.pdf", "B.pdf"]);
    expect(uploads[0].parts.map((p) => p.batch.id)).toEqual(["p1", "p3"]);
    expect(uploads[0].parts[1]).toMatchObject({ index: 2, count: 3, firstPage: 25, lastPage: 36 });
    expect(uploads[0].pageCount).toBe(36);
    expect(uploads[1].parts[0]).toMatchObject({ index: 0, count: 1, firstPage: 1, lastPage: 48 });
    expect(uploads[1].pageCount).toBe(48);
  });

  it("keeps only the newest row when the same part was uploaded twice", () => {
    const uploads = groupUnfinishedBatches([
      row({ id: "new", file_name: "A.pdf (part 1 of 2, pages 1-12)", created_at: "2026-09-05T02:00:00Z" }),
      row({ id: "old", file_name: "A.pdf (part 1 of 2, pages 1-12)", created_at: "2026-09-05T01:00:00Z" }),
      row({ id: "w2", file_name: "B.pdf" }),
      row({ id: "w1", file_name: "B.pdf" }),
    ]);
    expect(uploads[0].parts.map((p) => p.batch.id)).toEqual(["new"]);
    expect(uploads[1].parts.map((p) => p.batch.id)).toEqual(["w2"]);
  });

  it("does not resurrect an older duplicate of a part whose newest row is finished", () => {
    const uploads = groupUnfinishedBatches([
      row({
        id: "new-graded",
        file_name: "A.pdf (part 1 of 2, pages 1-12)",
        status: "split",
        graded_runs: 1,
        created_at: "2026-09-05T02:00:00Z",
      }),
      row({ id: "old-read", file_name: "A.pdf (part 1 of 2, pages 1-12)", created_at: "2026-09-05T01:00:00Z" }),
      row({ id: "p2", file_name: "A.pdf (part 2 of 2, pages 13-24)" }),
    ]);
    expect(uploads).toHaveLength(1);
    expect(uploads[0].parts.map((p) => p.batch.id)).toEqual(["p2"]);
  });

  it("flags a part that was split but never graded, and omits graded ones", () => {
    const uploads = groupUnfinishedBatches([
      row({ id: "s", file_name: "A.pdf (part 2 of 3, pages 13-24)", status: "split", graded_runs: 0 }),
      row({ id: "g", file_name: "A.pdf (part 1 of 3, pages 1-12)", status: "split", graded_runs: 1 }),
      row({ id: "r", file_name: "A.pdf (part 3 of 3, pages 25-36)" }),
    ]);
    expect(uploads[0].parts.map((p) => [p.batch.id, p.splitButUngraded])).toEqual([
      ["s", true],
      ["r", false],
    ]);
  });

  it("returns nothing when every batch is finished", () => {
    expect(groupUnfinishedBatches([row({ id: "g", status: "split", graded_runs: 3 })])).toEqual([]);
  });
});
