/**
 * typst-rich-inline-math.test.ts
 * -----------------------------------------------------------------------------
 * Regression test for the `rich()` helper embedded in typst-render.service.ts.
 *
 * The bug: `rich()` splits a string on "$" and evaluates the odd-indexed
 * pieces with `eval(part, mode: "math")`. In Typst math a multi-letter run is
 * a variable lookup, so prose inside a fake "math" segment raises
 * "unknown variable: <word>" -- and because Typst has no try/catch, that
 * aborts the whole document. Two currency amounts in one sentence are enough
 * to trigger it, which is how "Pencils cost $2.50 per package and pens cost
 * $3 per package" took down /api/typst-render in production.
 *
 * These cases are real strings from nuanced_analyses content.
 * -----------------------------------------------------------------------------
 */

import { describe, it, expect } from "vitest";
import { NodeCompiler } from "@myriaddreamin/typst-ts-node-compiler";
import { getActivityTypstSource } from "./typst-render.service";

/**
 * Pull the live helper out of the RENDERED template source rather than
 * duplicating it, so this test keeps exercising whatever actually ships.
 *
 * This used to read the raw bytes of typst-render.service.ts and undo one
 * level of template-literal backslash escaping by hand. It cannot any more:
 * `math-idents` and `math-aliases` are now interpolated from the single
 * source of truth in math-typesetting.ts, so the bytes on disk contain a
 * `${...}` expression where the tuple used to be, and slicing them yields a
 * program that does not compile.
 *
 * Calling getActivityTypstSource() is the better test regardless — it is the
 * exact string handed to the compiler in production, escaping already
 * resolved, with no second-guessing of how many backslashes survive.
 */
function shippedPrelude(): string {
  const src = getActivityTypstSource();
  const start = src.indexOf("#let math-idents");
  const richAt = src.indexOf("#let rich(s) = {");
  expect(start, "math-idents block missing from the rendered Typst source").toBeGreaterThan(-1);
  expect(richAt, "rich() missing from the rendered Typst source").toBeGreaterThan(-1);
  return src.slice(start, src.indexOf("\n}", richAt) + 2);
}

const compiler = NodeCompiler.create();
const prelude = shippedPrelude();

function compiles(text: string): boolean {
  try {
    return !!compiler.pdf({
      mainFileContent: `${prelude}\n#rich(${JSON.stringify(text)})\n`,
    });
  } catch {
    return false;
  }
}

describe("rich() inline math", () => {
  // Currency dollars in prose must never abort the compile.
  it.each([
    ["two prices in one sentence", "Pencils cost $2.50 per package and pens cost $3 per package."],
    ["two prices, different words", "He buys w watermelons at $4.49 each and p pineapples at $5 each."],
    ["three prices", "Using ticket prices adult $7, child $5, buying whole numbers."],
    ["a single price", "the family has $210 to spend on tickets."],
    ["price pair whose only word is a math identifier", "tickets cost $5 and $10 today."],
  ])("renders prose with currency: %s", (_label, text) => {
    expect(compiles(text)).toBe(true);
  });

  // Genuine inline math must still compile.
  it.each([
    ["linear equation", "The line $2a + c = 19$ passes through."],
    ["function definition", "Let $f(x) = x^2 - 4x + 3$ be given."],
    ["greek and roots", "Use $sqrt(2) + pi$ and $theta$ here."],
    ["trig", "Show $sin(x) + cos(x)$ is bounded."],
    ["fraction", "Compute $frac(1, 2)$ exactly."],
  ])("still typesets real math: %s", (_label, text) => {
    expect(compiles(text)).toBe(true);
  });

  // Operator words the generator emits per its 11b MATH rule. These were
  // once excluded from math-idents as "overwhelmingly prose", which silently
  // degraded real equations to literal text — dollar signs and all — on a
  // printed student packet.
  it.each([
    [
      "div and times (the reported packet defect, verbatim)",
      "Using the definition $a div b := a times 1/b$, calculate $12 div 4$ by rewriting it as a multiplication first.",
    ],
    ["dot operator", "Compute $a dot b$ for the vectors given."],
    ["min and max", "State $max(2, 5) - min(2, 5)$ exactly."],
    ["set membership and number sets", "Suppose $x in RR$ and $n in NN$ throughout."],
    ["macron for a sample mean", "Let $macron(x)$ denote the sample mean."],
    ["quoted named operator", 'Then $"Var"(X) = sigma^2$ by definition.'],
    ["plus.minus", "So $x = plus.minus sqrt(7)$ are the roots."],
  ])("typesets operator-word math: %s", (_label, text) => {
    expect(compiles(text)).toBe(true);
  });

  // LaTeX-habit names Typst does not define must be rewritten to the real
  // symbol before eval, not passed through (compile abort) or rejected
  // (silent degradation to literal text).
  it.each([
    ["leq/geq", "Show $0 leq x$ and $x geq -1$ hold."],
    ["neq", "Assume $a neq 0$ from now on."],
    ["cdot", "Expand $2 cdot 3 cdot 5$ fully."],
    ["pm", "Hence $x = 4 pm sqrt(2)$ exactly."],
  ])("normalises LaTeX-habit operator names: %s", (_label, text) => {
    expect(compiles(text)).toBe(true);
  });

  // A letter glued to a digit is ONE identifier to Typst, and an unknown
  // identifier aborts the whole document. The identifier gate used to miss
  // these entirely: it looks for runs of two or more LETTERS, and "S3E11"
  // has none. A packet subtitled "Nuanced Analysis Packet S3E11" -- the DP
  // section-code format from api/nuanced-analyses/route.ts -- would not
  // print at all.
  it.each([
    ["an IBDP packet code", "Nuanced Analysis Packet $S3E11$ continues the thread."],
    ["a subscript written without an underscore", "Assume $m1 = m2$ throughout."],
    ["a labelled point", "Let $A1$ be the first vertex."],
  ])("refuses an alphanumeric identifier rather than aborting: %s", (_label, text) => {
    expect(compiles(text)).toBe(true);
  });

  // Genuine math must actually typeset, not silently fall back to literal
  // text -- "it compiled" alone would pass even if every segment degraded.
  it("typesets math instead of printing the dollar signs", () => {
    const dollarGlyphIds = [
      ...compiler.svg({ mainFileContent: `#"$"` }).matchAll(/<path[^>]*id="([^"]+)"/g),
    ].map((m) => m[1]);
    const svgOf = (t: string) =>
      compiler.svg({ mainFileContent: `${prelude}\n#rich(${JSON.stringify(t)})\n` });

    const mathSvg = svgOf("The line $2a + c = 19$ ok.");
    const divTimesSvg = svgOf(
      "Using the definition $a div b := a times 1/b$, calculate $12 div 4$ first."
    );
    const aliasSvg = svgOf("Show $0 leq x$ and $a neq 0$ hold.");
    const proseSvg = svgOf("Pencils cost $2.50 per package and pens cost $3 per package.");

    expect(dollarGlyphIds.some((id) => mathSvg.includes(id))).toBe(false);
    expect(dollarGlyphIds.some((id) => divTimesSvg.includes(id))).toBe(false);
    expect(dollarGlyphIds.some((id) => aliasSvg.includes(id))).toBe(false);
    expect(dollarGlyphIds.some((id) => proseSvg.includes(id))).toBe(true);
  });
});

