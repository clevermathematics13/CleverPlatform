/**
 * Shared LaTeX utilities for the IBDP mathematics questionbank.
 *
 * IB_LATEX_PREAMBLE — drop this between \documentclass{…} and \begin{document}
 * to reproduce the visual style of official IB past papers:
 *   • TeX Gyre Schola text font (closest open-source match to the IB serif)
 *   • newtxmath in Schola mode for consistent math glyphs
 *   • IBPart list environment that matches the (a) / (b) hanging-label style
 *     used throughout IB past papers
 */
export const IB_LATEX_PREAMBLE = `\\usepackage{tgschola}
\\usepackage[T1]{fontenc}
\\usepackage[utf8]{inputenc}
\\usepackage[schola]{newtxmath}

\\usepackage{enumitem}
\\newlist{IBPart}{enumerate}{1}
\\setlist[IBPart]{
  label=(\\alph*),
  labelwidth=1.5em,
  leftmargin=*,
  itemindent=-1.5em,
  parsep=0.5ex,
  partopsep=0pt
}`;

/**
 * Wrap a LaTeX fragment in a complete, compilable document that uses the IB
 * style preamble.  Suitable for one-off compilation / preview.
 *
 * @param body  The LaTeX body content (everything that goes inside \begin{document}…\end{document})
 */
export function wrapInIBDocument(body: string): string {
  return `\\documentclass[12pt]{article}
${IB_LATEX_PREAMBLE}

\\begin{document}
${body}
\\end{document}`;
}

/**
 * IB Mathematics past-paper LaTeX style conventions.
 *
 * Use this string verbatim inside Claude system / user prompts to ensure
 * generated or corrected LaTeX matches the visual style of IB papers.
 * Keep in sync with the transforms in postProcessMathpixLatex().
 */
export const IB_LATEX_STYLE_GUIDE = `IB Mathematics past-paper LaTeX conventions (follow exactly):
- Vectors: ALWAYS use \\boldsymbol{} (bold italic). NEVER use \\mathbf{} (bold upright), \\bm{}, \\vec{} or \\overrightarrow{} for vector variables. This applies to EVERY occurrence — in display equations AND inline text (e.g. "where $\\boldsymbol{s}$ is perpendicular to $\\boldsymbol{a}$").
- Column / row vectors: use \\begin{pmatrix}...\\end{pmatrix} (round brackets, no extra spacing). Do NOT use bmatrix or vmatrix.
- Dot product (vector · vector): use \\boldsymbol{\\cdot} so the dot matches the weight of the bold vectors. NEVER use \\bullet or \\times for dot product.
- Scalar × scalar: use \\times or \\cdot as appropriate.
- Greek letter parameters (λ, μ, etc.) that appear as unknowns in problems: render in regular math italic (just $\\lambda$, not boldsymbol).
- Displayed equations: use $$ ... $$ or \\[ ... \\]. Place full-width matrix equations in display mode.
- Multi-part questions: label parts with \\begin{IBPart}...\\end{IBPart} (not \\begin{enumerate})
- Mark scheme mark codes: preserve \\hfill before each IB mark code (e.g. "$$...$$\\n\\hfill (A1)"). Place \\hfill OUTSIDE math delimiters, one per line after the equation it annotates. Valid codes: (A1), A1, M1, (M1), AG, R1, N1–N3, ft.
- Inline math: wrap in $ ... $; do NOT leave math expressions as plain text.
- Do NOT include \\documentclass, \\usepackage, \\begin{document} or any preamble — return body LaTeX only.
- Common OCR errors to fix: missing minus signs on negative entries, \\lambda/\\mu confusion, 1 vs l vs I confusion, extra spaces inside \\boldsymbol{}.`;

/**
 * System prompt for Claude when normalising Mathpix-extracted LaTeX to IB style.
 * Used in the post-Mathpix normalisation pass in /api/questions/ocr-latex.
 */
export const IB_NORMALISE_SYSTEM = `You are an expert LaTeX editor for IBDP Mathematics past papers.
You will receive the raw LaTeX output from the Mathpix OCR engine together with the original question image(s).
Your task is to normalise the LaTeX to match IB past-paper formatting exactly.

${IB_LATEX_STYLE_GUIDE}

Cross-reference the image carefully to catch any OCR errors (missing signs, incorrect exponents, swapped letters, etc.).
Return ONLY the corrected LaTeX body — no explanation, no markdown fences, no preamble.`;

/**
 * System prompt for Claude when making manual corrections to stored LaTeX.
 * Used in the "Ask Claude" correction input on the question review page.
 */
export const IB_CORRECTION_SYSTEM = `You are an expert LaTeX editor for IBDP Mathematics past papers.
When given a correction instruction, apply it and return ONLY the corrected LaTeX string.
No explanation, no markdown code fences, no preamble.

${IB_LATEX_STYLE_GUIDE}`;

/**
 * Apply IB-style post-processing to raw MathPix LaTeX output.
 *
 * Replaces Mathpix defaults with IB-correct equivalents:
 *   • enumerate  → IBPart  (hanging-indent part labels)
 *   • \\mathbf{} → \\boldsymbol{} (bold italic vectors, not bold upright)
 *   • \\bm{}     → \\boldsymbol{}
 *   • \\vec{}    → \\boldsymbol{} (IB uses bold notation, not arrow)
 *
 * @param raw  The raw LaTeX string returned by the MathPix API
 * @returns    Post-processed LaTeX string ready for storage / rendering
 */
export function postProcessMathpixLatex(raw: string): string {
  return raw
    .replaceAll("\\begin{enumerate}", "\\begin{IBPart}")
    .replaceAll("\\end{enumerate}", "\\end{IBPart}")
    .replaceAll("\\mathbf{", "\\boldsymbol{")
    .replaceAll("\\bm{", "\\boldsymbol{")
    .replaceAll("\\vec{", "\\boldsymbol{");
}
