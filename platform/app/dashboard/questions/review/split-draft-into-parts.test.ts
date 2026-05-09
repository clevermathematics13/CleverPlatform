import { describe, it, expect } from "vitest";
import { splitDraftIntoParts } from "./split-draft-into-parts";

// ── Question latex: Part A, BI, BII, C ──────────────────────────────────────

const Q1_DRAFT = `The function $f$ is defined by $f(x) = \\frac{ax + b}{cx + d}$.

\\begin{IBPart}
Find the inverse function $f^{-1}$, stating its domain.
\\hfill [5]
\\end{IBPart}

\\begin{IBPart}
The function $g$ is defined by $g(x) = \\frac{2x - 3}{x - 2}$.

(i) Express $g(x)$ in the form $A + \\frac{B}{x - 2}$.

(ii) Sketch the graph of $y = g(x)$. State the equations of any asymptotes.
\\hfill [5]
\\end{IBPart}

\\begin{IBPart}
The function $h$ is defined by $h(x) = \\sqrt{x}$, for $x \\geq 0$.

State the domain and range of $h \\circ g$.
\\hfill [4]
\\end{IBPart}`;

const Q1_LABELS = ["a", "bi", "bii", "c"];

describe("splitDraftIntoParts – Q1 (4 IBPart blocks, labels a bi bii c)", () => {
  const { stem, parts } = splitDraftIntoParts(Q1_DRAFT, Q1_LABELS);

  it("puts the preamble in the stem", () => {
    expect(stem).toContain("f(x) = \\frac{ax + b}{cx + d}");
  });

  it("part a contains inverse function text", () => {
    expect(parts.get("a")).toContain("inverse function");
  });

  it("part bi contains the g(x) intro and Express sub-part", () => {
    const bi = parts.get("bi") ?? "";
    expect(bi).toBeTruthy();
    expect(bi).toContain("Express");
  });

  it("part bii contains Sketch text (regression: was blank before fix)", () => {
    const bii = parts.get("bii") ?? "";
    expect(bii).toBeTruthy();
    expect(bii).toContain("Sketch");
  });

  it("part c contains h∘g text (regression: was blank before fix)", () => {
    const c = parts.get("c") ?? "";
    expect(c).toBeTruthy();
    expect(c).toContain("domain and range");
  });

  it("produces exactly 4 parts: a, bi, bii, c", () => {
    expect([...parts.keys()].sort()).toEqual(["a", "bi", "bii", "c"]);
  });
});

// ── Markscheme: IBPart blocks with no visible (i)/(ii) in some parts ─────────

const MS_DRAFT = `\\begin{IBPart}
(i) attempt to use quotient rule
\\hfill (M1)

(ii) $f'(x) = 0$
\\hfill A1
\\hfill [5 marks]
\\end{IBPart}

\\begin{IBPart}
(i) $(0, 4)$
\\hfill A1

(ii) $2x - 4 = 0$
\\hfill A1
\\hfill [5 marks]
\\end{IBPart}

\\begin{IBPart}
valid attempt to combine fractions
\\hfill M1
\\hfill [2 marks]
\\end{IBPart}

\\begin{IBPart}
$f(x) = 4 \\Rightarrow 2x - 4 = 4x^2 - 4$
\\hfill [7 marks]
\\end{IBPart}`;

const MS_LABELS = ["a", "bi", "bii", "c"];

describe("splitDraftIntoParts – markscheme (4 IBPart blocks, labels a bi bii c)", () => {
  const { parts } = splitDraftIntoParts(MS_DRAFT, MS_LABELS);

  it("produces parts for all 4 blocks", () => {
    expect(parts.size).toBe(4);
  });

  it("part c is not blank (regression)", () => {
    const c = parts.get("c") ?? "";
    expect(c).toBeTruthy();
    expect(c).toContain("f(x) = 4");
  });
});

// ── Plain-label fallback (no IBPart environment) ─────────────────────────────

const PLAIN_DRAFT = `The stem text.

(a) First part.

(b) (i) Sub-part one. (ii) Sub-part two.

(c) Third part.`;

describe("splitDraftIntoParts – plain (a)(b)(c) labels", () => {
  const { stem, parts } = splitDraftIntoParts(PLAIN_DRAFT, ["a", "bi", "bii", "c"]);

  it("extracts stem correctly", () => {
    expect(stem).toBe("The stem text.");
  });

  it("extracts part a", () => {
    expect(parts.get("a")).toContain("First part");
  });

  it("extracts part c", () => {
    expect(parts.get("c")).toContain("Third part");
  });
});
