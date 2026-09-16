/**
 * latex-to-typst.test.ts
 * -----------------------------------------------------------------------------
 * What the converter produces, as source. Its companion,
 * latex-to-typst.compile.test.ts, checks that the same output actually
 * compiles against the shipped Typst binary -- the two together are the
 * output contract described in latex-to-typst.ts's header.
 *
 * The cases are the mathematics an IBDP AA HL / Grade 9 Extended packet
 * genuinely contains, not a tour of LaTeX: exact trigonometric values,
 * compound angle identities, differentiation from first principles, vectors,
 * sigma notation, piecewise definitions.
 * -----------------------------------------------------------------------------
 */

import { describe, it, expect } from "vitest";
import {
  latexToTypst,
  latexToTypstVerbose,
  isLatexMath,
  convertLatexSegmentsToTypst,
  TRUSTED_MATH_DELIM,
} from "./latex-to-typst";

describe("latexToTypst", () => {
  it.each([
    // The packet that prompted all of this: Part 0 of the trigonometry NA,
    // whose prompts read "$cos((3pi)/2)$" before the switch to LaTeX.
    [String.raw`\cos\left(\frac{3\pi}{2}\right)`, "cos lr(( frac(3 pi, 2) ))"],
    [String.raw`\cos(\alpha + \beta)`, "cos ( alpha + beta )"],
    [String.raw`f(-x) = -f(x)`, "f ( - x ) = - f ( x )"],

    // Structure.
    [String.raw`\frac{a}{b}`, "frac(a, b)"],
    [String.raw`\dfrac{1}{2}`, "display(frac(1, 2))"],
    [String.raw`\sqrt{x + 1}`, "sqrt(x + 1)"],
    [String.raw`\sqrt[3]{8}`, "root(3, 8)"],
    [String.raw`\binom{n}{k}`, "binom(n, k)"],
    [String.raw`\frac{\frac{1}{2}}{3}`, "frac(frac(1, 2), 3)"],

    // Attachment.
    [String.raw`x^2`, "x^(2)"],
    [String.raw`x_{i+1}`, "x_(i + 1)"],
    [String.raw`\sum_{k=1}^{n} k`, "sum_(k = 1)^(n) k"],
    [String.raw`\int_{0}^{1} x \, \mathrm{d}x`, "integral_(0)^(1) x thin upright(d) x"],
    [String.raw`\lim_{h \to 0}`, "lim_(h arrow.r 0)"],
    [String.raw`30^\circ`, "30^(degree)"],

    // Named operators and text.
    [String.raw`\operatorname{Var}(X)`, 'op("Var") ( X )'],
    [String.raw`\text{if } x > 0`, '"if" x > 0'],
    [String.raw`\mathbb{R} \setminus \{0\}`, "RR without { 0 }"],

    // Vectors, per the platform's conventions in AGENTS.md.
    [String.raw`\boldsymbol{a} \boldsymbol{\cdot} \boldsymbol{b}`, "bold(a) bold(dot.op) bold(b)"],
    [String.raw`\begin{pmatrix} 1 \\ 2 \end{pmatrix}`, "mat(1; 2)"],
    [String.raw`\begin{bmatrix} 1 & 0 \\ 0 & 1 \end{bmatrix}`, 'mat(delim: "[", 1, 0; 0, 1)'],

    // Sized delimiters map to the Typst function where one exists.
    [String.raw`\left| x - 3 \right|`, "abs(x - 3)"],
    [String.raw`\left\| \boldsymbol{v} \right\|`, "norm(bold(v))"],
    [String.raw`\left\lfloor \frac{n}{2} \right\rfloor`, "floor(frac(n, 2))"],
  ])("converts %s", (latex, expected) => {
    expect(latexToTypst(latex)).toBe(expected);
  });

  it("splits a juxtaposed product into separate letters", () => {
    // The single most important rule in the module: Typst reads "ab" as a
    // variable named ab, which does not exist, and an unknown variable aborts
    // the whole document rather than degrading.
    expect(latexToTypst(String.raw`2ab + cd`)).toBe("2 a b + c d");
    expect(latexToTypst(String.raw`\sqrt{b^2 - 4ac}`)).toBe("sqrt(b^(2) - 4 a c)");
  });

  it("attaches a script to a brace group without inventing brackets", () => {
    // {a+b}^2 has no brackets on the page in LaTeX, so it must not gain a
    // pair on the way to Typst. attach() takes its base as an argument.
    expect(latexToTypst(String.raw`{a+b}^2`)).toBe("attach(a + b, t: 2)");
    // \left(...\right)^2 DOES draw brackets, and keeps them.
    expect(latexToTypst(String.raw`\left(a+b\right)^2`)).toBe("lr(( a + b ))^(2)");
  });

  it("keeps the alignment ampersand in cases and aligned", () => {
    expect(latexToTypst(String.raw`\begin{cases} x & x \geq 0 \\ -x & x < 0 \end{cases}`)).toBe(
      "cases(x & quad x gt.eq 0, - x & quad x < 0)",
    );
    expect(latexToTypst(String.raw`\begin{aligned} y &= 2x \\ 0 &= 2x - y \end{aligned}`)).toBe(
      "y & = 2 x \\ 0 & = 2 x - y",
    );
  });

  it("accepts \\cr as a row break, because JSON eats a doubled backslash", () => {
    // A LaTeX row break is two backslashes, which is FOUR inside a JSON
    // string. A model that writes only two produces a single backslash, and
    // the row break is gone. \cr needs one backslash and survives.
    expect(latexToTypst(String.raw`\begin{pmatrix} 1 \cr 2 \end{pmatrix}`)).toBe("mat(1; 2)");
  });

  it("drops presentation commands that have no Typst counterpart", () => {
    expect(latexToTypst(String.raw`\displaystyle\frac{1}{2}`)).toBe("frac(1, 2)");
    expect(latexToTypst(String.raw`\textcolor{red}{x}`)).toBe("x");
  });

  it("shows an unknown command rather than deleting it", () => {
    // A silent deletion is a wrong question nobody can see. Upright text in
    // the PDF is a wrong question a teacher catches while proof-reading.
    const { typst, unknown } = latexToTypstVerbose(String.raw`\notacommand{x}`);
    expect(typst).toContain('"notacommand"');
    expect(unknown).toContain("notacommand");
  });

  it("survives unbalanced braces without losing the rest of the expression", () => {
    expect(latexToTypst(String.raw`\frac{1}{2`)).toBe("frac(1, 2)");
    expect(latexToTypst(String.raw`x^2}`)).toBe("x^(2)");
  });

  it("returns nothing for an empty expression", () => {
    expect(latexToTypst("")).toBe("");
    expect(latexToTypst("   ")).toBe("");
  });
});

