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
 *
 * ---- Two kinds of flag, not one -------------------------------------------
 *
 * The first version of this module treated every listed phrase as the same
 * defect. Measured against a full class (2337 graded parts on Formative
 * Assessment 1), that produced 77 flags of which exactly 1 was a real
 * problem -- and every flag forced confidence to "low", which teaches the
 * teacher to ignore the badge. The phrases split cleanly in two:
 *
 *   DELIBERATION -- the model narrating or reversing its own thinking
 *     ("Let me reconsider", "wait, student wrote 78 not 108"). This is the
 *     real defect: it means the model contradicted itself, so the MARK is
 *     suspect, not just the prose. The one true positive in that class run
 *     was a "wait," that caught an A1 awarded on a note saying the
 *     student's value was wrong.
 *
 *   HEDGING -- the model expressing honest uncertainty about what it could
 *     read off the scan ("the student's answer appears to be 2"). On
 *     handwriting this is legitimate, even desirable, examiner language.
 *     It is worth a glance at the crop; it is not evidence the mark is
 *     wrong, and it should not read as "internal deliberation".
 *
 * "doesn't match" was dropped entirely. It is ordinary settled examiner
 * English ("the student's value doesn't match the mark scheme"), and on a
 * question that ASKS the student to explain why one expression does not
 * match another it is unavoidable -- it accounted for 35 of the 77 flags,
 * all false, concentrated in the two parts whose subject matter is exactly
 * that. A phrase the correct answer must contain cannot be a defect signal.
 */

/** Which kind of problem a matched phrase indicates. */
export type ReasoningFlagKind = "deliberation" | "hedging";

interface ReasoningPattern {
  /** Regex matched case-insensitively against the text. */
  pattern: RegExp;
  /** Human-readable label used in the warning message. */
  label: string;
  kind: ReasoningFlagKind;
}

const REASONING_PATTERNS: ReasoningPattern[] = [
  // -- Deliberation: process narration or self-correction. Mark is suspect.
  { pattern: /\blet me\b/i, label: "let me", kind: "deliberation" },
  { pattern: /\breconsider(?:ing|ed)?\b/i, label: "reconsider", kind: "deliberation" },
  { pattern: /\bon second thought\b/i, label: "on second thought", kind: "deliberation" },
  { pattern: /\bi (?:initially )?thought\b/i, label: "I thought", kind: "deliberation" },
  { pattern: /\bi need to check\b/i, label: "I need to check", kind: "deliberation" },
  { pattern: /\bactually,/i, label: "actually,", kind: "deliberation" },
  { pattern: /\bwait,/i, label: "wait,", kind: "deliberation" },
  { pattern: /\bat first\b/i, label: "at first", kind: "deliberation" },

  // -- Hedging: uncertainty about what was read. Worth a look at the crop.
  { pattern: /\bappears to\b/i, label: "appears to", kind: "hedging" },
  { pattern: /\bseems to\b/i, label: "seems to", kind: "hedging" },
  { pattern: /\bprobably\b/i, label: "probably", kind: "hedging" },
  { pattern: /\bmaybe\b/i, label: "maybe", kind: "hedging" },
  { pattern: /\bi think\b/i, label: "I think", kind: "hedging" },
  { pattern: /\bi believe\b/i, label: "I believe", kind: "hedging" },
];

function findByKind(text: string, kind: ReasoningFlagKind): string[] {
  if (!text) return [];
  const found: string[] = [];
  for (const p of REASONING_PATTERNS) {
    if (p.kind === kind && p.pattern.test(text)) found.push(p.label);
  }
  return found;
}

/**
 * Returns the label of every exposed-deliberation pattern found in `text`,
 * in the order the patterns are checked (not the order they occur in the
 * text). Empty array means nothing suspicious was found. Never throws;
 * never modifies `text`.
 *
 * Deliberation only -- hedging is reported separately by findHedgedReading,
 * because the two warrant different responses from the teacher.
 */
export function findExposedDeliberation(text: string): string[] {
  return findByKind(text, "deliberation");
}

/**
 * Returns the label of every hedging pattern found in `text`. Same contract
 * as findExposedDeliberation: order of checking, empty on no match, never
 * throws, never modifies `text`.
 */
export function findHedgedReading(text: string): string[] {
  return findByKind(text, "hedging");
}
