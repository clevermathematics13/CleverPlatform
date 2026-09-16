/**
 * math-typesetting.test.ts
 * -----------------------------------------------------------------------------
 * Every string in the "real packet prose" block below was lifted verbatim from
 * the printed B.4 packet ("Products of Linear Expressions", Grade 9 Extended,
 * 16 Sep 2026) -- twelve pages that contained zero dollar signs and embedded no
 * math font at all. They are the bug, not an approximation of it.
 *
 * The compile-safety block matters as much as the wrapping block. A span this
 * module creates is handed to `eval(..., mode: "math")` inside the Typst
 * prelude, and Typst has no try/catch: one prose word swallowed into a span
 * takes down the entire document, not just the question it appeared in.
 * -----------------------------------------------------------------------------
 */

import { describe, it, expect } from "vitest";
import { NodeCompiler } from "@myriaddreamin/typst-ts-node-compiler";
import { typesetMath, typesetDraftMath, findUntypesetMath } from "./math-typesetting";

/** Pulls the $...$ spans out of a result, for asserting on what got wrapped. */
function spans(s: string): string[] {
  const parts = s.split("$");
  return parts.filter((_, i) => i % 2 === 1);
}

describe("typesetMath — real packet prose", () => {
  it("wraps a superscripted identity and stops before the following prose", () => {
    const out = typesetMath(
      "The distributive property and the double-distribution proof of (a+b)(a+b) = a^2+2ab+b^2 from Unit A.3",
    );
    // "2ab" -> "2a b": the ab run is split, the 2 coefficient stays glued.
    expect(spans(out)).toEqual(["(a+b)(a+b) = a^2+2a b+b^2"]);
    expect(out).toContain("from Unit A.3");
  });

  it("wraps two separate expressions with prose between them", () => {
    const out = typesetMath("When you factor x^2 - 9 into (x+3)(x-3), have you discovered a hidden structure");
    expect(spans(out)).toEqual(["x^2 - 9", "(x+3)(x-3)"]);
    expect(out).toContain("into");
    expect(out).toContain("(x-3)$,"); // comma stays outside the span
  });

  it("wraps an expression with no caret, on the letter-bracket signal alone", () => {
    const out = typesetMath("The distributive property: a(b+c) = ab + ac, used to expand brackets.");
    // "ab" is split to "a b": Typst reads a multi-letter run as a variable
    // lookup and "unknown variable: ab" aborts the whole document.
    expect(spans(out)).toEqual(["a(b+c) = a b + a c"]);
    expect(out).toContain("used to expand brackets.");
  });

  it("leaves parenthesised list labels as labels", () => {
    const out = typesetMath("State the number of terms in each of the following expressions: (a) 5x^2, (b) x^2 + 3x.");
    expect(out).toContain("(a) ");
    expect(out).toContain("(b) ");
    expect(spans(out)).toEqual(["5x^2", "x^2 + 3x"]);
  });

  it("handles the general product and stops at the colon", () => {
    const out = typesetMath("when it goes from (x+3)(x+3) to (ax+b)(cx+d): the process stays fixed");
    // "ax" splits to "a x" for the same reason "ab" does.
    expect(spans(out)).toEqual(["(x+3)(x+3)", "(a x+b)(c x+d)"]);
    expect(out).toContain(": the process stays fixed");
  });

  it("does not swallow 'and' between two short algebraic products", () => {
    const out = typesetMath("the middle coefficient is ad+bc and the constant is bd.");
    expect(spans(out)).toEqual(["a d+b c"]);
    expect(out).toContain(" and the constant");
  });

  it("wraps a bracket being collected as a single quantity", () => {
    const out = typesetMath("a bracketed expression may be treated as a single quantity, e.g. collecting (x+4) like a term.");
    expect(spans(out)).toEqual(["(x+4)"]);
  });

  it("keeps a trailing full stop outside the span", () => {
    const out = typesetMath("expression 6x^2 + 11x + 3.");
    expect(out).toBe("expression $6x^2 + 11x + 3$.");
  });
});

