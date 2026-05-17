// Pure utility functions extracted from question-bank-client.tsx
// These have no React dependencies and can be tested independently.

export const SECTION_NAMES: Record<number, string> = {
  1: "Number & Algebra",
  2: "Functions",
  3: "Geometry & Trig",
  4: "Stats & Probability",
  5: "Calculus",
};

export const DEFAULT_COMMAND_TERMS = [
  "Calculate",
  "Classify",
  "Comment",
  "Compare",
  "Complete",
  "Construct",
  "Copy",
  "Deduce",
  "Demonstrate",
  "Describe",
  "Determine",
  "Differentiate",
  "Distinguish",
  "Draw",
  "Estimate",
  "Evaluate",
  "Expand",
  "Explain",
  "Express",
  "Factorise",
  "Find",
  "Give",
  "Hence",
  "Identify",
  "Integrate",
  "Interpret",
  "Investigate",
  "Justify",
  "Label",
  "Let",
  "List",
  "Mark",
  "Measure",
  "Outline",
  "Plot",
  "Predict",
  "Prove",
  "Represent",
  "Show",
  "Simplify",
  "Sketch",
  "Solve",
  "State",
  "Suggest",
  "Trace",
  "Using",
  "Verify",
  "Write down",
];

/**
 * Infer the total mark value for a piece of LaTeX by summing all
 * `\hfill [N]` / `\hfill [N marks]` patterns (standard IB question notation).
 * Falls back to summing `[N marks]` lines found in markschemes, skipping
 * any line that contains "Total". Returns null when nothing is found.
 */
export function parseMarksFromLatex(latex: string): number | null {
  if (!latex) return null;
  // Primary: \hfill [N] or \hfill [N marks]
  const hfillRe = /\\hfill\s*\[(\d+)(?:\s*marks?)?\]/gi;
  let total = 0;
  let found = false;
  let m: RegExpExecArray | null;
  while ((m = hfillRe.exec(latex)) !== null) {
    total += parseInt(m[1], 10);
    found = true;
  }
  if (found) return total > 0 ? total : null;
  // Fallback: [N marks] / [N mark] lines in markscheme (ignore "Total" lines)
  for (const line of latex.split("\n")) {
    if (/Total\s*\[/i.test(line)) continue;
    const mm = /\[(\d+)\s*marks?\]/i.exec(line);
    if (mm) { total += parseInt(mm[1], 10); found = true; }
  }
  return found && total > 0 ? total : null;
}

export function sanitizeLatexForCommandTermDetection(latex: string): string {
  return latex
    .replace(/\\[a-zA-Z]+\{[^}]*\}/g, " ")
    .replace(/[${}\\]/g, " ");
}

export function escapeRegex(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const COMMAND_TERM_VARIANTS: Readonly<Record<string, readonly string[]>> = {
  State: ["stating"],
};

export function commandTermPattern(term: string): RegExp {
  const variants = COMMAND_TERM_VARIANTS[term] ?? [];
  const tokens = [term, ...variants]
    .map((entry) => escapeRegex(entry).replace(/\s+/g, "\\s+"));
  return new RegExp(`\\b(?:${tokens.join("|")})\\b`, "gi");
}

export function detectCommandTermMatches(latex: string): Array<{ term: string; index: number }> {
  if (!latex) return [];
  const plain = sanitizeLatexForCommandTermDetection(latex);
  const matches: Array<{ term: string; index: number }> = [];

  for (const term of DEFAULT_COMMAND_TERMS) {
    const re = commandTermPattern(term);
    let m: RegExpExecArray | null;
    while ((m = re.exec(plain)) !== null) {
      matches.push({ term, index: m.index });
    }
  }

  matches.sort((a, b) => a.index - b.index || b.term.length - a.term.length || a.term.localeCompare(b.term));

  // Keep each canonical command term once, in order of first appearance.
  const seen = new Set<string>();
  const ordered: Array<{ term: string; index: number }> = [];
  for (const match of matches) {
    const key = match.term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(match);
  }
  return ordered;
}

/**
 * Scan the question LaTeX for the first IB command term by textual position
 * (case-insensitive). Returns the canonical form or null.
 */
export function detectCommandTerm(latex: string): string | null {
  return detectCommandTermMatches(latex)[0]?.term ?? null;
}

export function inferFallbackCommandTerm(latex: string): string | null {
  if (!latex) return null;
  const plain = sanitizeLatexForCommandTermDetection(latex)
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!plain) return null;

  // Common imperative starters seen in IB prompts where exact canonical term
  // may not appear verbatim (e.g. "Write the integer ..." -> "Write down").
  if (/^write\b/.test(plain)) return "Write down";
  if (/^show\b/.test(plain)) return "Show";
  if (/^find\b/.test(plain)) return "Find";
  if (/^calculate\b/.test(plain)) return "Calculate";
  if (/^(?:state|stating)\b/.test(plain)) return "State";
  if (/^determine\b/.test(plain)) return "Determine";
  if (/^hence\b/.test(plain)) return "Hence";
  return null;
}

