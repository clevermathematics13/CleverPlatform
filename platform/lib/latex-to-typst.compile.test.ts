/**
 * latex-to-typst.compile.test.ts
 * -----------------------------------------------------------------------------
 * The output contract, enforced against the real compiler.
 *
 * latex-to-typst.ts promises that everything it returns is Typst math that
 * evaluates. That promise cannot be checked by reading the source, because
 * the failure it guards against is not a wrong-looking string -- it is
 * eval() raising "unknown variable" inside a document that has no try/catch,
 * which does not degrade one prompt but refuses to print the whole packet.
 * So every case here is compiled by @myriaddreamin/typst-ts-node-compiler,
 * the same binary that renders production PDFs.
 *
 * Three levels, because each one can fail while the one below it passes:
 *   1. the converted expression evaluates in math mode
 *   2. rich() routes a trusted span to eval() instead of printing it
 *   3. a whole draft of LaTeX prompts renders through the real orchestrator
 * -----------------------------------------------------------------------------
 */

import { describe, it, expect, beforeAll } from "vitest";
import { NodeCompiler } from "@myriaddreamin/typst-ts-node-compiler";
import { latexToTypst, convertLatexSegmentsToTypst } from "./latex-to-typst";
import { typstGateAccepts, spanIsForLatexConversion } from "./math-typesetting";
import { getActivityTypstSource, buildTypstPayload } from "./typst-render.service";
import { DocumentOrchestratorService } from "./document-orchestrator-nuanced";
import type { AssignmentDraft } from "./assignments";

let compiler: ReturnType<typeof NodeCompiler.create>;
let source: string;
let prelude: string;

beforeAll(() => {
  compiler = NodeCompiler.create();
  source = getActivityTypstSource();
  // Pull the live helpers out of the RENDERED template source rather than
  // duplicating them, exactly as typst-rich-inline-math.test.ts does, so this
  // keeps exercising whatever actually ships.
  const start = source.indexOf("#let math-idents");
  const richAt = source.indexOf("#let rich(s) = {");
  expect(start, "math-idents block missing from the rendered Typst source").toBeGreaterThan(-1);
  expect(richAt, "rich() missing from the rendered Typst source").toBeGreaterThan(-1);
  prelude = source.slice(start, source.indexOf("\n}", richAt) + 2);
});

/** Compiles one converted expression in math mode; returns the diagnostic. */
function mathError(typst: string): string {
  try {
    compiler.pdf({
      mainFileContent: `#set page(width: 400pt, height: 200pt)\n#eval(${JSON.stringify(typst)}, mode: "math")\n`,
    });
    return "";
  } catch (err) {
    return String((err as Error)?.message || err).replace(/\s+/g, " ").slice(0, 200);
  }
}

/**
 * The mathematics a Nuanced Analysis packet is actually made of.
 *
 * Grown from the trigonometry packet that prompted the switch to LaTeX
 * (Part 0: exact values, compound angles, odd and even functions, the
 * quotient and chain rules) and widened to the rest of the AA HL syllabus
 * and the Grade 9 Extended algebra the MYP packets cover.
 */
