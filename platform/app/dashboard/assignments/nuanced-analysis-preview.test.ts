/**
 * nuanced-analysis-preview.test.ts
 * -----------------------------------------------------------------------------
 * Regression test for the stale-preview bug in NuancedAnalysisPreview.
 *
 * The bug: the packet title, the section headings and the question prompts are
 * click-to-edit fields, and all three were rendered with `defaultValue`. React
 * applies `defaultValue` once at mount and then never touches the DOM node
 * again, so generating a packet or loading a saved draft updated the `draft`
 * state while those fields kept displaying whatever mounted first -- the
 * DEFAULT_DRAFT boilerplate in nuanced-analysis-sandbox.tsx. The sandbox banner
 * correctly announced 'Loaded "Key Algebraic Properties: Proving Expressions
 * Are Equal"', the course strip and subtitle updated (plain text, not inputs),
 * and the title underneath still read "Nuanced Analysis" over Part 0's
 * placeholder log-base-2 questions. Sections are keyed by array index, so the
 * input nodes genuinely are reused from one draft to the next.
 *
 * Nothing downstream was affected -- the PDF and the "Save as Nuanced Analysis"
 * write both read `draft` state, which was correct throughout. Only the review
 * surface lied, which is the worst place for it: the teacher proofreads here.
 *
 * There is no jsdom/testing-library harness in this repo (vitest runs plain
 * node), so this asserts the invariant against the source the way
 * typst-rich-inline-math.test.ts and na-assessment.test.ts do.
 * -----------------------------------------------------------------------------
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(
  join(process.cwd(), "app", "dashboard", "assignments", "nuanced-analysis-preview.tsx"),
  "utf8"
);

/** Strip block and line comments so the header's prose about `defaultValue`
 *  does not count as a use of it. */
function code(): string {
  return SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("NuancedAnalysisPreview keeps editable fields controlled", () => {
  it("renders no field with defaultValue", () => {
    const offenders = code()
      .split("\n")
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter((l) => l.line.includes("defaultValue"));

    expect(
      offenders,
      "An editable field regressed to defaultValue. React seeds it once at " +
        "mount, so it will keep showing the previous draft (in practice " +
        "DEFAULT_DRAFT) after a new packet is generated or loaded. Use " +
        "value={...} -- see the header comment in nuanced-analysis-preview.tsx."
    ).toEqual([]);
  });

  // Tolerates the `?? ""` guard on each binding, but still requires the field
  // to be bound through `value=` rather than any other attribute.
  it.each([
    ["packet title", /value=\{draft\.title(\s*\?\?\s*"")?\}/],
    ["section heading", /value=\{section\.heading(\s*\?\?\s*"")?\}/],
    // QuestionBlock coalesces q.prompt into a local before rendering it.
    ["question prompt", /const prompt = q\.prompt \?\? "";[\s\S]*value=\{prompt\}/],
  ])("binds the %s to draft state", (_label, binding) => {
    expect(code()).toMatch(binding as RegExp);
  });

  it("still writes every edit back through onDraftChange", () => {
    // A controlled field with no change handler would be silently read-only,
    // which trades one broken review surface for another.
    for (const handler of [
      "onChange={(e) => updateTitle(e.target.value)}",
      "onChange={(e) => updateSectionHeading(si, e.target.value)}",
      "onChange={(e) => onPromptChange(e.target.value)}",
    ]) {
      expect(code()).toContain(handler);
    }
    expect(code()).toContain("onDraftChange?.({ ...draft, title });");
  });
});
