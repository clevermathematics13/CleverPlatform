import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { markingKeyFor, markingKeySource } from "./na-marking-key";

/**
 * The A.1 Q1(e) pair, verbatim from na_anchors. These two strings are the
 * reason this module exists: they say different things, and for a while the
 * model marked against one while the teacher reviewed against the other.
 */
const Q1E_AUTHORED = "(c) 750. (d) 30 x 25 = 750. (e) Accept any observation that (c) and (d) agree.";
const Q1E_SKETCH = "(c) 750 (d) 750 (e) they agree.";

describe("markingKeyFor", () => {
  it("prefers the authored key to the sketch", () => {
    expect(markingKeyFor({ questionAnswer: Q1E_AUTHORED, answerSketch: Q1E_SKETCH })).toBe(
      Q1E_AUTHORED
    );
  });

  it("falls back to the sketch where there is no authored key", () => {
    // A.1's Q3, Q4, Q29 and Q30 are the live case.
    expect(markingKeyFor({ questionAnswer: null, answerSketch: Q1E_SKETCH })).toBe(Q1E_SKETCH);
  });

  it("treats a whitespace-only key as absent in both slots", () => {
    expect(markingKeyFor({ questionAnswer: "   ", answerSketch: Q1E_SKETCH })).toBe(Q1E_SKETCH);
    expect(markingKeyFor({ questionAnswer: "  ", answerSketch: "\n " })).toBeNull();
  });

  it("returns null when an anchor has neither", () => {
    expect(markingKeyFor({})).toBeNull();
    expect(markingKeyFor({ questionAnswer: null, answerSketch: null })).toBeNull();
  });

  it("trims, so a key never reaches a prompt or a screen with its padding", () => {
    expect(markingKeyFor({ questionAnswer: "  42  " })).toBe("42");
  });
});

describe("markingKeySource", () => {
  it("names which column the key came from", () => {
    expect(markingKeySource({ questionAnswer: "a", answerSketch: "b" })).toBe("authored");
    expect(markingKeySource({ answerSketch: "b" })).toBe("sketch");
    expect(markingKeySource({})).toBeNull();
  });
});

/**
 * The two callers, pinned together.
 *
 * These are the tests that would have caught the original divergence: not
 * that either side is right on its own, but that both sides resolve the SAME
 * key. The review screen is where a teacher confirms or overrides an AI
 * verdict, so a screen showing a different key than the prompt is a review
 * that cannot do its job.
 */
describe("the prompt and the review screen resolve the same key", () => {
  it("puts the authored key, not the sketch, in the grading prompt", async () => {
    const { buildRubricBlock } = await import("./na-assessment");
    const block = buildRubricBlock({
      qid: "Q1(e)",
      baseQid: "Q1",
      marksAvailable: 1,
      commandTerm: null,
      questionAnswer: Q1E_AUTHORED,
      answerSketch: Q1E_SKETCH,
      openRubric: null,
      misconceptionContext: null,
    });
    expect(block).toContain(Q1E_AUTHORED);
    // The permissive wording is what the model must see; "they agree" reads
    // as a required phrase and cost a real student a mark.
    expect(block).not.toContain("(e) they agree.");
  });

  it("is what the review screen renders, from the same two columns", () => {
    const anchor = { question_answer: Q1E_AUTHORED, answer_sketch: Q1E_SKETCH };
    const shown = markingKeyFor({
      questionAnswer: anchor.question_answer,
      answerSketch: anchor.answer_sketch,
    });
    expect(shown).toBe(Q1E_AUTHORED);
  });

  it("keeps the review screen off answer_sketch directly", () => {
    // A source check, because nothing else would notice the call being
    // replaced by the raw column again -- which is exactly what it was.
    const src = readFileSync(
      join(process.cwd(), "app", "dashboard", "na-review", "[anchorId]", "anchor-review-client.tsx"),
      "utf8",
    );
    expect(src).toContain("markingKeyFor(");
    expect(src).not.toMatch(/\{\s*anchor\.answer_sketch\s*\}/);
  });

  it("fetches the authored key on both paths that feed that screen", () => {
    // The call above silently falls back to the sketch for every anchor if
    // question_answer is not selected, which looks exactly like no change.
    for (const p of [
      ["app", "dashboard", "na-review", "[anchorId]", "page.tsx"],
      ["app", "api", "na-review", "anchor", "[anchorId]", "route.ts"],
    ]) {
      const src = readFileSync(join(process.cwd(), ...p), "utf8");
      expect(src, `${p.join("/")} must select question_answer`).toContain("question_answer");
    }
  });
});
