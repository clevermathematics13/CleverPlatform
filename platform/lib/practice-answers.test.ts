import { describe, expect, it } from "vitest";
import {
  answerKey,
  answerProgress,
  answerSlots,
  isAnswered,
  WHOLE_QUESTION,
} from "@/lib/practice-answers";

describe("answerSlots", () => {
  it("gives a scanned bank question one whole-question slot", () => {
    expect(answerSlots(null)).toEqual([WHOLE_QUESTION]);
  });

  it("gives a question with no parts one whole-question slot", () => {
    expect(answerSlots("Find the exact value of the integral. \\hfill [5]")).toEqual([
      WHOLE_QUESTION,
    ]);
  });

  it("reads part labels in order", () => {
    const latex = [
      "\\begin{IBPart}{(a)} Show that ... \\end{IBPart}",
      "\\begin{IBPart}{(b)} Hence find ... \\end{IBPart}",
      "\\begin{IBPart}{(c)} Deduce ... \\end{IBPart}",
    ].join("\n");
    expect(answerSlots(latex)).toEqual(["(a)", "(b)", "(c)"]);
  });

  it("handles the whole question on one physical line", () => {
    const latex =
      "Consider $f$. \\begin{IBPart}{(a)} One. \\end{IBPart} \\begin{IBPart}{(b)} Two. \\end{IBPart}";
    expect(answerSlots(latex)).toEqual(["(a)", "(b)"]);
  });

  // Two parts with the same label would collide on the table's unique key.
  it("does not repeat a duplicated label", () => {
    const latex =
      "\\begin{IBPart}{(a)} One. \\end{IBPart} \\begin{IBPart}{(a)} Again. \\end{IBPart}";
    expect(answerSlots(latex)).toEqual(["(a)"]);
  });

  it("ignores prose that merely looks like a part label", () => {
    expect(answerSlots("The point (a) lies on the curve, where (b) is fixed.")).toEqual([
      WHOLE_QUESTION,
    ]);
  });

  it("ignores an empty label rather than keying a slot on nothing", () => {
    expect(answerSlots("\\begin{IBPart}{} Body. \\end{IBPart}")).toEqual([WHOLE_QUESTION]);
  });
});

describe("isAnswered", () => {
  it("is false for nothing at all", () => {
    expect(isAnswered(null)).toBe(false);
    expect(isAnswered(undefined)).toBe(false);
    expect(isAnswered("")).toBe(false);
    expect(isAnswered("   ")).toBe(false);
  });

  // What the editor leaves behind after a student types and deletes.
  it("is false for empty groups and bare placeholders", () => {
    expect(isAnswered("{}")).toBe(false);
    expect(isAnswered("\\placeholder{}")).toBe(false);
    expect(isAnswered("{\\placeholder{}}")).toBe(false);
  });

  it("is true for real work", () => {
    expect(isAnswered("x=2")).toBe(true);
    expect(isAnswered("\\frac{39}{8}+6\\ln 2")).toBe(true);
    expect(isAnswered("0")).toBe(true);
  });
});

describe("answerProgress", () => {
  const items = [
    { position: 1, slots: [WHOLE_QUESTION] },
    { position: 2, slots: ["(a)", "(b)"] },
    { position: 3, slots: ["(a)", "(b)", "(c)"] },
  ];

  it("counts parts, not questions", () => {
    expect(answerProgress(items, new Map()).total).toBe(6);
  });

  it("counts only slots with something in them", () => {
    const answers = new Map([
      [answerKey(1, WHOLE_QUESTION), "x=2"],
      [answerKey(2, "(a)"), "  "],
      [answerKey(3, "(b)"), "\\frac12"],
    ]);
    expect(answerProgress(items, answers)).toEqual({ answered: 2, total: 6 });
  });

  it("is all-answered when every slot is filled", () => {
    const answers = new Map(
      items.flatMap((i) => i.slots.map((s) => [answerKey(i.position, s), "1"] as const))
    );
    expect(answerProgress(items, answers)).toEqual({ answered: 6, total: 6 });
  });
});

describe("answerKey", () => {
  it("separates position from label unambiguously", () => {
    expect(answerKey(1, "(a)")).toBe("1::(a)");
    expect(answerKey(1, WHOLE_QUESTION)).toBe("1::");
  });

  it("does not collide across positions or labels", () => {
    const keys = new Set([
      answerKey(1, "(a)"),
      answerKey(1, "(b)"),
      answerKey(11, ""),
      answerKey(1, "1::"),
    ]);
    expect(keys.size).toBe(4);
  });
});
