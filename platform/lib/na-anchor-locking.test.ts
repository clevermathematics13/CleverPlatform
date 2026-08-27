/**
 * na-anchor-locking.test.ts
 * -----------------------------------------------------------------------------
 * Regression tests for the anchors_locked validation gate. The fixtures
 * mirror the real shapes verified against A.1 ("Sixty Times a Person") in
 * production: a marks:0 exploration question with no anchor, a marks:0
 * question with an ungraded anchor (null marks_available), and Q26's real
 * (a)+(b)+(c) = 2+1+2 = 5 split.
 *
 * Run with: cd platform && npx vitest run lib/na-anchor-locking.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  extractGradableQuestions,
  groupAnchorsByBase,
  validateAnchorLock,
  buildRubricItemRows,
  type AnchorForLock,
} from "./na-anchor-locking";

const PARTS = [
  {
    heading: "Part 0",
    questions: [
      { marks: 4, prompt: "Q1 prompt", answer: "Q1 answer" },
      { marks: 0, prompt: "Slider exploration, nothing to grade" },
      { marks: 5, prompt: "Q2 prompt", answer: "Q2 answer" },
    ],
  },
  {
    heading: "Part 1",
    questions: [
      {
        marks: 5,
        prompt: "Every $570 combination satisfies 2a + c = 19. (a) Plot ... (b) Describe ... (c) Explain ...",
        answer: "(a) ten points ... (b) pattern ... (c) explanation ...",
      },
    ],
  },
];

function anchor(partial: Partial<AnchorForLock> & Pick<AnchorForLock, "qid" | "baseQid" | "sortOrder">): AnchorForLock {
  return {
    id: partial.qid,
    marksAvailable: null,
    commandTerm: null,
    ...partial,
  };
}

describe("extractGradableQuestions", () => {
  it("keeps only marks > 0 entries, preserving flattened ordinal position", () => {
    const gradable = extractGradableQuestions(PARTS);
    expect(gradable.map((g) => g.ordinal)).toEqual([1, 3, 4]);
    expect(gradable.map((g) => g.marks)).toEqual([4, 5, 5]);
  });

  it("returns empty for non-array input rather than throwing", () => {
    expect(extractGradableQuestions(null)).toEqual([]);
    expect(extractGradableQuestions(undefined)).toEqual([]);
  });
});

describe("groupAnchorsByBase + validateAnchorLock", () => {
  it("passes cleanly when every gradable question has anchors summing to its total", () => {
    const anchors: AnchorForLock[] = [
      anchor({ qid: "Q1", baseQid: "Q1", sortOrder: 0, marksAvailable: 4 }),
      // ungraded activity box -- every anchor in the group has null marks,
      // so it must be excluded from the gradable pairing entirely
      anchor({ qid: "ACTIVITY", baseQid: "ACTIVITY", sortOrder: 2, marksAvailable: null }),
      anchor({ qid: "Q2", baseQid: "Q2", sortOrder: 3, marksAvailable: 5 }),
      anchor({ qid: "Q26(a)", baseQid: "Q26", sortOrder: 33, marksAvailable: 2 }),
      anchor({ qid: "Q26(b)", baseQid: "Q26", sortOrder: 34, marksAvailable: 1 }),
      anchor({ qid: "Q26(c)", baseQid: "Q26", sortOrder: 35, marksAvailable: 2 }),
    ];

    const groups = groupAnchorsByBase(anchors);
    const gradable = extractGradableQuestions(PARTS);
    const result = validateAnchorLock(groups, gradable);

    expect(result.coverageProblems).toEqual([]);
    expect(result.markSplitMismatches).toEqual([]);
    expect(result.pairs).toHaveLength(3);
    expect(result.pairs[2].group.baseQid).toBe("Q26");
    expect(result.pairs[2].question.marks).toBe(5);
  });

  it("catches a mark-split mismatch (the Q26(a)-missing bug, pre-fix)", () => {
    // Q26 only has (b) and (c) -- (a)'s 2 marks are missing, sum is 3 not 5.
    const anchors: AnchorForLock[] = [
      anchor({ qid: "Q1", baseQid: "Q1", sortOrder: 0, marksAvailable: 4 }),
      anchor({ qid: "Q2", baseQid: "Q2", sortOrder: 3, marksAvailable: 5 }),
      anchor({ qid: "Q26(b)", baseQid: "Q26", sortOrder: 34, marksAvailable: 1 }),
      anchor({ qid: "Q26(c)", baseQid: "Q26", sortOrder: 35, marksAvailable: 2 }),
    ];
    const groups = groupAnchorsByBase(anchors);
    const gradable = extractGradableQuestions(PARTS);
    const result = validateAnchorLock(groups, gradable);

    expect(result.coverageProblems).toEqual([]);
    expect(result.markSplitMismatches).toEqual([
      { baseQid: "Q26", anchorSum: 3, authoritativeMarks: 5, partsOrdinal: 4 },
    ]);
  });

  it("catches a fully missing question (zero anchors for a gradable question)", () => {
    // Q26 (the last gradable question) has no anchor at all -- the actual
    // shape of the real A.1 bug at its worst: not merely a wrong split,
    // but the whole base question absent from na_anchors.
    const anchors: AnchorForLock[] = [
      anchor({ qid: "Q1", baseQid: "Q1", sortOrder: 0, marksAvailable: 4 }),
      anchor({ qid: "Q2", baseQid: "Q2", sortOrder: 3, marksAvailable: 5 }),
    ];
    const groups = groupAnchorsByBase(anchors);
    const gradable = extractGradableQuestions(PARTS);
    const result = validateAnchorLock(groups, gradable);

    expect(result.coverageProblems).toEqual([
      {
        kind: "missing_anchor",
        partsOrdinal: 4,
        promptSnippet: "Every $570 combination satisfies 2a + c = 19. (a) Plot ... (b) Describe ... (c) ",
      },
    ]);
    // Mark-split is skipped entirely once coverage is broken -- the
    // positional pairing past the gap can't be trusted.
    expect(result.markSplitMismatches).toEqual([]);
    expect(result.pairs).toEqual([]);
  });

  it("still fails loudly on a gap in the MIDDLE of the sequence, even though a pure position diff can't name the exact missing question", () => {
    // Q2 (the middle gradable question) is dropped; Q1 and Q26 are both
    // still present. A naive positional walk cannot tell "Q2 is missing"
    // from "Q26 is misfiled as Q2's slot, and something after it is
    // missing" -- there is no stable id linking an anchor back to its
    // parts[] entry to disambiguate. The guarantee this module actually
    // makes is narrower than perfect localisation: coverage problems are
    // never silently empty when the counts don't match, so the lock is
    // refused either way. A human resolves the real gap from the reported
    // ordinals/qids, same as every other step in this review pipeline.
    const anchors: AnchorForLock[] = [
      anchor({ qid: "Q1", baseQid: "Q1", sortOrder: 0, marksAvailable: 4 }),
      anchor({ qid: "Q26(a)", baseQid: "Q26", sortOrder: 33, marksAvailable: 2 }),
      anchor({ qid: "Q26(b)", baseQid: "Q26", sortOrder: 34, marksAvailable: 1 }),
      anchor({ qid: "Q26(c)", baseQid: "Q26", sortOrder: 35, marksAvailable: 2 }),
    ];
    const groups = groupAnchorsByBase(anchors);
    const gradable = extractGradableQuestions(PARTS);
    const result = validateAnchorLock(groups, gradable);

    expect(result.coverageProblems.length).toBeGreaterThan(0);
    expect(result.pairs).toEqual([]);
  });

  it("catches an extra anchor with no matching gradable question", () => {
    const anchors: AnchorForLock[] = [
      anchor({ qid: "Q1", baseQid: "Q1", sortOrder: 0, marksAvailable: 4 }),
      anchor({ qid: "Q2", baseQid: "Q2", sortOrder: 3, marksAvailable: 5 }),
      anchor({ qid: "Q26(a)", baseQid: "Q26", sortOrder: 33, marksAvailable: 2 }),
      anchor({ qid: "Q26(b)", baseQid: "Q26", sortOrder: 34, marksAvailable: 1 }),
      anchor({ qid: "Q26(c)", baseQid: "Q26", sortOrder: 35, marksAvailable: 2 }),
      anchor({ qid: "Q27", baseQid: "Q27", sortOrder: 40, marksAvailable: 3 }),
    ];
    const groups = groupAnchorsByBase(anchors);
    const gradable = extractGradableQuestions(PARTS);
    const result = validateAnchorLock(groups, gradable);

    expect(result.coverageProblems).toEqual([{ kind: "unexpected_anchor", baseQid: "Q27" }]);
  });
});

describe("buildRubricItemRows", () => {
  it("writes one row per anchor, sharing the base question's text/answer/total", () => {
    const anchors: AnchorForLock[] = [
      anchor({ qid: "Q1", baseQid: "Q1", sortOrder: 0, marksAvailable: 4 }),
      anchor({ qid: "Q2", baseQid: "Q2", sortOrder: 3, marksAvailable: 5 }),
      anchor({ qid: "Q26(a)", baseQid: "Q26", sortOrder: 33, marksAvailable: 2, commandTerm: "Plot" }),
      anchor({ qid: "Q26(b)", baseQid: "Q26", sortOrder: 34, marksAvailable: 1, commandTerm: "Describe" }),
      anchor({ qid: "Q26(c)", baseQid: "Q26", sortOrder: 35, marksAvailable: 2, commandTerm: "Explain" }),
    ];
    const groups = groupAnchorsByBase(anchors);
    const gradable = extractGradableQuestions(PARTS);
    const result = validateAnchorLock(groups, gradable);
    expect(result.coverageProblems).toEqual([]);
    const rows = buildRubricItemRows(result.pairs).filter((r) => r.base_qid === "Q26");

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.qid)).toEqual(["Q26(a)", "Q26(b)", "Q26(c)"]);
    expect(rows.every((r) => r.question_marks === 5)).toBe(true);
    expect(rows.map((r) => r.marks)).toEqual([2, 1, 2]);
    expect(rows.every((r) => r.question_text.startsWith("Every $570"))).toBe(true);
  });
});
