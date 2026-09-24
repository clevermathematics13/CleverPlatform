import { describe, it, expect } from "vitest";
import { formatQuestionLabel, paperQuestionPrefixes } from "./paper-labels";
import * as assignments from "./assignments";

describe("formatQuestionLabel", () => {
  it("numbers a question by its section and its place in that section", () => {
    expect(formatQuestionLabel(0, 0, "numeric")).toBe("1.1");
    expect(formatQuestionLabel(1, 2, "numeric")).toBe("2.3");
  });

  it("letters a question when the paper is lettered", () => {
    expect(formatQuestionLabel(0, 0, "lettered")).toBe("(a)");
    expect(formatQuestionLabel(3, 2, "lettered")).toBe("(c)");
  });
});

describe("paperQuestionPrefixes", () => {
  it("gives every part of a question that question's prefix, in sort_order", () => {
    const prefixes = paperQuestionPrefixes({
      sections: [
        { questions: [{ subparts: ["a", "b"] }, { subparts: [] }] },
        { questions: [{ subparts: ["a", "b", "c"] }] },
      ],
    });
    expect([...prefixes.entries()]).toEqual([
      [0, "1.1"],
      [1, "1.1"],
      [2, "1.2"],
      [3, "2.1"],
      [4, "2.1"],
      [5, "2.1"],
    ]);
  });

  it("returns an empty map for a test with no authored draft", () => {
    expect(paperQuestionPrefixes(null).size).toBe(0);
    expect(paperQuestionPrefixes({ sections: "not an array" }).size).toBe(0);
  });

  // The move out of lib/assignments must not break its callers.
  it("is still exported from lib/assignments", () => {
    expect(assignments.paperQuestionPrefixes).toBe(paperQuestionPrefixes);
    expect(assignments.formatQuestionLabel).toBe(formatQuestionLabel);
  });
});
