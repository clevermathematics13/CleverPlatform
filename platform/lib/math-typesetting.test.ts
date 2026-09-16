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
import { typesetMath, toTypstMath, typesetDraftMath, findUntypesetMath } from "./math-typesetting";

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

describe("generator-authored spans that Typst rejects (B.4 regeneration, 16 Sep 2026)", () => {
  // The second bug. These prompts came back WITH correct-looking delimiters
  // and still printed 84 literal dollar signs across 18 pages, because
  // rich()'s looks-like-math() rejects a segment containing a juxtaposed
  // product and then renders the whole string literally. Every string here
  // is lifted from that PDF's text layer.
  const fromPacket: [string, string][] = [
    ["perfect square", "In section A.3 you proved that $(a+b)(a+b) = a^2+2ab+b^2$ for every value of $a$ and $b$."],
    ["general product", "Find the expansion of $(ax+b)(cx+d)$ in terms of $a$, $b$, $c$ and $d$."],
    ["capital coefficients", "Give your answer in the form $A x^2+Bx+C$."],
    ["hint", "Hint: Distribute $(cx+d)$ over $ax$ first, then over $b$, then collect like terms."],
    ["international mindedness", "meets when $(a+b)(a+b)$ is expanded to $a^2+2ab+b^2$: Yang Hui organised the coefficients"],
    ["factoring in reverse", "reverse when it factors $x^2+8x+16$ as $(x+4)(x+4)$."],
    ["branch A", "Investigate whether every trinomial of the form $x^2+bx+c$, where $b$ and $c$ are integers, can be factored."],
  ];

  const compiler2 = NodeCompiler.create();
  function spanCompiles(mathSrc: string): boolean {
    const escaped = mathSrc.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    try {
      return compiler2.pdf({
        mainFileContent: `#set page(width: 400pt, height: 80pt)\n#let r = eval("${escaped}", mode: "math")\n#r`,
      }) != null;
    } catch {
      return false;
    }
  }

  it.each(fromPacket)("repairs the span so Typst accepts it: %s", (_label, line) => {
    for (const span of spans(typesetMath(line))) {
      expect(spanCompiles(span), `span "${span}" still aborts the compile`).toBe(true);
    }
  });

  it("splits the juxtaposed products that caused the fallback", () => {
    const out = typesetMath("proved that $(a+b)(a+b) = a^2+2ab+b^2$ holds.");
    expect(out).toBe("proved that $(a+b)(a+b) = a^2+2a b+b^2$ holds.");
  });

  it("repairs every span in a string, not just the first", () => {
    const out = typesetMath("Find the expansion of $(ax+b)(cx+d)$ in the form $A x^2+Bx+C$.");
    expect(spans(out)).toEqual(["(a x+b)(c x+d)", "A x^2+B x+C"]);
  });

  it("leaves the whole string alone when delimiters are unbalanced", () => {
    const risky = "Pencils cost $2.50 and the expansion is 2ab per pack.";
    expect(typesetMath(risky)).toBe(risky);
  });
});

describe("toTypstMath leaves valid generator math untouched", () => {
  // If the inside-span pass were not a no-op on correct math, it would
  // silently damage every packet that was already right. These are the exact
  // forms the 11b MATH rule asks for, and the cases typst-rich-inline-math
  // already guards at the Typst end.
  it.each([
    "a div b := a times 1/b",
    "macron(x)",
    "sqrt(2) + pi",
    "sin(x) + cos(x)",
    "frac(1, 2)",
    "x = plus.minus sqrt(7)",
    "0 lt.eq x",
    "a eq.not 0",
    "x in RR",
    "sum_(k=1)^n k",
    "2a + c = 19",
    "alpha + beta = gamma",
  ])("is a no-op on: %s", (valid) => {
    expect(toTypstMath(valid)).toBe(valid);
  });

  it("keeps a quoted operator whole", () => {
    // Splitting inside the quotes would yield "V a r" on the printed page.
    expect(toTypstMath('"Var"(X) = sigma^2')).toBe('"Var"(X) = sigma^2');
  });

  it("keeps dotted symbol names whole", () => {
    // "lt" and "eq" are not identifiers on their own; splitting the dotted
    // name would produce "l t.e q" and abort the compile.
    expect(toTypstMath("arrow.r.double")).toBe("arrow.r.double");
    expect(toTypstMath("plus.minus")).toBe("plus.minus");
  });

  it("still rewrites LaTeX-habit names to real Typst symbols", () => {
    expect(toTypstMath("x leq 5")).toBe("x lt.eq 5");
    expect(toTypstMath("a neq 0")).toBe("a eq.not 0");
  });

  it("is idempotent on generator spans", () => {
    const once = typesetMath("expand $(ax+b)(cx+d)$ fully.");
    expect(typesetMath(once)).toBe(once);
  });
});

