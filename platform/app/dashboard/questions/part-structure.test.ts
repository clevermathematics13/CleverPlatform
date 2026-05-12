import { describe, expect, it } from "vitest";
import { hasExplicitTopLevelPartStructure, shouldBlockPartAutoSave } from "./part-structure";

describe("hasExplicitTopLevelPartStructure", () => {
  it("returns false for unlabeled IBPart blocks", () => {
    const text = `
\\begin{IBPart}
Find the derivative of $f(x)$.
\\end{IBPart}
`;

    expect(hasExplicitTopLevelPartStructure(text)).toBe(false);
  });

  it("returns true for labelled IBPart blocks", () => {
    const text = `
\\begin{IBPart}[a]
Find the derivative of $f(x)$.
\\end{IBPart}
`;

    expect(hasExplicitTopLevelPartStructure(text)).toBe(true);
  });

  it("returns true for line-start top-level labels", () => {
    const text = `
(a) Find the derivative.
(b) Solve the equation.
`;

    expect(hasExplicitTopLevelPartStructure(text)).toBe(true);
  });

  it("returns false for incidental inline label text", () => {
    const text = "It is given that (a) is a constant and the graph is increasing.";

    expect(hasExplicitTopLevelPartStructure(text)).toBe(false);
  });
});

describe("shouldBlockPartAutoSave", () => {
  it("blocks when extracted populated parts are fewer than expected", () => {
    const result = shouldBlockPartAutoSave({
      expectedLabels: ["a", "b"],
      splitQuestion: new Map([["a", "Use mathematical induction and the result from part (a)."]]),
      splitMarkscheme: new Map(),
    });

    expect(result.block).toBe(true);
    expect(result.reason).toContain("expected 2");
  });

  it("allows when populated extracted labels match expected multipart labels", () => {
    const result = shouldBlockPartAutoSave({
      expectedLabels: ["a", "b"],
      splitQuestion: new Map([
        ["a", "Show that ..."],
        ["b", "Use mathematical induction ..."],
      ]),
      splitMarkscheme: new Map(),
    });

    expect(result).toEqual({ block: false, reason: null });
  });

  it("blocks unexpected extracted labels", () => {
    const result = shouldBlockPartAutoSave({
      expectedLabels: ["a", "b"],
      splitQuestion: new Map([
        ["a", "Show that ..."],
        ["c", "Unexpected third label"],
      ]),
      splitMarkscheme: new Map(),
    });

    expect(result.block).toBe(true);
    expect(result.reason).toContain("unexpected part label");
  });
});