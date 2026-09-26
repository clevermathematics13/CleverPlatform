import { describe, it, expect } from "vitest";
import { mathSpans, plainText, proseHtml, proseOnly, splitMathText } from "./math-text";

describe("splitMathText", () => {
  it("splits prose, inline maths and display maths in order", () => {
    expect(splitMathText("Solve $2x = 6$ to get $$x = 3$$ done")).toEqual([
      { kind: "text", text: "Solve " },
      { kind: "inline", tex: "2x = 6" },
      { kind: "text", text: " to get " },
      { kind: "display", tex: "x = 3" },
      { kind: "text", text: " done" },
    ]);
  });

  it("reads \\$ as a dollar sign, never a delimiter", () => {
    expect(splitMathText("It costs \\$32 for each adult, so $32a$ dollars.")).toEqual([
      { kind: "text", text: "It costs $32 for each adult, so " },
      { kind: "inline", tex: "32a" },
      { kind: "text", text: " dollars." },
    ]);
  });

  it("keeps a bare price as prose: inline maths may not open or close on a space", () => {
    expect(splitMathText("Adults pay $28 and children $16.")).toEqual([
      { kind: "text", text: "Adults pay $28 and children $16." },
    ]);
  });

  it("does not let one missing dollar swallow the next line", () => {
    const segs = splitMathText("Take $x\nand $y$ here");
    expect(segs.filter((s) => s.kind === "inline")).toEqual([{ kind: "inline", tex: "y" }]);
  });

  it("lets display maths run across lines, and a \\$ inside maths is part of it", () => {
    expect(mathSpans("$$\\begin{aligned} a &= 1 \\\\\n b &= 2 \\end{aligned}$$")).toEqual([
      { tex: "\\begin{aligned} a &= 1 \\\\\n b &= 2 \\end{aligned}", display: true },
    ]);
    expect(mathSpans("$\\$32 \\times a$")).toEqual([{ tex: "\\$32 \\times a", display: false }]);
  });

  it("treats an unclosed delimiter as prose", () => {
    expect(splitMathText("50$ of it")).toEqual([{ kind: "text", text: "50$ of it" }]);
    expect(splitMathText("$$ open")).toEqual([{ kind: "text", text: "$$ open" }]);
  });
});

describe("proseOnly / plainText", () => {
  it("reads only the prose, so a letter beside a digit in maths is not a word", () => {
    expect(proseOnly("Award $A1$ here")).not.toContain("A1");
    expect(proseOnly("Award A1 here")).toContain("A1");
  });

  it("gives words a screen reader can read", () => {
    expect(plainText("The **answer** is $x = 5$.")).toBe("The answer is x = 5.");
  });
});

describe("proseHtml", () => {
  it("escapes everything, then makes **pairs** bold and keeps line breaks", () => {
    expect(proseHtml("<b>x</b> & **bold** **")).toBe("&lt;b&gt;x&lt;/b&gt; &amp; <strong>bold</strong> **");
    expect(proseHtml("one\ntwo")).toBe("one<br/>two");
  });
});