const PACKET_LATEX: string[] = [
  // Trigonometry -- the packet in the bug report.
  String.raw`\cos\left(\frac{3\pi}{2}\right)`,
  String.raw`\sin\left(\frac{3\pi}{2}\right)`,
  String.raw`\cos(\alpha + \beta) = \cos\alpha\cos\beta - \sin\alpha\sin\beta`,
  String.raw`f(-x) = -f(x) \text{ for all } x \in \mathbb{R}`,
  String.raw`\tan\theta = \frac{\sin\theta}{\cos\theta}, \quad \cos\theta \neq 0`,
  String.raw`\sin^2\theta + \cos^2\theta = 1`,
  String.raw`\theta = 30^\circ = \frac{\pi}{6}`,
  // Calculus.
  String.raw`f'(x) = \lim_{h \to 0} \frac{f(x+h) - f(x)}{h}`,
  String.raw`\frac{\mathrm{d}}{\mathrm{d}x}\left(\frac{\sin x}{x}\right)`,
  String.raw`\int_{0}^{\pi} \sin x \,\mathrm{d}x = 2`,
  String.raw`\frac{\partial f}{\partial x} + \frac{\partial f}{\partial y}`,
  String.raw`\frac{\mathrm{d}y}{\mathrm{d}x} = \frac{\mathrm{d}y}{\mathrm{d}u} \times \frac{\mathrm{d}u}{\mathrm{d}x}`,
  // Algebra.
  String.raw`x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}`,
  String.raw`(ax + b)(cx + d) = acx^2 + (ad + bc)x + bd`,
  String.raw`a^2 + 2ab + b^2 = (a+b)^2`,
  String.raw`\sqrt[3]{x^2 + 1}`,
  String.raw`\log_{2}(8) = 3`,
  String.raw`e^{i\pi} + 1 = 0`,
  // Sequences, series, binomials.
  String.raw`\sum_{k=1}^{n} k^2 = \frac{n(n+1)(2n+1)}{6}`,
  String.raw`\binom{n}{k} = \frac{n!}{k!\,(n-k)!}`,
  String.raw`S_\infty = \frac{a}{1 - r}, \quad |r| < 1`,
  String.raw`u_n = u_1 + (n-1)d`,
  // Vectors and matrices, in this platform's conventions.
  String.raw`\boldsymbol{a} \boldsymbol{\cdot} \boldsymbol{b} = |\boldsymbol{a}||\boldsymbol{b}|\cos\theta`,
  String.raw`\boldsymbol{r} = \begin{pmatrix} 1 \\ 2 \\ 3 \end{pmatrix} + \lambda \begin{pmatrix} 4 \\ 5 \\ 6 \end{pmatrix}`,
  String.raw`\left\| \boldsymbol{v} \right\| = \sqrt{v_1^2 + v_2^2}`,
  String.raw`\begin{bmatrix} a & b \\ c & d \end{bmatrix}`,
  String.raw`\det\begin{pmatrix} a & b \\ c & d \end{pmatrix} = ad - bc`,
  // Sets, logic, probability, statistics.
  String.raw`A \subseteq B \iff \forall x \in A,\; x \in B`,
  String.raw`P(A \cap B) = P(A) \times P(B \mid A)`,
  String.raw`\operatorname{Var}(X) = \operatorname{E}(X^2) - \left(\operatorname{E}(X)\right)^2`,
  String.raw`\bar{x} = \frac{1}{n}\sum_{i=1}^{n} x_i`,
  String.raw`\hat{y} = \alpha + \beta x`,
  String.raw`\mathbb{Z} \subset \mathbb{Q} \subset \mathbb{R} \subset \mathbb{C}`,
  // Piecewise, aligned working, floor and ceiling.
  String.raw`f(x) = \begin{cases} x^2 & x \geq 0 \\ -x & x < 0 \end{cases}`,
  String.raw`\begin{aligned} y &= mx + c \\ y - c &= mx \end{aligned}`,
  String.raw`\left\lfloor \frac{n}{2} \right\rfloor + \left\lceil \frac{n}{2} \right\rceil = n`,
  // Complex numbers.
  String.raw`z = r\left(\cos\theta + i\sin\theta\right)`,
  String.raw`\overline{z} = a - bi`,
  String.raw`|z_1 z_2| = |z_1| \, |z_2|`,
  // Modular arithmetic and inequalities.
  String.raw`x \equiv 3 \pmod 7`,
  String.raw`0 \leq x \leq 1 \text{ and } y \geq 2`,
  String.raw`\left| x - 3 \right| \leq 5`,
  // Grouping and accents that stress the parser.
  String.raw`{a+b}^2`,
  String.raw`\underbrace{a + a + a}_{3a} = 3a`,
  String.raw`\overrightarrow{AB} = \boldsymbol{b} - \boldsymbol{a}`,
  String.raw`\mathbf{A}^{-1}\mathbf{A} = \mathbf{I}`,
  String.raw`50\% \text{ of } n`,
];

describe("converted LaTeX compiles as Typst math", () => {
  it.each(PACKET_LATEX)("compiles: %s", (latex) => {
    const typst = latexToTypst(latex);
    expect(typst, `"${latex}" converted to nothing`).not.toBe("");
    expect(mathError(typst), `converted to: ${typst}`).toBe("");
  });

  it("compiles every case in one document too", () => {
    // One expression at a time proves each conversion; all of them in one
    // document proves they do not interfere -- an unbalanced bracket in one
    // would swallow the next.
    const body = PACKET_LATEX.map((l) => latexToTypst(l))
      .map((t) => `#eval(${JSON.stringify(t)}, mode: "math")\n\n`)
      .join("");
    expect(() =>
      compiler.pdf({ mainFileContent: `#set page(width: 500pt)\n${body}` }),
    ).not.toThrow();
  });
});