describe("isLatexMath", () => {
  it("recognises LaTeX by its backslash, and nothing else", () => {
    expect(isLatexMath(String.raw`\frac{1}{2}`)).toBe(true);
    // Typst syntax, from a packet saved before the switch. It must NOT be
    // treated as LaTeX: "div" and "times" are Typst operator names, and
    // reading them as letter runs would print "d i v".
    expect(isLatexMath("a div b := a times 1/b")).toBe(false);
    expect(isLatexMath("cos((3pi)/2)")).toBe(false);
    expect(isLatexMath("2.50 per package and pens cost ")).toBe(false);
  });
});

describe("convertLatexSegmentsToTypst", () => {
  const D = TRUSTED_MATH_DELIM;

  it("converts a LaTeX span and marks it trusted", () => {
    expect(convertLatexSegmentsToTypst(String.raw`Find $\frac{1}{2}$ exactly.`)).toBe(
      `Find ${D}frac(1, 2)${D} exactly.`,
    );
  });

  it("leaves a legacy Typst span exactly as it was", () => {
    const legacy = "Compute $frac(1, 2)$ exactly.";
    expect(convertLatexSegmentsToTypst(legacy)).toBe(legacy);
  });

  it("leaves prose with unbalanced currency dollars alone", () => {
    const prose = "the family has $210 to spend on tickets.";
    expect(convertLatexSegmentsToTypst(prose)).toBe(prose);
  });

  it("leaves a currency pair alone rather than reading it as math", () => {
    const prose = "Pencils cost $2.50 per package and pens cost $3 per package.";
    expect(convertLatexSegmentsToTypst(prose)).toBe(prose);
  });

  it("handles several spans in one string, LaTeX and legacy side by side", () => {
    expect(
      convertLatexSegmentsToTypst(String.raw`Let $\alpha$ and $theta$ be angles.`),
    ).toBe(`Let ${D}alpha${D} and $theta$ be angles.`);
  });

  it("renders stray display math inline instead of as raw source", () => {
    // $$ is forbidden by rule 11b because it splits into two EMPTY math
    // segments with the expression stranded between them as prose. If one
    // arrives anyway, it still typesets.
    expect(convertLatexSegmentsToTypst(String.raw`So $$\frac{1}{2}$$ follows.`)).toBe(
      `So ${D}frac(1, 2)${D} follows.`,
    );
  });

  it("is idempotent", () => {
    const once = convertLatexSegmentsToTypst(String.raw`Find $\sqrt{2}$ and $x^2$.`);
    expect(convertLatexSegmentsToTypst(once)).toBe(once);
  });

  it("returns a string with no math untouched", () => {
    const plain = "Explain your reasoning in full sentences.";
    expect(convertLatexSegmentsToTypst(plain)).toBe(plain);
  });
});