describe("the escaped dollar, end to end", () => {
  // Written by escapeCurrencyDollars() in math-typesetting.ts. Compiling is
  // only half the claim -- the whole point is that the dollar reaches the page
  // and the backslash does not -- so these assert on the rendered text.
  const BACKSLASH = String.fromCharCode(92);

  /** The text the compiler actually laid out, in reading order. */
  function rendered(text: string): string {
    const svg = compiler.svg({
      mainFileContent: `${prelude}\n#rich(${JSON.stringify(text)})\n`,
    }) as string;
    return [...svg.matchAll(/<h5:div class="tsel"[^>]*>([\s\S]*?)<\/h5:div>/g)]
      .map((m) => m[1].replace(/<[^>]+>/g, ""))
      .join("")
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }

  it("prints a dollar sign and no backslash", () => {
    const out = rendered(`A family holding exactly ${BACKSLASH}$575 wants to spend all of it.`);
    expect(out).toContain("$575");
    expect(out).not.toContain(BACKSLASH);
  });

  it("prices the line AND typesets the expression on it", () => {
    // The A.1 case the escape exists for. Before it, one loose price made the
    // dollar count odd and this whole sentence printed as plain text.
    const out = rendered(
      `The situation: adults cost ${BACKSLASH}$60, children cost ${BACKSLASH}$30, ` +
        `total = $60a + 30c$.`,
    );
    expect(out).toContain("$60");
    expect(out).toContain("$30");
    expect(out).not.toContain(BACKSLASH);
    // Rendered as math, the juxtaposed product is spaced out by Typst; as
    // prose it would still read "60a". The space is the evidence.
    expect(out).toMatch(/60\s*𝑎/u);
  });

  it("still gives up gracefully on a span that is really prose", () => {
    const out = rendered("Pencils cost $2.50 per package and pens cost $3 per package.");
    expect(out).toContain("$2.50 per package");
    expect(out).not.toContain(BACKSLASH);
  });
});

describe("a dotted symbol path is one identifier", () => {
  // toTypstMath() expands the word "iff" to arrow.l.r.double, and the gate
  // then rejected the span for "double" -- so the polynomial packet's Factor
  // Theorem was typeset by this pipeline and refused by it, printing as its
  // own source code.
  it.each([
    ["iff, as the wrapper writes it", "Factor Theorem: $P(r)=0 arrow.l.r.double$ (x-r) is a factor."],
    ["implies", "If $x > 2 arrow.r.double x^2 > 4$ then done."],
    ["a two-part path", "The limit $x arrow.r 0$ is taken."],
  ])("evaluates %s", (_label, text) => {
    expect(compiles(text)).toBe(true);
  });

  it("does not let an unknown bare word through with it", () => {
    // The dotted rule must not become a hole in the gate: this still has to
    // be refused and printed verbatim rather than evaluated.
    expect(compiles("The value $2.50 per package arrow.r.double x$ is wrong.")).toBe(true);
  });
});
