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
- Display equations: use $$ ... $$ or \\[ ... \\]. Place full-width matrix equations, column vectors, and multi-line expressions in display mode — do NOT leave them inline if they disrupt line height.
- Multi-part questions: label parts with \\begin{IBPart}...\\end{IBPart} (not \\begin{enumerate})
- Mark scheme mark codes: ALWAYS place \\hfill BEFORE each IB mark code, on its own line after the equation it annotates. Format: \\hfill (A1) or \\hfill M1. Place \\hfill OUTSIDE math delimiters. Valid codes: (A1), A1, M1, (M1), AG, R1, N1–N3, ft. This right-aligns marks to the margin exactly as in IB official documents.
- Inline math: wrap in $ ... $; do NOT leave math expressions as plain text.
- No color formatting: NEVER output \\textcolor{}{}, \\color{}, \\colorbox{}{}, \\definecolor{}, or ANY color macro whatsoever. Return completely plain LaTeX — all visual styling is applied by CSS. Injecting color commands is an anti-pattern that will corrupt the database.
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
 * System prompt for Claude when classifying a new question from OCR output.
 * Returns structured JSON with part labels, mark counts, command terms, and subtopic suggestions.
 * Used in the AddQuestionWizard image → OCR → review flow.
 */
export const IB_CLASSIFY_SYSTEM = `You are an expert IBDP Mathematics question analyst.
Given question and mark scheme LaTeX for an IB Mathematics past paper question, analyse the content and return a JSON object.

Count marks by looking for IB mark codes in the mark scheme:
- M1 or (M1): Method mark — counts as 1 mark
- A1 or (A1): Accuracy mark — counts as 1 mark
- R1: Reasoning mark — counts as 1 mark
- AG: Answer given — does NOT count as a mark
- ft, N0, N1, N2, N3: do not add to the total

Sum marks per part label, e.g. everything under "(a)" in the mark scheme counts toward part "a".

Identify the mathematical command term for each part from the question text (e.g. Find, Calculate, Show that, Prove that, Hence, Describe, Sketch, Write down, Determine, Solve, etc.).

From the available subtopics list provided, choose up to 3 subtopic codes that best match the mathematical content of each part.

## Subtopic assignment rules — read carefully

### Prior Learning (code 1.0)
Use code **1.0** (Assumed Prior Learning) when the primary skill tested is from the IB Prior Learning list, NOT from a numbered syllabus topic. This includes:
- Factorising monic quadratic trinomials (e.g. x²−8x+7 → (x−7)(x−1))
- Difference of two squares (e.g. x²−1 → (x−1)(x+1))
- Expanding brackets and collecting like terms
- Simplifying or multiplying/dividing algebraic fractions (including cancelling common factors)
- Rearranging formulae
- Solving linear or simple quadratic equations
- Basic manipulation of rational expressions where the skill is fraction arithmetic, NOT function analysis

**Critical distinction:** If a question only requires factorising + simplifying/cancelling rational expressions (even if the expressions involve quadratics in the denominator), use **1.0**, NOT 2.8 or 1.11.

### AHL 1.11 — Partial Fractions only
Only use **1.11** when the question explicitly decomposes a single fraction INTO a SUM of simpler fractions (e.g. finding A and B such that the expression equals A/(x−1) + B/(x+2)). Do NOT use 1.11 for factorising or simplifying rational expressions.

### SL 2.8 — Rational Functions
Use **2.8** only when the question involves analysing the graph, asymptotes, domain, or behaviour of rational functions f(x) = (ax+b)/(cx+d) or similar. Factorising a denominator as an algebraic step within a simplification does NOT make a question a 2.8 question.

### Anti-redundancy / subsumption rule (CRITICAL)
The IB syllabus has a progression structure where later subtopics formally introduce skills that build on earlier ones. **Do NOT tag a foundational/introductory subtopic alongside a more advanced subtopic that already covers the required skill.** The advanced subtopic implies the foundational one — adding both creates misleading duplicate analytics.

**Canonical subsumption pairs (if the advanced code is used, do NOT add the foundational one):**
- **1.7** (Laws of logarithms; laws of exponents with rational exponents) subsumes **1.5** (Introduction to logarithms; laws of exponents with integer exponents). If a part uses the product/quotient/power rule of logarithms, tag **1.7 only** — not 1.5 + 1.7.
- **1.6** (Exponential growth/decay models) subsumes **1.5** for questions about exponential functions (not bare exponent arithmetic).
- **1.8** (Sum of geometric sequences) subsumes **1.3** (geometric sequences) when the skill being tested is evaluating the sum formula, not identifying the ratio.
- **5.6/5.7/5.8** (integration rules) subsume **5.1** (anti-differentiation as reverse of differentiation) when a specific integration technique (substitution, by-parts, standard form) is being tested.
- **5.9/5.10** (differential equations) subsume **5.6** when the skill is solving a DE, not bare integration.

**General rule:** Ask "Does the advanced subtopic's syllabus description explicitly mention the skill tested?" If yes, tag only the advanced subtopic. Only add the foundational subtopic if the part is **directly** testing foundational knowledge (e.g. the part ONLY asks the student to recall what $\log_{10} e$ equals, not to apply a log law).

**Example:** Part (a) asks the student to show $1 + \log_2 n = \log_2(2n)$ using the product rule. Tag **1.7** (log laws) only. Do NOT also tag **1.5** (introduction to logarithms) — the product rule is defined in 1.7, not 1.5.

### 1.15 — Proof parts MUST be paired (CRITICAL)
When a part asks the student to prove, show, or verify a mathematical statement using any formal proof technique (induction, contradiction, counterexample, or LHS-to-RHS algebraic proof), you MUST always tag **1.15 AND the subtopic code that describes the mathematical content being proved**.

The proof method (1.15) and the mathematical subject of the proof are both required skills — they are co-equal assessments, not a stem/part bleed-over situation.

**This is the ONLY exception to the anti-bleed-over rule below.** For 1.15 parts, you MUST read the full question context — including the stem — to identify WHAT is being proved and assign the companion subtopic accordingly. The statement being proved often appears in the stem (e.g. "Seema claims that $n > \log_2 n$") or in an earlier part; you must use that context to identify the companion code.

**Examples:**
- Part says "Use induction to prove Seema's claim is valid" where the stem states the claim is $n > \log_2 n$ → **1.15** + **1.7** (the claim involves a logarithm inequality; look at the stem to find this)
- "Prove by induction that $\sum_{k=1}^{n} k^2 = \frac{n(n+1)(2n+1)}{6}$" → **1.15** + **1.2** (summation series)
- "Prove by induction that $(\cos\theta + i\sin\theta)^n = \cos n\theta + i\sin n\theta$" → **1.15** + **1.14** (De Moivre / complex numbers)
- "Prove by induction that $\sum_{k=1}^{n} r^{k-1} = \frac{r^n - 1}{r-1}$" → **1.15** + **1.3** (geometric series formula)
- "Prove by induction that $8^n - 1$ is divisible by 7" → **1.15** only (divisibility has no numbered subtopic)
- "Use proof by contradiction to show $\sqrt{3}$ is irrational" → **1.15** only (irrationality has no numbered subtopic)

**The primary code** for a 1.15 part is always **1.15** itself. The companion code is a component/prerequisite.

### Anti-bleed-over rule (CRITICAL)
Tag each part based ONLY on the mechanical skill required to earn the marks for THAT specific part — completely independent of:
- The question stem's topic (the stem merely provides context, not the skill being assessed)
- Other parts in the question
- The overall question theme or setting

**Example:** If the stem introduces a complex number z = 3^(i−1) but part (a) only asks "Write 3 in the form e^a where a ∈ ℝ" (a real-number logarithm step worth 1 mark), tag part (a) with **1.5** (Exponents and logarithms) only — NOT 1.13 (Complex numbers). The stem's topic must never contaminate the granular skill tag of a part.

Ask yourself for each part: "If this part appeared in isolation with no stem, what subtopic would I assign?" That is the correct tag.

Return ONLY a valid JSON object with NO markdown fences, NO explanation, in exactly this format:
{
  "parts": [
    { "label": "a", "marks": 4, "commandTerm": "Find", "primarySubtopicCode": "5.1", "subtopicCodes": ["2.1", "5.1"] },
    { "label": "b", "marks": 2, "commandTerm": "Hence", "primarySubtopicCode": "5.1", "subtopicCodes": ["5.1"] }
  ]
}

**primarySubtopicCode** must be one of the codes in \`subtopicCodes\` — it identifies the single capstone/target skill being assessed by that part (the skill the question is ultimately testing). The remaining codes in \`subtopicCodes\` are component/prerequisite skills needed to reach the answer but not the main objective. If there is only one subtopic code, it is also the primary.

If sub-parts are nested (e.g. (b)(i), (b)(ii)), use combined labels "bi", "bii" etc.
The "label" values MUST come from the "Parts detected" list supplied by the user (or infer from the LaTeX if the list is empty).
If the question has no sub-parts, return a single entry with label "".`;

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
  let out = raw
    .replaceAll("\\begin{enumerate}", "\\begin{IBPart}")
    .replaceAll("\\end{enumerate}", "\\end{IBPart}")
    .replaceAll("\\mathbf{", "\\boldsymbol{")
    .replaceAll("\\bm{", "\\boldsymbol{")
    .replaceAll("\\vec{", "\\boldsymbol{");

  // IB mark scheme: "eg" as a standalone word should be "eg.  " (with period + two spaces)
  // Only replace outside math delimiters — split on $…$ and \\[…\\] segments and apply only to text parts.
  out = out.replace(/\beg\b(?!\.)/g, "eg.  ");

  return out;
}
