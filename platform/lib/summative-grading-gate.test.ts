import { describe, it, expect } from "vitest";
import {
  batchAcceptCovers,
  partitionBatchAccept,
  heldForReviewMessage,
} from "./summative-grading-gate";

const high = { confidence: "high", work_found: true };
const medium = { confidence: "medium", work_found: true };
const low = { confidence: "low", work_found: true };
const highNoWorking = { confidence: "high", work_found: false };

describe("batchAcceptCovers", () => {
  it("covers everything on a formative", () => {
    // Unchanged behaviour: "Accept all" on practice is one click instead of
    // fifty, and a mark that turns out wrong costs a correction next lesson.
    for (const r of [high, medium, low, highNoWorking]) {
      expect(batchAcceptCovers("formative", r)).toBe(true);
    }
  });

  it("covers only full confidence on a summative", () => {
    expect(batchAcceptCovers("summative", high)).toBe(true);
    expect(batchAcceptCovers("summative", medium)).toBe(false);
    expect(batchAcceptCovers("summative", low)).toBe(false);
  });

  it("holds a confident mark that found no working", () => {
    // Same rule the review UI's needsReview list already uses. A mark awarded
    // against a page with nothing on it is exactly what a teacher should see.
    expect(batchAcceptCovers("summative", highNoWorking)).toBe(false);
  });

  it("treats an unknown work_found as work found", () => {
    // Null is an old row, not a blank page. Reading "we don't know" as "no
    // working" would hold marks that were never in doubt.
    expect(batchAcceptCovers("summative", { confidence: "high", work_found: null })).toBe(true);
    expect(batchAcceptCovers("summative", { confidence: "high" })).toBe(true);
  });
});

describe("partitionBatchAccept", () => {
  const results = [
    { id: "a", confidence: "high", work_found: true },
    { id: "b", confidence: "medium", work_found: true },
    { id: "c", confidence: "low", work_found: true },
    { id: "d", confidence: "high", work_found: false },
  ];

  it("holds nothing on a formative", () => {
    const { accept, held } = partitionBatchAccept("formative", results);
    expect(accept).toHaveLength(4);
    expect(held).toHaveLength(0);
  });

  it("splits a summative into written and held", () => {
    const { accept, held } = partitionBatchAccept("summative", results);
    expect(accept.map((r) => r.id)).toEqual(["a"]);
    expect(held.map((r) => r.id)).toEqual(["b", "c", "d"]);
  });

  it("loses nothing: every row comes back in exactly one list", () => {
    const { accept, held } = partitionBatchAccept("summative", results);
    expect([...accept, ...held].map((r) => r.id).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("handles an empty batch", () => {
    expect(partitionBatchAccept("summative", [])).toEqual({ accept: [], held: [] });
  });
});

describe("heldForReviewMessage", () => {
  it("is empty when nothing was held, so callers can append it blindly", () => {
    expect(heldForReviewMessage(0, 0)).toBe("");
    expect(heldForReviewMessage(-1, 3)).toBe("");
  });

  it("says how many, across how many students, and what to do", () => {
    const message = heldForReviewMessage(12, 5);
    expect(message).toContain("12 suggested marks");
    expect(message).toContain("5 students");
    expect(message).toContain("NOT accepted");
    expect(message).toContain("summative");
  });

  it("reads correctly for a single mark and a single student", () => {
    const message = heldForReviewMessage(1, 1);
    expect(message).toContain("1 suggested mark ");
    expect(message).toContain("1 student ");
    expect(message).not.toContain("marks across");
  });
});
