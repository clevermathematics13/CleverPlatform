/**
 * Canonical list of IB-approved command terms.
 *
 * THIS IS THE SINGLE SOURCE OF TRUTH.
 *
 * - The Supabase `command_terms` table is seeded from this list.
 * - All TypeScript consumers import DEFAULT_COMMAND_TERMS from here.
 * - The IB_CLASSIFY_SYSTEM prompt in latex-utils.ts inlines this list so
 *   Claude is constrained to exactly these terms.
 *
 * To add or remove a term:
 *   1. Edit this array.
 *   2. Run a Supabase migration to INSERT / DELETE the corresponding row.
 *   3. IB_CLASSIFY_SYSTEM in latex-utils.ts rebuilds itself at module load
 *      automatically from this array — no manual prompt edit needed.
 */
export const DEFAULT_COMMAND_TERMS: string[] = [
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
 * Return the canonical form of a command term (case-insensitive lookup).
 * Returns null if the value is not in the approved list.
 */
export function canonicalCommandTerm(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  return (
    DEFAULT_COMMAND_TERMS.find(
      (term) => term.toLowerCase() === trimmed.toLowerCase(),
    ) ?? null
  );
}