describe("rich() and the trusted-math channel", () => {
  /**
   * Hands `text` to rich() the way production does: as a JSON input the Typst
   * program decodes, never as a Typst string literal baked into the source.
   *
   * The distinction is not pedantry. The trusted-math marker is U+0001, and
   * JSON.stringify writes that as the six characters \u0001 -- which JSON
   * decodes back to the control character and Typst's OWN string literal
   * syntax does not, because Typst spells that escape \u{1}. Embedding the
   * string in the source would therefore hand rich() six literal characters,
   * no marker, and a silent pass through the legacy path -- a test that
   * proved nothing about the channel it is here to test.
   */
  function richDoc(text: string): { mainFileContent: string; inputs: Record<string, string> } {
    return {
      mainFileContent: `${prelude}\n#rich(json.decode(sys.inputs.at("t")))\n`,
      inputs: { t: JSON.stringify(text) },
    };
  }

  function richSvg(text: string): string {
    return compiler.svg(richDoc(text));
  }

  /** The glyph ids Typst uses to draw a literal dollar sign. */
  function dollarGlyphIds(): string[] {
    return [
      ...compiler.svg({ mainFileContent: `#"$"` }).matchAll(/<path[^>]*id="([^"]+)"/g),
    ].map((m) => m[1]);
  }

  it("typesets a trusted span instead of printing its source", () => {
    const svg = richSvg(convertLatexSegmentsToTypst(String.raw`Find $\frac{3\pi}{2}$ exactly.`));
    // The sentence survives.
    expect(svg).toContain("Find");
    // The Typst call that produced the fraction does not appear as text --
    // if rich() had printed the span literally, "frac" would be on the page.
    expect(svg).not.toContain(">f</");
    expect(svg).not.toContain("frac");
    expect(dollarGlyphIds().some((id) => svg.includes(id))).toBe(false);
  });

  it("still prints currency prose literally, dollar signs and all", () => {
    // The whole reason rich-legacy()'s identifier gate exists. Converting
    // LaTeX must not have opened a hole in it.
    const prose = "Pencils cost $2.50 per package and pens cost $3 per package.";
    const svg = richSvg(convertLatexSegmentsToTypst(prose));
    expect(dollarGlyphIds().some((id) => svg.includes(id))).toBe(true);
  });

  it("compiles a string that mixes trusted math, legacy math and prose", () => {
    const mixed = convertLatexSegmentsToTypst(
      String.raw`Let $\alpha$ be acute, let $theta$ be obtuse, and note the family has $210 to spend.`,
    );
    expect(() => compiler.pdf(richDoc(mixed))).not.toThrow();
  });

  it("compiles every packet expression through rich(), in a sentence", () => {
    for (const latex of PACKET_LATEX) {
      const line = convertLatexSegmentsToTypst(`Show that $${latex}$ holds.`);
      expect(() => compiler.pdf(richDoc(line)), `rich() failed on: ${latex}`).not.toThrow();
    }
  });
});

