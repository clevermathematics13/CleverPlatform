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
 * The guard that stops it, `looks-like-math()`, then had the opposite defect:
 * it rejected genuine math too. A letter run is how algebra is written -- "ab"
 * and "ac" in $a(b+c)=ab+ac$, "ax"/"bx" in $ax^2+bx+c$, "pq" in
 * $x^2+(p+q)x+pq$ -- and Typst reads each as one unknown variable, so the
 * guard threw the whole string back as literal text. Dotted symbol paths went
 * the same way: "$a eq.not 0$" was read as the words "eq" and "not", even
 * though eq.not is precisely what rule 11b tells the generator to write. A
 * printed A.3 packet carried its dollar signs into eight of its questions and
 * spotlights because of it.
 *
 * These cases are real strings from nuanced_analyses content, including that
 * packet verbatim.
 * -----------------------------------------------------------------------------
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NodeCompiler } from "@myriaddreamin/typst-ts-node-compiler";
import { getActivityTypstSource, buildTypstPayload } from "./typst-render.service";
import { DocumentOrchestratorService } from "./document-orchestrator-nuanced";
import type { AssignmentDraft } from "./assignments";

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

/**
 * How many literal "$" glyphs the rendered output actually contains.
 *
 * "It compiled" is not the assertion that matters here: a segment that
 * degrades to literal text compiles perfectly happily and prints its
 * delimiters on the packet, which is the defect. Counting the glyph pins both
 * directions at once -- 0 for math that must typeset, exactly 2 for the
 * currency prose whose dollars must survive.
 */
const dollarGlyphIds = [
  ...compiler.svg({ mainFileContent: `#"$"` }).matchAll(/<path[^>]*id="([^"]+)"/g),
].map((m) => m[1]);

function dollarsIn(text: string): number {
  const svg = compiler.svg({
    mainFileContent: `${prelude}\n#rich(${JSON.stringify(text)})\n`,
  });
  return dollarGlyphIds.reduce(
    (n, id) => n + svg.split(`href="#${id}"`).length - 1,
    0
  );
}

/** The entries of a `#let <name> = (...)` table in the shipped prelude. */
function preludeTable(name: string): string[] {
  const at = prelude.indexOf(`#let ${name} = (`);
  expect(at, `${name} missing from the shipped prelude`).toBeGreaterThan(-1);
  return [...prelude.slice(at, prelude.indexOf("\n)", at)).matchAll(/"([^"]+)"/g)].map(
    (m) => m[1]
  );
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
    expect(dollarsIn("The line $2a + c = 19$ ok.")).toBe(0);
    expect(
      dollarsIn("Using the definition $a div b := a times 1/b$, calculate $12 div 4$ first.")
    ).toBe(0);
    expect(dollarsIn("Show $0 leq x$ and $a neq 0$ hold.")).toBe(0);
    expect(
      dollarsIn("Pencils cost $2.50 per package and pens cost $3 per package.")
    ).toBe(2);
  });
});

describe("rich() on products written as letter runs", () => {
  // Verbatim from the printed A.3 packet "Three Faces of a Quadratic", which
  // is where these were reported. Every one of them printed its dollar signs.
  it.each([
    [
      "distributive property, Q2",
      "Using the distributive property $a(b+c)=ab+ac$, calculate the expanded form of $4(2x+5)$.",
    ],
    [
      "area-model proof, Q5",
      "Prove that $a(b+c)=ab+ac$ is true for all real numbers $a$, $b$, $c$, using an area-model argument.",
    ],
    [
      "standard form, Part 5 spotlight",
      "A single quadratic can be written in standard form $ax^2+bx+c$, in factored form, or in vertex form $y=a(x-h)^2+k$, where $(h,k)$ is the vertex.",
    ],
    [
      "factoring, Part 4 spotlight",
      "Part 3 showed that $(x+p)(x+q)$ expands to $x^2+(p+q)x+pq$, so given $x^2+bx+c$ you search for $p$ and $q$.",
    ],
    ["spaced-out linear form", "Solve $ax + by = c$ for $y$."],
    ["a bare product", "The product $ab$ is positive."],
    ["capital letters naming a segment", "The side $AB = 5$ centimetres."],
  ])("typesets %s", (_label, text) => {
    expect(dollarsIn(text)).toBe(0);
  });

  // The other half of the same defect: a letter run inside prose that two
  // currency dollars fenced off must still keep its delimiters, so widening
  // the guard cannot be done by widening it to everything.
  it.each([
    ["a word between two prices", "tickets cost $5 and $10 today."],
    ["several words", "He buys w watermelons at $4.49 each and p pineapples at $5 each."],
    ["a price list", "Using ticket prices adult $7, child $5, buying whole numbers."],
  ])("leaves the dollars on currency prose: %s", (_label, text) => {
    expect(dollarsIn(text)).toBeGreaterThan(0);
  });
});

