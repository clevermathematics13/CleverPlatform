import { describe, it, expect } from "vitest";
import {
  REMARK_TEXT_MAX,
  REMARK_TEXT_MIN,
  buildRemarkQueue,
  normaliseExplanation,
  normaliseTeacherNote,
  pendingRemarkItemIds,
  remarkEligibility,
  remarkMarkMoved,
  remarkNowAgrees,
  remarkOutcomeText,
  toReflectionRemark,
  validateResolution,
  type RemarkQueueEntry,
} from "./remark-requests";
import type { ReflectionRemark } from "./reflection-types";

const remark = (partial: Partial<ReflectionRemark> = {}): ReflectionRemark => ({
  id: "r1",
  test_item_id: "item",
  explanation: "My working shows the method mark.",
  status: "pending",
  marks_at_request: 2,
  self_marks_at_request: 3,
  resolved_marks: null,
  teacher_note: null,
  created_at: "2026-09-24T10:00:00Z",
  updated_at: "2026-09-24T10:00:00Z",
  resolved_at: null,
  ...partial,
});

describe("normaliseExplanation", () => {
  it("trims and keeps line breaks", () => {
    expect(normaliseExplanation("  I used the chain rule.\r\nSee line 2.  ")).toEqual({
      ok: true,
      text: "I used the chain rule.\nSee line 2.",
    });
  });

  it("strips control characters Postgres would refuse", () => {
    const result = normaliseExplanation("My answer\u0000 was 3x+2, which is right.");
    expect(result).toEqual({ ok: true, text: "My answer was 3x+2, which is right." });
  });

  it("refuses too little to act on", () => {
    expect(normaliseExplanation("pls").ok).toBe(false);
    expect(normaliseExplanation("x".repeat(REMARK_TEXT_MIN - 1)).ok).toBe(false);
    expect(normaliseExplanation("x".repeat(REMARK_TEXT_MIN)).ok).toBe(true);
  });

  it("refuses too much rather than cutting it", () => {
    expect(normaliseExplanation("x".repeat(REMARK_TEXT_MAX)).ok).toBe(true);
    expect(normaliseExplanation("x".repeat(REMARK_TEXT_MAX + 1)).ok).toBe(false);
  });

  it("refuses anything that is not text", () => {
    expect(normaliseExplanation(undefined).ok).toBe(false);
    expect(normaliseExplanation(42).ok).toBe(false);
  });
});

describe("normaliseTeacherNote", () => {
  it("reads an empty or missing note as no note", () => {
    expect(normaliseTeacherNote(undefined)).toEqual({ ok: true, text: null });
    expect(normaliseTeacherNote("   ")).toEqual({ ok: true, text: null });
  });

  it("keeps a real note, trimmed", () => {
    expect(normaliseTeacherNote(" Good catch. ")).toEqual({ ok: true, text: "Good catch." });
  });
});

describe("remarkEligibility", () => {
  const base = { hasSelfAssessed: true, marksAwarded: 2, savedSelfMarks: 3, existingStatus: null };

  it("allows a part where the saved marks differ", () => {
    expect(remarkEligibility(base)).toBe("ok");
  });

  it("allows an under-claim too", () => {
    expect(remarkEligibility({ ...base, savedSelfMarks: 1 })).toBe("ok");
  });

  it("reads a blank as a claim of 0", () => {
    expect(remarkEligibility({ ...base, marksAwarded: 0, savedSelfMarks: null })).toBe("agrees");
    expect(remarkEligibility({ ...base, marksAwarded: 1, savedSelfMarks: null })).toBe("ok");
  });

  it("refuses when the marks already agree, or there is nothing to dispute", () => {
    expect(remarkEligibility({ ...base, savedSelfMarks: 2 })).toBe("agrees");
    expect(remarkEligibility({ ...base, marksAwarded: null })).toBe("no-clevmark");
    expect(remarkEligibility({ ...base, hasSelfAssessed: false })).toBe("not-self-assessed");
  });

  it("reports an existing request before anything else", () => {
    expect(remarkEligibility({ ...base, savedSelfMarks: 2, existingStatus: "pending" })).toBe("pending");
    expect(remarkEligibility({ ...base, existingStatus: "stands" })).toBe("resolved");
    expect(remarkEligibility({ ...base, existingStatus: "changed" })).toBe("resolved");
  });
});

describe("pendingRemarkItemIds", () => {
  it("collects only the parts still waiting", () => {
    const ids = pendingRemarkItemIds([
      { test_item_id: "a", remark_request: remark({ test_item_id: "a" }) },
      { test_item_id: "b", remark_request: remark({ test_item_id: "b", status: "stands", resolved_marks: 2 }) },
      { test_item_id: "c", remark_request: null },
      { test_item_id: "d" },
    ]);
    expect([...ids]).toEqual(["a"]);
  });
});

describe("toReflectionRemark", () => {
  it("keeps only what the student may see", () => {
    const view = toReflectionRemark({
      id: "r1",
      test_item_id: "item",
      student_id: "someone",
      resolved_by: "teacher",
      explanation: "text",
      status: "changed",
      marks_at_request: 2,
      self_marks_at_request: null,
      resolved_marks: 3,
      teacher_note: "Yes.",
      created_at: "c",
      updated_at: "u",
      resolved_at: "r",
    });
    expect(Object.keys(view)).not.toContain("student_id");
    expect(Object.keys(view)).not.toContain("resolved_by");
    expect(view.self_marks_at_request).toBeNull();
    expect(view.resolved_marks).toBe(3);
  });
});