describe("the TS mirror of the Typst gate", () => {
  /**
   * typstGateAccepts() predicts, on this side of the wire, whether rich() will
   * evaluate a span or print it verbatim -- and spanIsForLatexConversion()
   * decides what to do about it. A mirror that drifts from the thing it
   * mirrors is worse than no mirror: it would route a span the Typst side
   * accepts through the LaTeX converter, and "a div b" would print "d i v".
   *
   * So the prediction is checked against the real prelude, by rendering the
   * span and looking for the dollar-sign glyph: a span the gate refused
   * reaches the page with its delimiters showing, and one it accepted does
   * not.
   */
  function richPrintsLiterally(span: string): boolean {
    const dollarIds = [
      ...compiler.svg({ mainFileContent: `#"$"` }).matchAll(/<path[^>]*id="([^"]+)"/g),
    ].map((m) => m[1]);
    const svg = compiler.svg({
      mainFileContent: `${prelude}\n#rich(json.decode(sys.inputs.at("t")))\n`,
      inputs: { t: JSON.stringify(`x $${span}$ y`) },
    });
    return dollarIds.some((id) => svg.includes(id));
  }

  it.each([
    // Accepted by the gate: legacy Typst that renders as written.
    "a div b := a times 1/b",
    "cos((3pi)/2)",
    "macron(x)",
    "x^2 - 9",
    "(x+3)(x-3)",
    "frac(1, 2)",
    "sqrt(2) + pi",
    "a^2+2a b+b^2",
    // Refused by the gate: LaTeX that needs no command, and one prose span.
    "A=ac",
    "Ax^2+Bx+C",
    "a^2+2ab+b^2",
    "6x^2+11x+3 = (2x+3)(3x+1)",
    "m1 = m2",
    "S3E11",
    "2.50 per package and pens cost ",
  ])("predicts what rich() does with: %s", (span) => {
    expect(typstGateAccepts(span)).toBe(!richPrintsLiterally(span));
  });

  it("routes a refused span to the converter unless it is prose", () => {
    // Refused AND mathematics -> convert, because the alternative is printing
    // "$A=ac$" on a student's page.
    expect(spanIsForLatexConversion("A=ac")).toBe(true);
    expect(spanIsForLatexConversion("a^2+2ab+b^2")).toBe(true);
    // Refused AND prose -> leave it, so rich() prints the sentence verbatim.
    expect(spanIsForLatexConversion("2.50 per package and pens cost ")).toBe(false);
    // Accepted -> leave it, whatever it looks like.
    expect(spanIsForLatexConversion("a div b := a times 1/b")).toBe(false);
    expect(spanIsForLatexConversion("cos((3pi)/2)")).toBe(false);
    // A backslash settles it before either question is asked.
    expect(spanIsForLatexConversion(String.raw`\frac{1}{2}`)).toBe(true);
  });
});

