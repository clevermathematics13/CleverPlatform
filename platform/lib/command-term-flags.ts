export type CommandTermFlags = {
  is_hence: boolean;
  is_hence_or_otherwise: boolean;
  is_using: boolean;
  is_deduce: boolean;
  is_verify: boolean;
};

export const INSTRUCTIONAL_CONTEXT_TERMS = [
  "Show that",
  "Given that",
  "It is given that",
  "Assume that",
  "Suppose that",
  "Consider",
  "Subject to",
  "In terms of",
  "By inspection",
  "From part",
  "Therefore",
  "Thus",
  "Where",
  "On the same axes",
  "Show clearly",
  "Indicate clearly",
  "Hence or otherwise",
  "Using your answer",
] as const;

const COMMAND_TERMS = [
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
] as const;

export const EMPTY_COMMAND_TERM_FLAGS: CommandTermFlags = {
  is_hence: false,
  is_hence_or_otherwise: false,
  is_using: false,
  is_deduce: false,
  is_verify: false,
};

function hasPattern(text: string, pattern: RegExp): boolean {
  pattern.lastIndex = 0;
  return pattern.test(text);
}

function sanitizeSourceText(sourceLatex: string): string {
  // Strip common LaTeX command wrappers so plain words are easier to detect.
  return sourceLatex
    .replace(/\\[a-zA-Z]+\{([^}]*)\}/g, " $1 ")
    .replace(/[{}$\\]/g, " ");
}

function escapeTermPattern(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
}

function hasTerm(text: string, term: string): boolean {
  return hasPattern(text, new RegExp(`\\b${escapeTermPattern(term)}\\b`, "i"));
}

export function deriveCommandTermFlags(input: {
  commandTerm?: string | null;
  sourceLatex?: string | null;
}): CommandTermFlags {
  const commandTerm = (input.commandTerm ?? "").trim().toLowerCase();
  const sourceText = sanitizeSourceText(input.sourceLatex ?? "").toLowerCase();
  const combined = `${commandTerm} ${sourceText}`;

  const isHenceOrOtherwise = hasPattern(combined, /\bhence\s+or\s+otherwise\b/i);
  const isHence = isHenceOrOtherwise || hasPattern(combined, /\bhence\b/i);

  return {
    is_hence: isHence,
    is_hence_or_otherwise: isHenceOrOtherwise,
    is_using: hasPattern(combined, /\busing\b/i),
    is_deduce: hasPattern(combined, /\bdeduce\b/i),
    is_verify: hasPattern(combined, /\bverify\b/i),
  };
}

export function deriveInstructionalContextTerms(input: {
  commandTerm?: string | null;
  sourceLatex?: string | null;
}): string[] {
  const commandTerm = (input.commandTerm ?? "").trim();
  const sourceText = sanitizeSourceText(input.sourceLatex ?? "");
  const combined = `${commandTerm} ${sourceText}`.trim();

  const detectedContextTerms = INSTRUCTIONAL_CONTEXT_TERMS.filter((term) => hasTerm(combined, term));
  const detected = [...detectedContextTerms];
  const commandSet = new Set(COMMAND_TERMS.map((t) => t.toLowerCase()));
  const primaryCommand = commandTerm.toLowerCase();
  const seen = new Set<string>();
  return detected.filter((term) => {
    const key = term.toLowerCase();
    if (commandSet.has(key) || key === primaryCommand) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function contextTermHighlightsFromFlags(
  flags: Partial<CommandTermFlags> | null | undefined,
  instructionalContextTerms?: string[] | null,
): string[] {
  const terms: string[] = [];
  if (instructionalContextTerms && instructionalContextTerms.length > 0) {
    terms.push(...instructionalContextTerms.map((t) => t.trim()).filter(Boolean));
  }

  const commandSet = new Set(COMMAND_TERMS.map((t) => t.toLowerCase()));
  const seen = new Set<string>();
  return terms.filter((t) => {
    const key = t.toLowerCase();
    if (commandSet.has(key)) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
