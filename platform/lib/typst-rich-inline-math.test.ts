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

  // Genuine math must actually typeset, not silently fall back to literal
  // text -- "it compiled" alone would pass even if every segment degraded.
  it("typesets math instead of printing the dollar signs", () => {
    const dollarGlyphIds = [
      ...compiler.svg({ mainFileContent: `#"$"` }).matchAll(/<path[^>]*id="([^"]+)"/g),
    ].map((m) => m[1]);
    const svgOf = (t: string) =>
      compiler.svg({ mainFileContent: `${prelude}\n#rich(${JSON.stringify(t)})\n` });

    const mathSvg = svgOf("The line $2a + c = 19$ ok.");
    const proseSvg = svgOf("Pencils cost $2.50 per package and pens cost $3 per package.");

    expect(dollarGlyphIds.some((id) => mathSvg.includes(id))).toBe(false);
    expect(dollarGlyphIds.some((id) => proseSvg.includes(id))).toBe(true);
  });
});
