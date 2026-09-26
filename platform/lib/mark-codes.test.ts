import { describe, expect, it } from "vitest";
import {
  isNMarkToken,
  isZeroValueToken,
  markTokenValue,
  parseMarkCodeGroup,
  summarizeSchemeMarks,
} from "./mark-codes";

// Every scheme below is invented for the test. Real IB mark scheme text
// never goes into this repository (it is public).

const tokens = (text: string) => parseMarkCodeGroup(text).map((c) => c.token);

describe("parseMarkCodeGroup", () => {
  it("splits codes that run together", () => {
    expect(tokens("M1A1")).toEqual(["M1", "A1"]);
    expect(tokens("(A1)(A1)")).toEqual(["(A1)", "(A1)"]);
    expect(tokens("(M1)A1")).toEqual(["(M1)", "A1"]);
    expect(tokens("A1A1A1")).toEqual(["A1", "A1", "A1"]);
  });

  it("reads each code of a spaced group, which parseMSTokens misses", () => {
    expect(tokens("M1 A1 A1")).toEqual(["M1", "A1", "A1"]);
  });

  it("values codes the IB way", () => {
    const [a2, ag, n2, implied] = parseMarkCodeGroup("A2 AG N2 (M1)");
    expect(a2).toMatchObject({ kind: "A", value: 2, implied: false });
    expect(ag).toMatchObject({ kind: "AG", value: 0 });
    expect(n2).toMatchObject({ kind: "N", value: 2 });
    expect(implied).toMatchObject({ kind: "M", value: 1, implied: true });
  });

  it("unwraps formatting a transcription may add", () => {
    expect(tokens("\\textbf{A1}\\quad N1")).toEqual(["A1", "N1"]);
  });

  it("accepts the ft some schemes glue to a code", () => {
    expect(tokens("A1ft")).toEqual(["A1", "ft"]);
  });

  it("ignores code-shaped letters inside words", () => {
    expect(tokens("AGAIN")).toEqual([]);
    expect(tokens("left")).toEqual([]);
    expect(tokens("RMA1")).toEqual([]);
    expect(tokens("A12")).toEqual([]);
  });
});

describe("markTokenValue", () => {
  it("is the sum of the token's codes", () => {
    expect(markTokenValue("A2")).toBe(2);
    expect(markTokenValue("(M1)")).toBe(1);
    expect(markTokenValue("M1A1")).toBe(2);
    expect(markTokenValue("(A1)(A1)")).toBe(2);
  });

  it("gives AG and FT nothing and an N mark its digit", () => {
    expect(markTokenValue("AG")).toBe(0);
    expect(markTokenValue("FT")).toBe(0);
    expect(markTokenValue("N2")).toBe(2);
  });

  it("keeps one mark per token for anything it does not recognise", () => {
    expect(markTokenValue("B1")).toBe(1);
    expect(markTokenValue("method")).toBe(1);
    expect(markTokenValue("")).toBe(1);
  });

  it("tells N and zero-value tokens apart", () => {
    expect(isNMarkToken("N2")).toBe(true);
    expect(isNMarkToken("A1")).toBe(false);
    expect(isNMarkToken("A1 N1")).toBe(false);
    expect(isZeroValueToken("AG")).toBe(true);
    expect(isZeroValueToken("M1")).toBe(false);
  });
});

describe("summarizeSchemeMarks", () => {
  it("totals a plain part and reads its stated marks", () => {
    const s = summarizeSchemeMarks(
      [
        "attempt to use the product rule \\hfill (M1)",
        "$f'(x) = 3x^2 e^x + x^3 e^x$ \\hfill A1",
        "\\hfill [2 marks]",
      ].join("\n")
    );
    expect(s.possibleTotals).toEqual([2]);
    expect(s.statedMarks).toEqual([2]);
    expect(s.statedTotal).toBeNull();
    expect(s.hasAlternatives).toBe(false);
  });

  it("keeps N marks out of the total", () => {
    const s = summarizeSchemeMarks("$p = 7$ \\hfill A1A1 N2\n\\hfill [2 marks]");
    expect(s.possibleTotals).toEqual([2]);
    expect(s.nTotal).toBe(2);
  });

  it("counts A2 as two and AG as nothing", () => {
    const s = summarizeSchemeMarks(
      ["correct shape \\hfill A2", "substituting \\hfill M1", "$= 12$ \\hfill AG"].join("\n")
    );
    expect(s.possibleTotals).toEqual([3]);
  });

  it("gives one route per METHOD", () => {
    const s = summarizeSchemeMarks(
      [
        "\\textbf{METHOD 1}",
        "using the cosine rule \\hfill M1",
        "$\\theta = 0.5$ \\hfill A1",
        "METHOD 2",
        "using the sine rule \\hfill M1A1",
        "\\hfill [2 marks]",
      ].join("\n")
    );
    expect(s.possibleTotals).toEqual([2]);
    expect(s.hasAlternatives).toBe(true);
  });

  it("expands EITHER / OR / THEN into routes", () => {
    const s = summarizeSchemeMarks(
      [
        "EITHER",
        "a first way \\hfill M1",
        "OR",
        "another way \\hfill M1",
        "THEN",
        "$k = 3$ \\hfill A1",
      ].join("\n")
    );
    expect(s.possibleTotals).toEqual([2]);
  });

  it("reports routes that disagree rather than hiding them", () => {
    const s = summarizeSchemeMarks(["METHOD 1", "\\hfill M1", "METHOD 2", "\\hfill M1A1"].join("\n"));
    expect(s.possibleTotals).toEqual([1, 2]);
  });

  it("lists line-end codes with no \\hfill as strays, but not Note references", () => {
    const s = summarizeSchemeMarks(
      ["$x = 3$ A1", "Note: Award A1 for a correct sketch.", "$y = 4$ \\hfill A1"].join("\n")
    );
    expect(s.strayCodes).toEqual(["A1"]);
    expect(s.possibleTotals).toEqual([1]);
  });

  it("separates a part's marks from the question total", () => {
    const s = summarizeSchemeMarks("$z = 2i$ \\hfill A1\n\\hfill [1 mark]\n\nTotal [7 marks]");
    expect(s.statedMarks).toEqual([1]);
    expect(s.statedTotal).toBe(7);
  });
});
