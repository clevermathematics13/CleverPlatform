/**
 * json-repair.test.ts
 * -----------------------------------------------------------------------------
 * The backslash is the whole problem. A Nuanced Analysis packet arrives as JSON
 * full of LaTeX, and in JSON a backslash escapes what follows it -- so every
 * "\frac" the model writes is, strictly read, an invalid escape, and every
 * intentional "\n" is indistinguishable from the start of "\neq".
 *
 * sanitizeJsonBackslashes has to pick a reading for each one, and both
 * readings are real: rule 11b of the generator prompt asks for \frac and \neq,
 * rule 6d asks for \n wherever a prompt needs a line break.
 * -----------------------------------------------------------------------------
 */

import { describe, it, expect } from "vitest";
import { sanitizeJsonBackslashes } from "./json-repair";

const BS = String.fromCharCode(92);

/** What JSON.parse makes of a repaired string value. */
function parsed(body: string): string {
  return JSON.parse(sanitizeJsonBackslashes(`{"p": "${body}"}`)).p as string;
}

describe("a line break survives, and a LaTeX command still does not", () => {
  // Every line break used to be destroyed here, and the literal backslash
  // left behind is the whole of isLatexMath()'s test -- so the prose either
  // side was then converted as mathematics. A generated B.5 printed
  // "without expanding any of them.\n(i)" as italic t-h-e-m-dot-n-bracket-i.
  it.each([
    ["before a bracket", `reads:${BS}n(x+2)(x+3)=12`, "reads:\n(x+2)(x+3)=12"],
    ["before a capital", `bundle.${BS}nWrite down`, "bundle.\nWrite down"],
    ["before math", `stem${BS}n$(x-5)(x+5)$`, "stem\n$(x-5)(x+5)$"],
    ["before a lower-case word", `first${BS}nsecond`, "first\nsecond"],
    ["as a blank line", `one${BS}n${BS}ntwo`, "one\n\ntwo"],
  ])("keeps a line break %s", (_label, body, expected) => {
    expect(parsed(body)).toBe(expected);
  });

  it.each(["neq", "nabla", "nu", "notin", "newline", "nleq", "ncong", "nexists"])(
    "keeps the backslash on the LaTeX command %s",
    (cmd) => {
      expect(parsed(`$a ${BS}${cmd} b$`)).toBe(`$a ${BS}${cmd} b$`);
    },
  );

  it("reads \\nexplain as a line break, not as \\nexists", () => {
    // The command list is anchored and closed by a word boundary, so a
    // command name is only matched when it ends where the command ends.
    expect(parsed(`show${BS}nexplain why`)).toBe("show\nexplain why");
  });

  it("leaves b, f, r and t to LaTeX, because their controls never occur here", () => {
    // \beta, \frac, \rightarrow, \times and \textit all belong in a packet.
    // Backspace, form feed, carriage return and tab do not, so for those four
    // letters the original assumption is simply correct and stays.
    for (const cmd of ["beta", "frac", "rightarrow", "times", "textit"]) {
      expect(parsed(`$${BS}${cmd}$`)).toBe(`$${BS}${cmd}$`);
    }
  });

  it("is a no-op on JSON that was already well formed", () => {
    const good = `{"p": "already ${BS}${BS}frac{1}{2} and a ${BS}${BS}n break"}`;
    expect(sanitizeJsonBackslashes(good)).toBe(good);
  });
});