describe("prompt line breaks and the area model", () => {
  /** The words on the page, with the markup stripped out. */
  const svgText = (svg: string) => svg.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  /** Renders one question through the shipped template and returns the SVG. */
  function renderQuestion(q: Record<string, unknown>): string {
    const draft = {
      title: "T", subtitle: "S", instructions: ["Do it."],
      sections: [{ heading: "Part 0", questions: [{ marks: 2, tier: 1, ...q }] }],
    } as unknown as AssignmentDraft;
    const built = DocumentOrchestratorService.build(draft, undefined, {
      includeTeacherCompanion: false, includeAnswerKey: false,
    });
    if (!built.success) throw new Error(built.error);
    return compiler.svg({ mainFileContent: source, inputs: { payload: JSON.stringify(buildTypstPayload(built.payload)) } });
  }

  /**
   * How many separately laid-out text runs the page has. Typst emits one
   * text-selection div per run, so a prompt that breaks into more lines
   * produces more of them -- which is what "on its own line" means here.
   */
  const runs = (svg: string) => (svg.match(/class="tsel"/g) ?? []).length;

  it("puts each lettered part of a prompt on its own line", () => {
    // Run together in a paragraph, a student hunting for part (d) has to read
    // the whole thing. The prompt carries newlines; the page must keep them.
    const inline = renderQuestion({ prompt: "Write down each. (a) First item. (b) Second item. (c) Third item." });
    const listed = renderQuestion({ prompt: "Write down each.\n(a) First item.\n(b) Second item.\n(c) Third item." });
    expect(svgText(inline)).toContain("Third item");
    expect(svgText(listed)).toContain("Third item");
    // Same words, three newlines, three more lines on the page.
    expect(runs(listed)).toBe(runs(inline) + 3);
  });

  it("still renders a single-line prompt as one line", () => {
    const svg = renderQuestion({ prompt: String.raw`Find the value of $\frac{1}{2}$ exactly.` });
    expect(svg).toContain("Find");
    expect(svg).not.toContain("frac");
  });

  it("prints the area model with its labels and one cell per pairing", () => {
    const svg = renderQuestion({
      prompt: "Fill in the areas.",
      areaModel: {
        topLabels: [String.raw`$x$`, String.raw`$+2$`],
        sideLabels: [String.raw`$x$`, String.raw`$+3$`],
        caption: "Height x+3, width x+2.",
      },
    });
    expect(svg).toContain("Fill in the areas");
    expect(svg).toContain("Height");
    // Two columns by two rows is four cells, each drawn as its own rectangle
    // path; the figure is the only thing on this page that draws any.
    const rects = (svg.match(/<path class="typst-shape"/g) ?? []).length;
    expect(rects).toBeGreaterThanOrEqual(4);
  });

  it("draws the cells in proportion to their lengths when weights are given", () => {
    // A model with equal cells tells a student that 2 and 3 are the same
    // length. The unit is shared across both axes, so the x cell is square.
    const weighted = renderQuestion({
      prompt: "Fill in the areas.",
      areaModel: {
        topLabels: [String.raw`$x$`, String.raw`$+2$`],
        sideLabels: [String.raw`$x$`, String.raw`$+3$`],
        topWeights: [5, 2],
        sideWeights: [5, 3],
      },
    });
    // A cell is a closed rectangle path, "M 0 0 L 0 h L w h L w 0 Z".
    const sizes = [...weighted.matchAll(/M 0 0 L 0 ([\d.]+) L ([\d.]+) [\d.]+ L [\d.]+ 0 Z/g)]
      .map((m) => [Math.round(Number(m[2])), Math.round(Number(m[1]))] as const);
    const unique = [...new Set(sizes.map(([w, h]) => `${w}x${h}`))];
    // Four cells, and they are NOT all the same size.
    expect(sizes.length, `found ${sizes.length} cell rectangles`).toBeGreaterThanOrEqual(4);
    expect(unique.length, `every cell is the same size: ${unique.join(", ")}`).toBeGreaterThan(1);
    // The widest cell is wider than the narrowest by the ratio 5:2.
    const widths = [...new Set(sizes.map(([w]) => w))].sort((a, b) => a - b);
    const heights = [...new Set(sizes.map(([, h]) => h))].sort((a, b) => a - b);
    expect(widths[widths.length - 1] / widths[0]).toBeCloseTo(5 / 2, 1);
    expect(heights[heights.length - 1] / heights[0]).toBeCloseTo(5 / 3, 1);
  });

  it("draws nothing at all when the model has no labels", () => {
    // A half-specified figure must not print an empty box on a student's page.
    const svg = renderQuestion({ prompt: "No figure here.", areaModel: { topLabels: [], sideLabels: [] } });
    expect(svg).toContain("No figure here");
  });

  it("typesets a pre-filled cell as mathematics, not as its source", () => {
    const svg = renderQuestion({
      prompt: "Worked example.",
      areaModel: {
        topLabels: [String.raw`$x$`], sideLabels: [String.raw`$x$`],
        cells: [[String.raw`$x^2$`]],
      },
    });
    expect(svg).toContain("Worked example");
    const dollarIds = [
      ...compiler.svg({ mainFileContent: `#"$"` }).matchAll(/<path[^>]*id="([^"]+)"/g),
    ].map((m) => m[1]);
    expect(dollarIds.some((id) => svg.includes(id))).toBe(false);
  });
});

