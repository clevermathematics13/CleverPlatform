/**
 * A price is not a delimiter.
 *
 * "An art workshop charges $28 for each adult and $16 for each child" is a
 * sentence from Formative Assessment 1, a paper fifty students sat. The two
 * dollar signs paired, and KaTeX typeset "28 for each adult and" as an
 * expression. Money is everywhere in this unit's contexts, so this was never
 * going to be rare.
 *
 * Two rules fix it, and both are the ordinary ones: \$ is a literal dollar,
 * and inline maths may not open or close on whitespace.
 */
import { describe, it, expect } from "vitest";
import { renderMath } from "./document-orchestrator";

const isMath = (html: string) => html.includes('class="katex"');
const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("currency survives renderMath", () => {
  it("leaves two bare prices alone", () => {
    const out = renderMath("An art workshop charges $28 for each adult and $16 for each child.");
    expect(isMath(out)).toBe(false);
    expect(out).toContain("$28 for each adult and $16 for each child");
  });

  it("renders an escaped dollar as a dollar", () => {
    const out = renderMath("melons for \\$11 each and mangoes for \\$4 each");
    expect(isMath(out)).toBe(false);
    expect(out).toContain("$11 each and mangoes for $4 each");
  });

  it("does not let an escaped dollar open a span", () => {
    // The pathological case: an escaped dollar next to a real one.
    const out = renderMath("costs \\$5, and $x$ is the count");
    expect(out).toContain("$5,");
    expect(isMath(out)).toBe(true);
  });
});

describe("real mathematics still typesets", () => {
  it("handles fractions in an inline span", () => {
    const out = renderMath("Solve $\\frac{3}{5}(2x - 10) = \\frac{x}{2} + 1$.");
    expect(isMath(out)).toBe(true);
    expect(text(out)).not.toContain("\\frac{3}{5}(2x - 10) = \\frac{x}{2} + 1$");
  });

  it("handles two spans in one sentence", () => {
    const out = renderMath("Let $n$ be a real number with $n \\neq 0$.");
    expect((out.match(/class="katex"/g) ?? []).length).toBe(2);
  });

  it("still renders display maths, where spaces inside are fine", () => {
    expect(isMath(renderMath("$$ x = 5 $$"))).toBe(true);
  });

  it("leaves a span that opens on a space as prose", () => {
    expect(isMath(renderMath("from $ 5 to $ 10"))).toBe(false);
  });
});
