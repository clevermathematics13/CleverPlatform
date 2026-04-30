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
 * Apply IB-style post-processing to raw MathPix LaTeX output.
 *
 * Currently replaces default enumerate environments with the custom IBPart
 * environment so that list labels render with the correct IB hanging-indent
 * style.
 *
 * @param raw  The raw LaTeX string returned by the MathPix API
 * @returns    Post-processed LaTeX string ready for storage / rendering
 */
export function postProcessMathpixLatex(raw: string): string {
  return raw
    .replaceAll("\\begin{enumerate}", "\\begin{IBPart}")
    .replaceAll("\\end{enumerate}", "\\end{IBPart}");
}
