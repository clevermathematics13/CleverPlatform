/**
 * Deterministic scanning for exposed chain-of-thought / hedging language in
 * AI-generated examiner reasoning.
 *
 * The grading model is instructed (see GRADING_SYSTEM_PROMPT rule 18) to
 * write examiner reasoning containing only the settled marking judgement,
 * the relevant IB rule, and the evidence for it -- never its own internal
 * deliberation or self-correction. Production evidence showed this
 * instruction alone was not reliably followed: a real graded result's
 * `reasoning` field read (verbatim) "...student reports 8.515 which rounds
 * to 8.52 - however reconsidering, 8.515 rounds to 8.52 at 3sf so this
 * should earn the mark. Let me reconsider: 8.515 to 3sf is 8.52, which
 * matches mark scheme." -- the model's live reasoning process leaking
 * directly into teacher-facing text.
 *
 * This module is the deterministic backstop: it flags (never rewrites)
 * reasoning/notes matching that pattern, so validateGradeResponse can
 * downgrade confidence and surface it for teacher review rather than
 * silently shipping it. Deliberately detection-only -- editing the
 * model's own sentence to strip a banned phrase risks leaving a
 * grammatically broken or misleading half-sentence behind; flagging is
 * safer than best-effort surgery on ungraded free text.
 */

interface DeliberationPattern {
  /** Regex matched case-insensitively against the text. */
  pattern: RegExp;
  /** Human-readable label used in the warning message. */
  label: string;
}

const DELIBERATION_PATTERNS: DeliberationPattern[] = [
  { pattern: /\blet me\b/i, label: "let me" },
  { pattern: /\breconsider(?:ing|ed)?\b/i, label: "reconsider" },
  { pattern: /\bon second thought\b/i, label: "on second thought" },
  { pattern: /\bi (?:initially )?thought\b/i, label: "I thought" },
  { pattern: /\bi think\b/i, label: "I think" },
  { pattern: /\bi believe\b/i, label: "I believe" },
  { pattern: /\bactually,/i, label: "actually," },
  { pattern: /\bwait,/i, label: "wait," },
  { pattern: /\bi need to check\b/i, label: "I need to check" },
  { pattern: /\bappears to\b/i, label: "appears to" },
  { pattern: /\bseems to\b/i, label: "seems to" },
  { pattern: /\bprobably\b/i, label: "probably" },
  { pattern: /\bmaybe\b/i, label: "maybe" },
  { pattern: /\bdoesn'?t match\b/i, label: "doesn't match" },
  { pattern: /\bat first\b/i, label: "at first" },
];

/**
 * Returns the label of every exposed-deliberation pattern found in `text`,
 * in the order the patterns are checked (not the order they occur in the
 * text). Empty array means nothing suspicious was found. Never throws;
 * never modifies `text`.
 */
export function findExposedDeliberation(text: string): string[] {
  if (!text) return [];
  const found: string[] = [];
  for (const { pattern, label } of DELIBERATION_PATTERNS) {
    if (pattern.test(text)) found.push(label);
  }
  return found;
}
