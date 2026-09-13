import { describe, expect, it } from "vitest";
import { canonicalTariff, normaliseTariffs, splitHfillMark } from "@/lib/latex-hfill";

describe("splitHfillMark", () => {
  it("splits the usual spaced form", () => {
    const { before, mark } = splitHfillMark("giving your answer in exact form. \\hfill [5]");
    expect(before).toBe("giving your answer in exact form. ");
    expect(mark).toBe("[5]");
  });

  // The regression this module exists for: the old fixed slice(idx + 7)
  // skipped the command plus one character, so with no space the "[" was
  // eaten and question 5 of the 27AH set rendered its tariff as "6]".
  it("keeps the opening bracket when no space follows the command", () => {
    expect(splitHfillMark("\\hfill[6]").mark).toBe("[6]");
    expect(splitHfillMark("show that ...\\hfill[6]").before).toBe("show that ...");
  });

  it("handles several spaces after the command", () => {
    expect(splitHfillMark("text \\hfill    [3]").mark).toBe("[3]");
  });

  it("returns null and the line untouched when there is no hfill", () => {
    const line = "Find the exact value of the integral.";
    expect(splitHfillMark(line)).toEqual({ before: line, mark: null });
  });

  it("splits at the first hfill, since a line carries at most one mark", () => {
    expect(splitHfillMark("a \\hfill [1] b \\hfill [2]").mark).toBe("[1] b \\hfill [2]");
  });

  it("ignores a longer control word that merely starts with hfill", () => {
    const line = "\\hfilling [2]";
    expect(splitHfillMark(line)).toEqual({ before: line, mark: null });
  });

  it("works for markscheme codes, not just bracketed tariffs", () => {
    expect(splitHfillMark("$x=2$ \\hfill (A1)").mark).toBe("(A1)");
  });
});

describe("canonicalTariff", () => {
  it("emits the spaced bracketed form the renderer lays out correctly", () => {
    expect(canonicalTariff(6)).toBe("\\hfill [6]");
  });

  it("round-trips through the splitter", () => {
    expect(splitHfillMark(`text ${canonicalTariff(4)}`).mark).toBe("[4]");
  });
});

describe("normaliseTariffs", () => {
  it("leaves an already-canonical tariff untouched", () => {
    const src = "Find the exact value. \\hfill [5]";
    expect(normaliseTariffs(src)).toBe(src);
  });

  it("adds a space to the no-space form", () => {
    expect(normaliseTariffs("\\hfill[6]")).toBe("\\hfill [6]");
  });

  it("right-aligns a bare tariff at the end of a line", () => {
    expect(normaliseTariffs("Find the total area of these two regions. [3]")).toBe(
      "Find the total area of these two regions. \\hfill [3]"
    );
  });

  it("right-aligns a tariff sitting alone on its own line", () => {
    const src = ["show that", "\\[", "\\int_0^a f(x)\\,dx = 0.", "\\]", "[3]"].join("\n");
    expect(normaliseTariffs(src).split("\n").at(-1)).toBe("\\hfill [3]");
  });

  it("right-aligns each tariff that closes an IBPart on a single-line question", () => {
    const src =
      "\\begin{IBPart}{(a)} Show that they meet at $(0,1)$. [2] \\end{IBPart} " +
      "\\begin{IBPart}{(b)} Find the area. [4] \\end{IBPart}";
    const out = normaliseTariffs(src);
    expect(out).toContain("meet at $(0,1)$. \\hfill [2] \\end{IBPart}");
    expect(out).toContain("Find the area. \\hfill [4] \\end{IBPart}");
  });

  // The reason tariffs are matched against a maths-masked copy of the line.
  it("never rewrites a bracket inside display maths", () => {
    const src = ["\\[", "x \\in [0,3]", "\\]"].join("\n");
    expect(normaliseTariffs(src)).toBe(src);
  });

  it("never rewrites a bracket inside inline maths at the end of a line", () => {
    const src = "The domain is $[0,3]$";
    expect(normaliseTariffs(src)).toBe(src);
  });

  it("leaves an inline display pair on the same line alone", () => {
    const src = "Consider \\[ y = e^{-x}, \\] and let $p > 0$. [2]";
    expect(normaliseTariffs(src)).toBe(
      "Consider \\[ y = e^{-x}, \\] and let $p > 0$. \\hfill [2]"
    );
  });

  it("is idempotent", () => {
    const src = ["Find the area. [3]", "", "\\begin{IBPart}{(b)} Hence find $k$. [2] \\end{IBPart}"].join("\n");
    const once = normaliseTariffs(src);
    expect(normaliseTariffs(once)).toBe(once);
  });
});
