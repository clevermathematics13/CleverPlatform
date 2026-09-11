import { describe, expect, it } from "vitest";
import katex from "katex";
import {
  ADVANCED_NOTATION,
  BASIC_NOTATION,
  allNotationItems,
  previewLatex,
} from "@/lib/math-notation";

const all = allNotationItems();

describe("the notation palette", () => {
  it("gives every item a unique id", () => {
    const ids = all.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every group a unique id", () => {
    const ids = [...BASIC_NOTATION, ...ADVANCED_NOTATION].map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every item something to insert and something to be called", () => {
    for (const item of all) {
      expect(item.insert.length, item.id).toBeGreaterThan(0);
      expect(item.label.trim().length, item.id).toBeGreaterThan(0);
    }
  });

  // A preview that does not parse renders as a blank or red button, which is
  // invisible in a unit test and obvious to a student.
  it("renders every button preview under KaTeX", () => {
    for (const item of all) {
      expect(
        () => katex.renderToString(previewLatex(item), { throwOnError: true }),
        `${item.id} preview does not parse`
      ).not.toThrow();
    }
  });
});

describe("basic versus advanced", () => {
  // The whole organising promise of this palette. If BASIC grows without
  // anyone deciding to grow it, this fails and someone has to think about it.
  it("keeps the always-visible half short", () => {
    const basic = BASIC_NOTATION.flatMap((g) => g.items);
    expect(basic.length).toBeLessThanOrEqual(40);
  });

  it("puts the everyday notation where it is always visible", () => {
    const basicIds = new Set(BASIC_NOTATION.flatMap((g) => g.items).map((i) => i.id));
    for (const id of ["frac", "sup", "sqrt", "pi", "int", "defint", "sin", "ln", "dydx"]) {
      expect(basicIds.has(id), `${id} should be in the basic palette`).toBe(true);
    }
  });

  it("keeps the specialist notation out of the way", () => {
    const advancedIds = new Set(ADVANCED_NOTATION.flatMap((g) => g.items).map((i) => i.id));
    for (const id of ["partial", "mat22", "forall", "cis", "ncr", "sinh", "alpha", "floor"]) {
      expect(advancedIds.has(id), `${id} should be behind Advanced notation`).toBe(true);
    }
  });

  it("has substantially more behind the menu than in front of it", () => {
    const basic = BASIC_NOTATION.flatMap((g) => g.items).length;
    const advanced = ADVANCED_NOTATION.flatMap((g) => g.items).length;
    expect(advanced).toBeGreaterThan(basic);
  });
});
