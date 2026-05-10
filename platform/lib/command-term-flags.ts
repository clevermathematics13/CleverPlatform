export type CommandTermFlags = {
  is_hence: boolean;
  is_hence_or_otherwise: boolean;
  is_using: boolean;
  is_deduce: boolean;
  is_verify: boolean;
};

export const INSTRUCTIONAL_CONTEXT_TERMS = [
  "Hence or otherwise",
  "Hence",
  "Using your answer",
  "Using",
  "Deduce",
  "Verify",
  "Show that",
  "Given that",
  "It is given that",
  "Assume that",
  "Suppose that",
  "Let",
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
  "Justify",
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

  const detected = INSTRUCTIONAL_CONTEXT_TERMS.filter((term) => hasTerm(combined, term));
  const withCommand = commandTerm ? [commandTerm, ...detected] : detected;
  const seen = new Set<string>();
  return withCommand.filter((term) => {
    const key = term.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function commandTermHighlightsFromFlags(
  commandTerm: string | null | undefined,
  flags: Partial<CommandTermFlags> | null | undefined,
  instructionalContextTerms?: string[] | null,
): string[] {
  const terms: string[] = [];
  if (commandTerm && commandTerm.trim()) terms.push(commandTerm.trim());
  if (instructionalContextTerms && instructionalContextTerms.length > 0) {
    terms.push(...instructionalContextTerms.map((t) => t.trim()).filter(Boolean));
  }
  if (flags?.is_hence_or_otherwise) terms.push("Hence or otherwise");
  if (flags?.is_hence) terms.push("Hence");
  if (flags?.is_using) terms.push("Using");
  if (flags?.is_deduce) terms.push("Deduce");
  if (flags?.is_verify) terms.push("Verify");

  const seen = new Set<string>();
  return terms.filter((t) => {
    const key = t.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