describe("typesetMath — leaves prose alone", () => {
  it.each([
    "Give a result without justification.",
    "Explore a mathematical situation methodically, using numerical or algebraic evidence.",
    "Pencil, this packet, no calculator needed",
    "Part 0, Part 1, Part 2, and Q17-Q18 are compulsory for every student.",
    "Make clear the difference between two or more concepts or cases.",
    "This packet does NOT solve any equation.",
  ])("adds no delimiters to: %s", (prose) => {
    expect(typesetMath(prose)).toBe(prose);
  });

  it("does not mathematise a CCSS code", () => {
    expect(typesetMath("HSA.SSE.A.2 - rewrite by grouping")).not.toContain("$");
  });

  it("does not mathematise a section reference", () => {
    expect(typesetMath("the Prove-vs-Verify distinction from A.3.")).not.toContain("$");
  });
});

describe("typesetMath — already-delimited input", () => {
  it("passes a correctly delimited string through byte for byte", () => {
    const good = "Show that $(x+3)(x+3) = x^2 + 6x + 9$, naming the property used.";
    expect(typesetMath(good)).toBe(good);
  });

  it("is idempotent", () => {
    const once = typesetMath("Prove that (x+5)(x+2) = x^2 + 7x + 10, applying the property.");
    expect(typesetMath(once)).toBe(once);
  });

  it("touches nothing when dollar signs are unbalanced", () => {
    // Rule 11d: a stray currency dollar. Wrapping anything here risks pairing
    // it with a real delimiter elsewhere and aborting the compile.
    const risky = "Pencils cost $2.50 per package and x^2 pens cost 3 dollars.";
    expect(typesetMath(risky)).toBe(risky);
  });

  it("typesets only outside existing spans", () => {
    const out = typesetMath("Given $x^2$, find the factors of 6x^2 + 11x + 3.");
    expect(spans(out)).toEqual(["x^2", "6x^2 + 11x + 3"]);
  });
});

describe("typesetMath — whitespace and edge cases", () => {
  it("preserves newlines and repeated spaces", () => {
    const out = typesetMath("First line x^2\n\nSecond  line");
    expect(out).toContain("\n\n");
    expect(out).toContain("Second  line");
  });

  it.each(["", "   ", "\n"])("returns %p unchanged", (s) => {
    expect(typesetMath(s)).toBe(s);
  });

  it("handles a string that is nothing but an equation", () => {
    expect(typesetMath("x^2 + 5x + 6")).toBe("$x^2 + 5x + 6$");
  });
});

describe("compile safety — every span this module creates must compile", () => {
  const corpus = [
    "The distributive property and the double-distribution proof of (a+b)(a+b) = a^2+2ab+b^2 from Unit A.3",
    "When you factor x^2 - 9 into (x+3)(x-3), have you discovered a hidden structure",
    "The distributive property: a(b+c) = ab + ac, used to expand brackets.",
    "State the number of terms in each of the following expressions: (a) 5x^2, (b) x^2 + 3x, (c) x^2 - 9, (d) x^2 + 5x + 6.",
    "Prove that (ax+b)(cx+d) = ac x^2 + (ad+bc)x + bd for all values of a, b, c, d, x",
    "First distribute (x+3) over the whole bracket (x+3), giving x(x+3) + 3(x+3).",
    "Part 0's reactivation of (x+3)(x+3) = x^2+6x+9 via double distribution.",
    "Find the factors of 6x^2 + 11x + 3 using the following steps.",
    "Determine the expansion of (2x+3)(x+4), showing each application of the distributive property.",
    "worked extensively with expressions of the form x^2 plus a linear term plus a constant",
  ];

  // The authoritative check. A heuristic about which identifiers Typst
  // defines is a guess; handing the span to the shipped compiler is not.
  // `eval(..., mode: "math")` is exactly what rich() does at render time, so
  // a span that survives here survives in production.
  const compiler = NodeCompiler.create();
  function compiles(mathSrc: string): boolean {
    const escaped = mathSrc.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const src = `#set page(width: 400pt, height: 80pt)\n#let r = eval("${escaped}", mode: "math")\n#r`;
    try {
      return compiler.pdf({ mainFileContent: src }) != null;
    } catch {
      return false;
    }
  }

  it("sanity: the checker rejects what Typst really rejects", () => {
    expect(compiles("x^2 - 9")).toBe(true);
    expect(compiles("ab + ac")).toBe(false);
    expect(compiles("applying the")).toBe(false);
  });

  it.each(corpus)("every span compiles as Typst math: %s", (line) => {
    for (const span of spans(typesetMath(line))) {
      expect(compiles(span), `span "${span}" would abort the Typst compile`).toBe(true);
    }
  });

  it("produces balanced delimiters for every line in the corpus", () => {
    for (const line of corpus) {
      expect(typesetMath(line).split("$").length % 2, `unbalanced for: ${line}`).toBe(1);
    }
  });
});

