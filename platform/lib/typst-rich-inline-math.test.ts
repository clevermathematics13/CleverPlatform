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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NodeCompiler } from "@myriaddreamin/typst-ts-node-compiler";

/**
 * Pull the live helper out of the service source rather than duplicating it,
 * so this test keeps exercising whatever actually ships.
 *
 * The Typst source lives inside a JS template literal, so the raw file bytes
 * carry one extra level of backslash escaping (e.g. \\\\b on disk is \\b at
 * runtime). Decode that level here so the compiler sees the exact string the
 * service passes it — without this, any regex escape in the prelude tests a
 * different program than the one that ships.
 */
function shippedPrelude(): string {
  const src = readFileSync(
    join(process.cwd(), "lib", "typst-render.service.ts"),
    "utf8"
  );
  const start = src.indexOf("#let math-idents");
  const richAt = src.indexOf("#let rich(s) = {");
  expect(start, "math-idents block missing from typst-render.service.ts").toBeGreaterThan(-1);
  expect(richAt, "rich() missing from typst-render.service.ts").toBeGreaterThan(-1);
  return src
    .slice(start, src.indexOf("\n}", richAt) + 2)
    .replace(/\\(.)/g, "$1");
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