describe("scope-and-sequence references stay out of the mathematics", () => {
  // Shipped defect: the B.4 prerequisites line printed "b^2(A.3)" with the A
  // set in math italic, because a lone capital letter is NEUTRAL and the
  // equation beside it swallowed the citation. This course's packets cite each
  // other constantly, so the case is common, not exotic.
  it("does not absorb a trailing (A.3) into the span before it", () => {
    const out = typesetMath("used to prove (a+b)(a+b) = a^2+2ab+b^2 (A.3); the vocabulary term");
    expect(spans(out)).toEqual(["(a+b)(a+b) = a^2+2a b+b^2"]);
    expect(out).toContain(" (A.3); the vocabulary term");
  });

  it("does not let a leading A.3: start a span", () => {
    const out = typesetMath("the perfect square identity from A.3: (a+b)(a+b) = a^2+2ab+b^2");
    expect(spans(out)).toEqual(["(a+b)(a+b) = a^2+2a b+b^2"]);
    expect(out).toContain("from A.3: ");
  });

  it.each(["A.3", "(A.3)", "B.4", "(B.4)", "A.3.", "A.3;", "A.3:", "D.12"])(
    "treats %s as prose",
    (ref) => {
      expect(typesetMath(`see ${ref} for the proof of x^2+8x+16`)).toContain(`see ${ref} for`);
    },
  );

  it("still typesets the equation that follows a reference", () => {
    const out = typesetMath("proved in A.3. Using grouping, show that x^2+8x+16 factors.");
    expect(spans(out)).toEqual(["x^2+8x+16"]);
    expect(out).toContain("proved in A.3.");
  });

  it("leaves a CCSS code alone, which is the same shape with more letters", () => {
    expect(typesetMath("HSA.SSE.A.2 applies to x^2+5x+6")).toContain("HSA.SSE.A.2 applies to");
  });

  // The IBDP half of the same idea, and it failed harder than the MYP half.
  // "S3E11" has no two adjacent letters, so the prelude's looks-like-math()
  // -- which only inspects runs of two or more letters -- waved the span
  // through to eval(), where the whole code is ONE unknown variable. A packet
  // subtitled "Nuanced Analysis Packet S3E11" did not print at all.
  it.each(["S3E11", "(S3E11)", "S2E7", "S3E11.", "S3E11;"])(
    "treats the IBDP packet code %s as prose",
    (ref) => {
      expect(typesetMath(`continues ${ref} with x^2+8x+16`)).toContain(`continues ${ref} with`);
    },
  );

  it("keeps an IBDP packet code out of a subtitle entirely", () => {
    expect(typesetMath("Nuanced Analysis Packet S3E11")).toBe("Nuanced Analysis Packet S3E11");
  });
});

describe("prose the delimiters must not swallow", () => {
  // Both of these were shipped in the B.4 packet, and both came from the same
  // place: a signal that is unmistakably mathematical in an expression and
  // ordinary punctuation in a sentence.
  it("leaves an ordinal alone", () => {
    // Printed as "$12t h$": the digit glued to a letter read as mathematics,
    // then split into 12, t, h to survive Typst. A century is not a quantity.
    expect(typesetMath("Bhaskara II, working in the 12th century, studied quadratics")).toBe(
      "Bhaskara II, working in the 12th century, studied quadratics",
    );
    expect(typesetMath("the 1st, 2nd, 3rd and 21st terms")).toBe("the 1st, 2nd, 3rd and 21st terms");
  });

  it("leaves a slash between written words alone", () => {
    // "sum" and "product" are both names of Typst big operators, so "$sum/
    // product$" printed as a sigma over a pi in the prerequisite box.
    expect(typesetMath("the sum/product pattern: the middle coefficient is a sum")).toBe(
      "the sum/product pattern: the middle coefficient is a sum",
    );
    expect(typesetMath("state whether it is true and/or provable")).toBe(
      "state whether it is true and/or provable",
    );
    expect(typesetMath("a speed of 60 km/h")).toBe("a speed of 60 km/h");
  });

  it("still reads a slash between symbols as division", () => {
    expect(spans(typesetMath("Find x/y when x=6"))).toEqual(["x/y", "x=6"]);
    expect(spans(typesetMath("compute 3/4 of the total"))).toEqual(["3/4"]);
    expect(spans(typesetMath("the value of 2x/3"))).toEqual(["2x/3"]);
  });
});

describe("a letter glued to a digit is never left inside a span", () => {
  // Typst lexes "m1" as one identifier, and an unknown identifier aborts the
  // document rather than degrading -- so this is a compile failure, not a
  // cosmetic one. Only this direction matters: "6x" lexes as a number beside
  // a variable and must keep its spacing, or every quadratic in the course
  // changes shape.
  it.each([
    ["m1 = m2", "m 1 = m 2"],
    ["A1 + B2", "A 1 + B 2"],
    ["sigma1", "sigma 1"],
    ["x2 + y2", "x 2 + y 2"],
  ])("separates %s", (input, expected) => {
    expect(toTypstMath(input)).toBe(expected);
  });

  it.each(["6x^2 + 11x + 3", "2a + c = 19", "10x - 4"])(
    "leaves a digit-then-letter product exactly as written: %s",
    (expr) => {
      expect(toTypstMath(expr)).toBe(expr);
    },
  );
});