describe("typesetDraftMath", () => {
  const draft = {
    title: "Products of Linear Expressions",
    prerequisites: "the double-distribution proof of (a+b)(a+b) = a^2+2ab+b^2 from Unit A.3",
    tokProvocations: [{ id: "tok1", body: "When you factor x^2 - 9 into (x+3)(x-3), have you discovered structure?" }],
    reflectionQuestions: ["Explain why 6x^2 + 11x + 3 factors the way it does."],
    sections: [
      {
        heading: "Part 1",
        prerequisiteBox: { items: ["The distributive property: a(b+c) = ab + ac."] },
        spotlight: { title: "Verify vs Prove", body: "Checking x^2 - 9 at one value is not a proof." },
        questions: [
          {
            prompt: "Show that (x+3)(x+3) = x^2 + 6x + 9, naming the property at each step.",
            marks: 4,
            contentTag: "HSA.SSE.A.2 - rewrite by grouping",
            hint: "First distribute (x+3) over the bracket.",
            answer: "x^2 + 6x + 9",
            subparts: [{ prompt: "State the value of ac.", marks: 1 }],
          },
        ],
      },
    ],
  };

  const out = typesetDraftMath(draft);

  it("typesets prompts, hints and answers", () => {
    const q = out.sections[0].questions[0];
    expect(q.prompt).toContain("$(x+3)(x+3) = x^2 + 6x + 9$");
    expect(q.hint).toContain("$(x+3)$");
    expect(q.answer).toBe("$x^2 + 6x + 9$");
  });

  it("leaves contentTag alone so CCSS codes survive", () => {
    expect(out.sections[0].questions[0].contentTag).toBe("HSA.SSE.A.2 - rewrite by grouping");
  });

  it("reaches boxes, spotlights, TOK bodies and reflection questions", () => {
    expect(out.prerequisites).toContain("$");
    expect(out.tokProvocations[0].body).toContain("$x^2 - 9$");
    expect(out.reflectionQuestions[0]).toContain("$6x^2 + 11x + 3$");
    expect(out.sections[0].prerequisiteBox.items[0]).toContain("$a(b+c) = a b + a c$");
    expect(out.sections[0].spotlight.body).toContain("$x^2 - 9$");
  });

  it("does not mutate the input draft", () => {
    expect(draft.sections[0].questions[0].prompt).toBe(
      "Show that (x+3)(x+3) = x^2 + 6x + 9, naming the property at each step.",
    );
  });

  it("is idempotent across a whole draft", () => {
    expect(typesetDraftMath(out)).toEqual(out);
  });
});

describe("findUntypesetMath", () => {
  it("flags a prompt whose mathematics is still bare", () => {
    const issues = findUntypesetMath({
      sections: [{ questions: [{ prompt: "Find the factors of 6x^2 + 11x + 3." }] }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("Part 1, Q1");
  });

  it("stays silent once the draft has been typeset", () => {
    const draft = { sections: [{ questions: [{ prompt: "Find the factors of 6x^2 + 11x + 3." }] }] };
    expect(findUntypesetMath(typesetDraftMath(draft))).toEqual([]);
  });

  it("returns nothing for a malformed draft rather than throwing", () => {
    expect(findUntypesetMath(null)).toEqual([]);
    expect(findUntypesetMath({ sections: "nope" })).toEqual([]);
  });
});
