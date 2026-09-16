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
 * The second invariant here is newer. Those same three fields used to show
 * their RAW LaTeX at all times, so a teacher proofreading the packet read
 * "$\cos\left(\frac{3\pi}{2}\right)$" where the student would get a
 * cosine -- on the one surface whose whole job is to show what the student
 * will see. They render typeset now and fall back to source only while being
 * edited; see EditableMath in nuanced-analysis-preview.tsx.
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
    //
    // The three fields now hand their writer to EditableMath rather than
    // spelling out an onChange of their own, so the chain to assert is:
    // field -> EditableMath -> the editor's own onChange -> draft state.
    for (const handler of [
      "onChange={updateTitle}",
      "onChange={(next) => updateSectionHeading(si, next)}",
      "onChange={onPromptChange}",
    ]) {
      expect(code()).toContain(handler);
    }
    expect(code()).toMatch(/onChange:\s*\([\s\S]*?\)\s*=>\s*onChange\(e\.target\.value\)/);
    expect(code()).toContain("onDraftChange?.({ ...draft, title });");
  });

  // The other half of the same review surface, and the reason EditableMath
  // exists: a field whose SOURCE is all a teacher ever sees is a field where
  // a wrong exponent or a missing bracket stays invisible until the packet is
  // printed. Reading shows typeset mathematics; editing shows the LaTeX.
  it("renders every editable field as typeset mathematics when not editing", () => {
    const c = code();
    expect(c).toMatch(/function EditableMath\(/);
    // Not editing -> KaTeX, via the shared renderer.
    expect(c).toMatch(/editing[\s\S]{0,4000}<LatexRenderer latex=\{value\} \/>/);
    // Editing -> a controlled editor over the raw LaTeX, never defaultValue.
    expect(c).toMatch(/const commonProps = \{\s*value,/);
    // No editable field may go back to a bare textarea/input bound to the
    // draft: that is the state this component replaced.
    expect(c).not.toMatch(/value=\{prompt\}\s*\n\s*rows=/);
  });
});