describe("a whole packet of LaTeX renders", () => {
  it("compiles a draft whose every field is LaTeX", () => {
    const draft = {
      title: String.raw`Exact Values and the Compound Angle Identity`,
      subtitle: "Nuanced Analysis Packet S3E11",
      course: "IBDP Mathematics AA HL",
      syllabusTopics: String.raw`Topic 3.5 -- exact values of $\sin\theta$ and $\cos\theta$`,
      prerequisites: String.raw`Exact values at multiples of $\frac{\pi}{2}$`,
      materials: "Pencil, ruler, GDC",
      atl: String.raw`You will move between $\theta$ in degrees and in radians.`,
      instructions: [String.raw`Give every answer exactly, not as a decimal.`],
      compulsoryCore: "Parts 0 to 2 are compulsory.",
      commandTerms: [
        { term: "Write down", definition: String.raw`State the value, e.g. $\frac{\sqrt{3}}{2}$, with no working.` },
      ],
      sections: [
        {
          heading: "Part 0 -- Activating Prior Knowledge",
          prerequisiteBox: {
            items: [String.raw`The compound angle identity for $\cos(\alpha + \beta)$`],
          },
          spotlight: {
            title: "Write down",
            body: String.raw`No working is expected: $\cos\left(\frac{3\pi}{2}\right) = 0$ is a complete answer.`,
          },
          questions: [
            {
              prompt: String.raw`Write down the exact value of $\cos\left(\frac{3\pi}{2}\right)$ and of $\sin\left(\frac{3\pi}{2}\right)$.`,
              marks: 2,
              hint: String.raw`Both lie on an axis of the unit circle.`,
              answer: String.raw`$\cos\left(\frac{3\pi}{2}\right) = 0$, $\sin\left(\frac{3\pi}{2}\right) = -1$`,
            },
            {
              prompt: String.raw`Write down the compound angle identity for $\cos(\alpha + \beta)$.`,
              marks: 1,
            },
            {
              prompt: String.raw`Hence find $\frac{\mathrm{d}}{\mathrm{d}x}\left(\frac{\sin x}{x}\right)$, stating the rule used.`,
              marks: 3,
            },
          ],
          translationTable: {
            caption: "What you say, and what you write",
            rows: [
              { informal: "cos of three pi over two", formal: String.raw`$\cos\left(\frac{3\pi}{2}\right)$` },
            ],
          },
          geometricReading: {
            body: String.raw`On the unit circle, $\frac{3\pi}{2}$ is the point $(0, -1)$.`,
          },
        },
      ],
      tokProvocations: [
        { id: "tok1", body: String.raw`Is $\pi$ discovered or invented?` },
      ],
      internationalMindedness: {
        body: String.raw`Madhava of Sangamagrama gave the series for $\arctan x$ two centuries before Gregory.`,
      },
      reflectionQuestions: [String.raw`Which identity did you reach for first, and why?`],
    } as unknown as AssignmentDraft;

    const built = DocumentOrchestratorService.build(draft, undefined, {
      includeTeacherCompanion: false,
      includeAnswerKey: true,
    });
    expect(built.success, built.success ? "" : `orchestrator: ${built.error}`).toBe(true);
    if (!built.success) return;

    const payload = JSON.stringify(buildTypstPayload(built.payload));
    const svg = compiler.svg({ mainFileContent: source, inputs: { payload } });

    // The prose is on the page.
    expect(svg).toContain("Write down");
    // The LaTeX is not: neither its commands nor the dollar signs that
    // delimited it. "frac" appearing as text would mean a span was printed
    // rather than typeset.
    expect(svg).not.toContain("frac");
    expect(svg).not.toContain("pi}");
    const dollarIds = [
      ...compiler.svg({ mainFileContent: `#"$"` }).matchAll(/<path[^>]*id="([^"]+)"/g),
    ].map((m) => m[1]);
    expect(dollarIds.some((id) => svg.includes(id))).toBe(false);
  });
});

describe("a two-character relation is one glyph, not two characters", () => {
  /** The glyphs Typst actually laid out, in order. */
  function glyphs(typst: string): string {
    const svg = compiler.svg({
      mainFileContent: `#set page(width: auto, height: auto, margin: 4pt)\n#eval(${JSON.stringify(typst)}, mode: "math")\n`,
    }) as string;
    return [...svg.matchAll(/<h5:div class="tsel"[^>]*>([\s\S]*?)<\/h5:div>/g)]
      .map((m) => m[1].replace(/<[^>]+>/g, ""))
      .join("");
  }

  // ":=" is the definitional symbol this whole course is built on -- A.2
  // defines subtraction and division as "a - b := a + (-b)" and
  // "a \div b := a \times \frac{1}{b}", and B.1 quotes both back. The
  // tokenizer used to hand ":" and "=" to the emitter separately, which put
  // a space through the middle: Typst sets ":=" as one ligature and ": ="
  // as a colon beside an equals sign.
  it.each([
    [String.raw`a - b := a + (-b)`, "≔"],
    [String.raw`a \div b := a \times \frac{1}{b}`, "≔"],
    [String.raw`x <= 3`, "≤"],
    [String.raw`x >= 3`, "≥"],
    [String.raw`a != b`, "≠"],
  ])("sets %s with %s", (latex, glyph) => {
    const out = glyphs(latexToTypst(latex));
    expect(out).toContain(glyph);
    // And the halves are not ALSO on the page beside the ligature.
    expect(out).not.toMatch(/:\s*=/);
  });

  it("still keeps a comma its own token inside a call", () => {
    // The pair rule must not start swallowing characters that have to stay
    // apart; "f(1,2)" is a pair and Typst spaces it.
    expect(glyphs(latexToTypst("f(1,2)"))).toContain(",");
  });
});