export function chooseCommandTerm(input: {
  questionLatex: string;
  markschemeLatex?: string;
  claudeCommandTerm?: string | null;
}): string {
  const fromQuestion = detectCommandTerm(input.questionLatex);
  if (fromQuestion) return fromQuestion;
  const fallbackFromQuestion = inferFallbackCommandTerm(input.questionLatex);
  if (fallbackFromQuestion) return fallbackFromQuestion;
  const fromMarkscheme = detectCommandTerm(input.markschemeLatex ?? "");
  if (fromMarkscheme) return fromMarkscheme;
  const fallbackFromMarkscheme = inferFallbackCommandTerm(input.markschemeLatex ?? "");
  if (fallbackFromMarkscheme) return fallbackFromMarkscheme;
  const canonicalFromClaude = DEFAULT_COMMAND_TERMS.find(
    (t) => t.toLowerCase() === (input.claudeCommandTerm ?? "").toLowerCase(),
  );
  if (canonicalFromClaude) return canonicalFromClaude;
  return "State";
}

export function chooseCommandTerms(input: {
  questionLatex: string;
  markschemeLatex?: string;
  claudeCommandTerm?: string | null;
}): string[] {
  const primary = chooseCommandTerm(input);
  const combined = mergeHighlightTerms(
    [primary],
    detectCommandTerms(input.questionLatex),
    detectCommandTerms(input.markschemeLatex ?? ""),
    input.claudeCommandTerm ? [input.claudeCommandTerm] : [],
  );
  const canonical = combined
    .map((term) => DEFAULT_COMMAND_TERMS.find((t) => t.toLowerCase() === term.toLowerCase()))
    .filter((t): t is string => Boolean(t));
  return mergeHighlightTerms([primary], canonical);
}

export function detectCommandTerms(latex: string): string[] {
  return detectCommandTermMatches(latex).map((m) => m.term);
}

export function mergeHighlightTerms(...groups: Array<string[] | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const term of group ?? []) {
      const t = term.trim();
      if (!t) continue;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}

export function detectPartLabels(text: string): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  const re = /\(([a-z])\)(?=[\s\n\\$]|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      labels.push(m[1]);
    }
  }
  return labels;
}

export function normalizePartLabelKey(label: string | null | undefined): string {
  if (!label) return "";
  return label.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function romanSubpartStem(label: string): string | null {
  const normalized = normalizePartLabelKey(label);
  const m = normalized.match(/^([a-z])(i|ii|iii|iv|v)$/);
  return m ? m[1] : null;
}

export function primaryCommandTerm(part: { command_term: string | null; command_terms?: string[] }): string | null {
  return part.command_terms?.[0] ?? part.command_term ?? null;
}

/** Remove 1.0 (Prior Learning) and 2.1 (Fundamentals) from a part's subtopic codes if more specific topics are also assigned. */
export function filterPriorLearning(codes: string[]): string[] {
  let result = codes;
  if (result.length > 1 && result.includes("1.0")) result = result.filter((c) => c !== "1.0");
  if (result.includes("2.1") && result.some((c) => c !== "2.1" && c !== "1.0")) result = result.filter((c) => c !== "2.1");
  return result;
}