describe("rich() on Typst symbol paths", () => {
  // Rule 11b tells the generator to write these -- "lt.eq / gt.eq / eq.not for
  // <= >= !=" -- and the packet did. The identifier check saw the words "eq"
  // and "not" and rejected the lot.
  it.each([
    ["eq.not, the packet defect verbatim", "It can be arranged as $a x^2 + b x + c$ with $a eq.not 0$."],
    ["lt.eq and gt.eq", "Show $a lt.eq b$ and $b gt.eq c$ both hold."],
    ["plus.minus", "So $x = plus.minus sqrt(7)$ are the roots."],
    ["dot.op", "Compute $a dot.op b$ for the vectors given."],
    ["a chained modifier", "Then $p arrow.r.double q$ follows."],
  ])("typesets %s", (_label, text) => {
    expect(dollarsIn(text)).toBe(0);
  });

  it("every path in the table evaluates in math mode", () => {
    // The list is what stands between "$a eq.not 0$" and a literal dollar
    // sign, and an entry Typst does not define would abort the whole
    // document rather than degrade one segment. Neither can be checked by
    // reading it, so check it against the shipped compiler.
    const paths = preludeTable("math-symbol-paths");
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(compiles(`before $a ${path} b$ after`), `${path} does not evaluate`).toBe(true);
    }
  });

  it("never aborts on an identifier Typst spells differently", () => {
    // math-idents is matched case-insensitively so that "Delta" reads as the
    // Greek letter. That alone also waved through "Sin" and a lowercase "rr",
    // which Typst does not define -- and an eval of either took the whole
    // packet down. 103 of these 366 spellings used to abort the compile.
    const idents = preludeTable("math-idents");
    expect(idents.length).toBeGreaterThan(0);
    for (const name of idents) {
      for (const spelling of [
        name,
        name[0].toUpperCase() + name.slice(1),
        name.toUpperCase(),
      ]) {
        expect(compiles(`before $a ${spelling} b$ after`), `${spelling} aborts`).toBe(true);
      }
    }
  });
});

describe("rich() on geometry and measure vocabulary", () => {
  // Found by generating six real packets and counting the dollar signs in the
  // rendered PDFs: three of them printed 50 between them, with the model's
  // math perfectly well-formed. These words were left out of math-idents as
  // "ordinary English", which is true and beside the point -- a similar-
  // triangles packet writes "angle" in nearly every box, and a trigonometry
  // packet writes "degree" in nearly every question.
  it.each([
    ["degree, from the trigonometry packet", "Rotate the point through $45 degree$ about the origin."],
    ["angle and degree together", "In the diagram $angle A B C = 90 degree$."],
    ["triangle, from the similar-figures packet", "The triangles $triangle A B C$ and $triangle D E F$ are similar."],
    ["parallel", "Since $A B parallel C D$, the corresponding angles are equal."],
    ["perp", "The radius $O P perp A B$ at the point of contact."],
    ["square and circle", "The area of the $square$ is $s^2$ and of the $circle$ is $pi r^2$."],
  ])("typesets %s", (_label, text) => {
    expect(dollarsIn(text)).toBe(0);
  });

  // The words above are English as well as Typst, which is why they were left
  // out. Adding them cannot come at the cost of the currency guard.
  it("still leaves currency prose alone", () => {
    expect(dollarsIn("Pencils cost $2.50 per package and pens cost $3 per package.")).toBe(2);
    expect(dollarsIn("tickets cost $5 and $10 today.")).toBe(2);
  });
});

describe("rich() falls back one segment at a time", () => {
  it("keeps the math in a sentence that also carries a price", () => {
    // The fallback used to be per string: one currency dollar anywhere threw
    // away every equation beside it. Q5 printed "$a$", "$b$" and "$c$" as
    // literal text only because "$a(b+c)=ab+ac$" failed earlier in the prompt.
    expect(dollarsIn("Let $f(x)=2x$ and the price is $5")).toBe(1);
    expect(dollarsIn("it costs $5 and $10, so $x = 15$ holds.")).toBe(2);
  });

  it("prints an unclosed segment as written", () => {
    expect(compiles("unclosed $x + 1")).toBe(true);
    expect(dollarsIn("unclosed $x + 1")).toBe(1);
    expect(dollarsIn("the family has $210 to spend on tickets.")).toBe(1);
  });
});

describe("a whole packet rendered through the real template", () => {
  // rich() is reached from question prompts, hints and spotlights as well as
  // the header, and the defect was reported as a printed PDF rather than as a
  // failing helper. This renders the packet it was reported from -- shortened,
  // but with its strings unchanged -- through the orchestrator and the shipped
  // Typst program, and counts the dollar signs the teacher would have seen.
  // Before the fix this packet printed 22 of them.
  it("prints no dollar signs anywhere in the document", () => {
    const draft = {
      title: "Three Faces of a Quadratic",
      subtitle: "Nuanced Analysis Packet A.3",
      instructions: ["Complete all questions."],
      sections: [
        {
          heading: "Part 0 - Activating Prior Knowledge",
          spotlight: {
            title: "Recall before we build",
            body: "An expression is quadratic in x if it can be arranged as $a x^2 + b x + c$ with $a eq.not 0$.",
          },
          questions: [
            {
              prompt:
                "Using the distributive property $a(b+c)=ab+ac$, calculate the expanded form of $4(2x+5)$.",
              marks: 3,
            },
            {
              prompt:
                "Prove that $a(b+c)=ab+ac$ is true for all real numbers $a$, $b$, $c$.",
              marks: 6,
              hint: "The whole rectangle has area $a(b+c)$.",
            },
            {
              prompt:
                "A single quadratic is $ax^2+bx+c$, or $y=a(x-h)^2+k$ where $(h,k)$ is the vertex.",
              marks: 5,
            },
          ],
        },
      ],
    } as unknown as AssignmentDraft;

    const built = DocumentOrchestratorService.build(draft, undefined, {
      includeTeacherCompanion: false,
      includeAnswerKey: false,
    });
    if (!built.success) throw new Error(`orchestrator build failed: ${built.error}`);

    const svg = compiler.svg({
      mainFileContent: getActivityTypstSource(),
      inputs: { payload: JSON.stringify(buildTypstPayload(built.payload)) },
    });
    const printed = dollarGlyphIds.reduce(
      (n, id) => n + svg.split(`href="#${id}"`).length - 1,
      0
    );
    expect(printed).toBe(0);
  });
});
