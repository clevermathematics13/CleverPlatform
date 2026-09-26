import katex, { type KatexOptions } from "katex";
import { proseHtml, splitMathText } from "./math-text";

/**
 * KaTeX for the student mark scheme's worked explanations: one set of
 * options, so what the generator checks when it writes an explanation
 * (texProblem) is exactly what a student's screen renders (renderTex).
 *
 * Imported by the server, and by the browser only inside the lazily loaded
 * "Explain more" slides (components/reflection/ExplainMore.tsx), so KaTeX's
 * script never rides in the self-grade form's first download.
 */

/**
 * Four highlight colours an explanation may use to show what changes from
 * one line of working to the next -- `\blue{3x}` -- picked from the app's own
 * semantic palette (app/globals.css) so each is readable on its dark
 * surface. Colour is never the only signal: the words say the same thing.
 * `\bm` and `\mathbf` are the vector safety net LatexRenderer already uses
 * (AGENTS.md: vectors are \boldsymbol).
 */
export const EXPLANATION_TEX_MACROS: Readonly<Record<string, string>> = {
  // "##" is a literal # inside a macro: a single "#7cc4ff" reads as a
  // reference to a seventh argument, and every use of the macro fails.
  "\\blue": "\\textcolor{##7cc4ff}{#1}",
  "\\orange": "\\textcolor{##f5c26b}{#1}",
  "\\green": "\\textcolor{##6fd99a}{#1}",
  "\\pink": "\\textcolor{##f27a90}{#1}",
  "\\bm": "\\boldsymbol",
  "\\mathbf": "\\boldsymbol",
};

function options(displayMode: boolean, throwOnError: boolean): KatexOptions {
  return {
    displayMode,
    throwOnError,
    // Unicode letters and text-mode symbols in maths render rather than
    // abort: a student is better served by a slightly odd glyph than a gap.
    strict: false,
    // No \href, \url, \includegraphics or \htmlClass: nothing typeset here
    // can reach outside the formula.
    trust: false,
    // MathML beside the visual HTML, so a screen reader reads the maths.
    output: "htmlAndMathml",
    // KaTeX writes \gdef definitions back into the macros object it is
    // given, so every call gets its own copy.
    macros: { ...EXPLANATION_TEX_MACROS },
  };
}

const AMP = String.fromCharCode(38);

function escapeSource(tex: string): string {
  return tex.replace(/&/g, `${AMP}amp;`).replace(/</g, `${AMP}lt;`).replace(/>/g, `${AMP}gt;`);
}

/** One formula as HTML. Never throws: a formula KaTeX cannot read is shown
 *  as its source, which the generator's checks exist to prevent. */
export function renderTex(tex: string, displayMode: boolean): string {
  try {
    const html = katex.renderToString(tex, options(displayMode, false));
    // A display formula wider than a phone scrolls inside its own box
    // instead of pushing the page sideways.
    return displayMode ? `<span class="block max-w-full overflow-x-auto overflow-y-hidden py-1">${html}</span>` : html;
  } catch {
    return `<code>${escapeSource(tex)}</code>`;
  }
}

/** Why KaTeX cannot typeset `tex`, or null when it can. */
export function texProblem(tex: string, displayMode: boolean): string | null {
  if (tex.trim() === "") return "an empty formula";
  try {
    katex.renderToString(tex, options(displayMode, true));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** An inline formula with a fraction is set at full size: KaTeX's inline
 *  fractions are shrunk to fit the line, and a numerator a few pixels tall
 *  is exactly what a student with dyslexia or dyscalculia misreads. */
const HAS_FRACTION = /\\(?:[dt]?frac|binom)\b/;

/** Mixed prose and maths (lib/math-text.ts) as HTML: the prose escaped, the
 *  maths typeset. The only markup in the result is KaTeX's own and <strong>. */
export function renderMathTextHtml(src: string): string {
  return splitMathText(src)
    .map((seg) => {
      if (seg.kind === "text") return proseHtml(seg.text);
      if (seg.kind === "display") return renderTex(seg.tex, true);
      return renderTex(HAS_FRACTION.test(seg.tex) ? `\\displaystyle ${seg.tex}` : seg.tex, false);
    })
    .join("");
}