describe("remarkOutcomeText", () => {
  it("says what happened, in the student's terms", () => {
    expect(remarkOutcomeText(remark())).toBe("Re-mark requested — waiting for your teacher.");
    expect(remarkOutcomeText(remark({ status: "changed", resolved_marks: 3 }))).toBe(
      "Re-marked: ClevMarks changed from 2 to 3."
    );
    expect(remarkOutcomeText(remark({ status: "stands", resolved_marks: 2 }))).toBe(
      "Re-mark reviewed: ClevMarks stay at 2."
    );
  });

  it("does not claim the mark stayed put when it had already moved", () => {
    expect(remarkOutcomeText(remark({ status: "stands", resolved_marks: 3 }))).toBe(
      "Re-mark reviewed: ClevMarks are now 3 (2 when you asked)."
    );
  });

  it("never says AI, and never uses the old name", () => {
    const texts = [
      remark(),
      remark({ status: "changed", resolved_marks: 3 }),
      remark({ status: "stands", resolved_marks: 2 }),
      remark({ status: "stands", resolved_marks: 4 }),
    ].map(remarkOutcomeText);
    for (const text of texts) {
      expect(text).not.toMatch(/\bAI\b/);
      expect(text).not.toMatch(/Clev's/);
    }
  });
});

describe("validateResolution", () => {
  const base = {
    outcome: "changed" as unknown,
    newMarks: 3 as unknown,
    note: undefined as unknown,
    maxMarks: 4,
    marksAtRequest: 2,
    currentMarks: 2 as number | null,
    expectedCurrentMarks: 2 as unknown,
  };

  it("changes the mark", () => {
    expect(validateResolution(base)).toEqual({
      ok: true,
      outcome: "changed",
      resolvedMarks: 3,
      note: null,
      writeMark: true,
    });
  });

  it("does not write a mark that is already there", () => {
    // Moved to 3 in the gradebook before the teacher answered, and the page
    // was loaded after that.
    const result = validateResolution({ ...base, currentMarks: 3, expectedCurrentMarks: 3 });
    expect(result).toMatchObject({ ok: true, outcome: "changed", resolvedMarks: 3, writeMark: false });
  });

  it("keeps the current mark when it stands", () => {
    expect(validateResolution({ ...base, outcome: "stands", note: " Read the scheme again. " })).toEqual({
      ok: true,
      outcome: "stands",
      resolvedMarks: 2,
      note: "Read the scheme again.",
      writeMark: false,
    });
  });

  it("refuses to act on a mark that moved after the page loaded", () => {
    expect(validateResolution({ ...base, currentMarks: 4 })).toMatchObject({ ok: false, status: 409 });
  });

  it("refuses to keep a mark that does not exist", () => {
    expect(
      validateResolution({ ...base, outcome: "stands", currentMarks: null, expectedCurrentMarks: null })
    ).toMatchObject({ ok: false, status: 409 });
  });

  it("refuses marks it cannot record", () => {
    expect(validateResolution({ ...base, newMarks: 2.5 })).toMatchObject({ ok: false, status: 400 });
    expect(validateResolution({ ...base, newMarks: "3" })).toMatchObject({ ok: false, status: 400 });
    expect(validateResolution({ ...base, newMarks: 5 })).toMatchObject({ ok: false, status: 400 });
    expect(validateResolution({ ...base, newMarks: -1 })).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses a change back to the mark the student disputed", () => {
    expect(validateResolution({ ...base, newMarks: 2 })).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses an unknown outcome or a missing expected mark", () => {
    expect(validateResolution({ ...base, outcome: "maybe" })).toMatchObject({ ok: false, status: 400 });
    expect(validateResolution({ ...base, expectedCurrentMarks: undefined })).toMatchObject({
      ok: false,
      status: 400,
    });
  });
});

describe("buildRemarkQueue", () => {
  const entry = (partial: Partial<RemarkQueueEntry> & { id: string }): RemarkQueueEntry => ({
    testId: "t1",
    testName: "Test 1",
    testItemId: "i1",
    sortOrder: 0,
    createdAt: "2026-09-24T10:00:00Z",
    marksAtRequest: 2,
    currentMarks: 2,
    currentSelfMarks: 3,
    ...partial,
  });

  it("puts the longest-waiting test first, parts in paper order, oldest request first", () => {
    const queue = buildRemarkQueue([
      entry({ id: "a", testItemId: "i2", sortOrder: 5, createdAt: "2026-09-24T12:00:00Z" }),
      entry({ id: "b", testItemId: "i1", sortOrder: 1, createdAt: "2026-09-24T11:00:00Z" }),
      entry({ id: "c", testItemId: "i2", sortOrder: 5, createdAt: "2026-09-24T09:00:00Z" }),
      entry({ id: "d", testId: "t2", testName: "Test 2", testItemId: "i9", createdAt: "2026-09-23T09:00:00Z" }),
    ]);
    expect(queue.map((t) => t.testId)).toEqual(["t2", "t1"]);
    const t1 = queue[1];
    expect(t1.count).toBe(3);
    expect(t1.parts.map((p) => p.testItemId)).toEqual(["i1", "i2"]);
    expect(t1.parts[1].requests.map((r) => r.id)).toEqual(["c", "a"]);
  });

  it("flags a mark that moved and a student who now agrees", () => {
    expect(remarkMarkMoved(entry({ id: "x", currentMarks: 3 }))).toBe(true);
    expect(remarkMarkMoved(entry({ id: "x" }))).toBe(false);
    expect(remarkNowAgrees(entry({ id: "x", currentSelfMarks: 2 }))).toBe(true);
    expect(remarkNowAgrees(entry({ id: "x", currentMarks: 0, currentSelfMarks: null }))).toBe(true);
    expect(remarkNowAgrees(entry({ id: "x" }))).toBe(false);
  });
});
