import { describe, it, expect } from "vitest";
import {
  packetUsesLatexDelimiters,
  renderRubricText,
  escapeHtml,
} from "./rubric-latex";

/**
 * The strings below are taken verbatim from live na_rubric_items rows. The
 * currency ones are the whole reason this module exists: A.2's prices come in
 * an even number, so a pair-matching parser reads the prose between them as
 * maths and rewrites a marking key that 22 scanned student copies are graded
 * against.
 */
const A1_CURRENCY = "(a) The price of one adult ticket, $60 per adult. (b) The number of adult tickets bought.";
const A2_CURRENCY_EVEN = "Chris buys p pairs of pants and 4 more shirts than pairs of pants. Shirts cost $18 each and pants cost $25 each.";
const A2_CURRENCY_EVEN_2 = "He buys w watermelons at $4.49 each and p pineapples at $5 each.";
const BINOMIAL_KEY = "Answer: $16x^4 - 96x^3 + 216x^2 - 216x + 81$ Mark scheme: (M1) for correct use of $\\binom{4}{r}$";
const BINOMIAL_KX = "In the expansion of $(1 + kx)^7$, the coefficient of $x^3$ is $280$.";
const BINOMIAL_TEXT_CMD = "'$(4+x)^{1/2} = 4^{1/2}(1+x)^{1/2}$, valid for $|x|<1$.'";

describe("packetUsesLatexDelimiters", () => {
  it("says yes for a packet with balanced $ and real LaTeX syntax", () => {
    expect(packetUsesLatexDelimiters([BINOMIAL_KEY, BINOMIAL_KX])).toBe(true);
  });

  it("says no when any field has an odd number of dollars", () => {
    // A.1: "$60 per adult" and nothing closing it.
    expect(packetUsesLatexDelimiters([A1_CURRENCY])).toBe(false);
    // Even one bad field disqualifies the packet, however much maths is elsewhere.
    expect(packetUsesLatexDelimiters([BINOMIAL_KEY, A1_CURRENCY])).toBe(false);
  });

  it("says no to balanced currency with no LaTeX syntax — the A.2 trap", () => {
    // Both have an EVEN number of dollars, so balance alone would pass them.
    expect(packetUsesLatexDelimiters([A2_CURRENCY_EVEN])).toBe(false);
    expect(packetUsesLatexDelimiters([A2_CURRENCY_EVEN_2])).toBe(false);
    expect(packetUsesLatexDelimiters([A2_CURRENCY_EVEN, A2_CURRENCY_EVEN_2])).toBe(false);
  });

  it("says no for a packet with no dollars at all", () => {
    expect(packetUsesLatexDelimiters(["Constant term: 9. Coefficients: -1, -10, -9."])).toBe(false);
  });

  it("ignores null and empty fields rather than throwing", () => {
    expect(packetUsesLatexDelimiters([null, undefined, "", BINOMIAL_KEY])).toBe(true);
  });

  it("does not count an escaped \\$ as a delimiter", () => {
    expect(packetUsesLatexDelimiters(["A price of \\$60 and $x^2$ of maths"])).toBe(true);
  });
});

describe("renderRubricText — currency packets are left alone", () => {
  it("emits A.2's price sentence unchanged apart from escaping", () => {
    const html = renderRubricText(A2_CURRENCY_EVEN, false);
    expect(html).toContain("Shirts cost $18 each and pants cost $25 each.");
    expect(html).not.toContain("katex");
  });

  it("never swallows the prose between two prices", () => {
    const html = renderRubricText(A2_CURRENCY_EVEN, false);
    for (const word of ["each", "and", "pants", "cost"]) {
      expect(html).toContain(word);
    }
  });

  it("escapes HTML in prose", () => {
    expect(renderRubricText('5 < 6 & "x" <b>', false)).toBe(
      "5 &lt; 6 &amp; &quot;x&quot; &lt;b&gt;"
    );
  });
});

describe("renderRubricText — maths packets render", () => {
  it("produces KaTeX markup for an inline span", () => {
    const html = renderRubricText("The value is $x^2 + 1$ exactly.", true);
    expect(html).toContain("katex");
    expect(html).toContain("The value is ");
    expect(html).toContain(" exactly.");
    // The raw source must not survive alongside the rendered output.
    expect(html).not.toContain("$x^2 + 1$");
  });

  it("renders every span in a multi-span answer key", () => {
    const html = renderRubricText(BINOMIAL_KEY, true);
    expect((html.match(/class="katex"/g) ?? []).length).toBe(2);
    expect(html).toContain("Mark scheme: (M1) for correct use of ");
  });

  it("renders coefficient forms like kx that a word-based rule would reject", () => {
    const html = renderRubricText(BINOMIAL_KX, true);
    expect((html.match(/class="katex"/g) ?? []).length).toBe(3);
  });

  it("handles \\text{} inside a span", () => {
    const html = renderRubricText("$(1 + (\\text{something}))^n$", true);
    expect(html).toContain("katex");
  });

  it("still escapes the prose around the maths", () => {
    const html = renderRubricText("if a < b then $x^2$ & done", true);
    expect(html).toContain("&lt;");
    expect(html).toContain("&amp;");
  });

  it("supports display delimiters", () => {
    expect(renderRubricText("$$x^2$$", true)).toContain("katex-display");
    expect(renderRubricText("\\[x^2\\]", true)).toContain("katex-display");
    expect(renderRubricText("\\(x^2\\)", true)).toContain("katex");
  });

  it("leaves an unclosed dollar as text instead of eating the field", () => {
    const html = renderRubricText("total $420 for the trip", true);
    expect(html).toContain("total $420 for the trip");
    expect(html).not.toContain("katex");
  });

  it("does not let an unclosed delimiter cross a newline", () => {
    const html = renderRubricText("cost $5\nnext line $6", true);
    expect(html).toContain("next line");
    expect(html).not.toContain("katex");
  });

  it("renders an escaped \\$ as a plain dollar sign", () => {
    expect(renderRubricText("costs \\$60", true)).toContain("costs $60");
  });

  it("is a no-op on text with no maths", () => {
    expect(renderRubricText("(a) 7. (b) 7. (c) 5. (d) 5.", true)).toBe("(a) 7. (b) 7. (c) 5. (d) 5.");
  });

  it("returns empty string for null, not 'null'", () => {
    expect(renderRubricText(null, true)).toBe("");
    expect(renderRubricText(undefined, false)).toBe("");
  });
});

describe("escapeHtml", () => {
  it("escapes the five characters that matter", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
  it("renders null and undefined as empty", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });
});
