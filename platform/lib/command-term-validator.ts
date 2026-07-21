/**
 * Command-term validator for generated Nuanced Analysis drafts.
 * ─────────────────────────────────────────────────────────────
 * WHY THIS EXISTS: a generated packet ("The Anatomy of a Dataset") shipped
 * with eight questions whose prompts contained a fully-formed setup sentence
 * but NO command term / task instruction at all — the model wrote the setup
 * and stopped before the "Compare…" / "Find…" sentence, most often on the
 * "compare two five-number summaries" archetype. The hint, marks, and tier
 * fields all survived, so nothing downstream noticed. This validator makes
 * that failure loud BEFORE the teacher downloads a broken PDF.
 *
 * It checks every question prompt (and every subpart prompt) against the
 * canonical 36-term IB list in lib/command-terms.ts — the single source of
 * truth — and reports any prompt containing zero recognized command terms.
 *
 * MATCHING RULES (deliberate, not naive):
 *  1. A term matching with its canonical capitalization ("Sketch", "Write
 *     down", "Hence or otherwise") always counts — IB prompts capitalize the
 *     imperative.
 *  2. A lowercase match counts for unambiguous verb terms ("…and hence find
 *     the value of k" is a legitimate IB phrasing).
 *  3. A lowercase match does NOT count on its own for terms that commonly
 *     appear as NOUNS in setup text — "the box plot below", "the initial
 *     state", "the list of values". Those only count when preceded by a
 *     coordinating word ("and state", "or sketch", "then draw",
 *     "hence plot"). Without this, the exact archetype that failed (a
 *     statistics setup mentioning "box plot") would have slipped through.
 *  4. A question with subparts is treated as a stem: the parent prompt is
 *     exempt (IB stems often carry no command term), but every subpart must
 *     pass.
 *
 * The validator never throws and never mutates the draft — it returns a list
 * of issues for the UI to surface. An empty array means the draft is clean.
 */

import { DEFAULT_COMMAND_TERMS } from "./command-terms";
import { subpartLetter } from "./assignments";
import type { AssignmentDraft, AssignmentQuestion } from "./assignments";

export type CommandTermIssue = {
  /** Human-readable location, e.g. `Part 2 — Reading the Data, Q3(b)` */
  location: string;
  /** Where the missing instruction should have been — the tail of the prompt. */
  promptTail: string;
  kind: "question" | "subpart";
};

/**
 * Terms that frequently occur as nouns inside setup text. Lowercase
 * occurrences of these are only accepted with an imperative-context word
 * immediately before them (rule 3 above).
 */
const NOUN_AMBIGUOUS_TERMS = new Set([
  "comment",
  "construct",
  "draw",
  "estimate",
  "label",
  "list",
  "plot",
  "show",
  "sketch",
  "state",
]);

/**
 * Words that mark a lowercase command term as imperative when directly
 * before it. NOTE: every regex in this file is deliberately built without
 * any backslash escape sequences — command terms are purely alphabetic
 * (letters + spaces), so none are needed, and backslash-free source is
 * immune to the repo's known double-backslash push-corruption failure mode.
 */
const IMPERATIVE_LEADIN = "(?:and|or|then|hence|otherwise)[,]?[ ]+";

type CompiledTerm = {
  term: string;
  /** Canonical capitalization, word-bounded. */
  canonical: RegExp;
  /** Case-insensitive, word-bounded. */
  anyCase: RegExp;
  /** Case-insensitive but requiring an imperative lead-in word. */
  ledIn: RegExp;
  ambiguous: boolean;
};

const COMPILED_TERMS: CompiledTerm[] = DEFAULT_COMMAND_TERMS.map((term) => {
  // Terms are alphabetic words separated by single spaces; no regex
  // metacharacters to escape.
  return {
    term,
    canonical: new RegExp(`(?:^|[^A-Za-z])${term}(?![A-Za-z])`),
    anyCase: new RegExp(`(?:^|[^A-Za-z])${term}(?![A-Za-z])`, "i"),
    ledIn: new RegExp(`${IMPERATIVE_LEADIN}${term}(?![A-Za-z])`, "i"),
    ambiguous: NOUN_AMBIGUOUS_TERMS.has(term.toLowerCase()),
  };
});

/**
 * Returns true when the prompt contains at least one recognized IB command
 * term under the matching rules described in the file header.
 */
export function promptContainsCommandTerm(prompt: string): boolean {
  const text = (prompt ?? "").trim();
  if (!text) return false;

  for (const compiled of COMPILED_TERMS) {
    if (compiled.canonical.test(text)) return true;
    if (!compiled.ambiguous && compiled.anyCase.test(text)) return true;
    if (compiled.ambiguous && compiled.ledIn.test(text)) return true;
  }
  return false;
}

function promptTail(prompt: string, maxChars = 140): string {
  const trimmed = (prompt ?? "").trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `…${trimmed.slice(trimmed.length - maxChars)}`;
}

/**
 * Validates every question and subpart prompt in a draft. Returns one issue
 * per prompt with zero recognized command terms. Empty array = clean draft.
 */
export function validateDraftCommandTerms(draft: AssignmentDraft): CommandTermIssue[] {
  const issues: CommandTermIssue[] = [];
  const sections = Array.isArray(draft?.sections) ? draft.sections : [];

  sections.forEach((section, sectionIndex) => {
    const heading = (section?.heading ?? "").trim() || `Part ${sectionIndex + 1}`;
    const questions: AssignmentQuestion[] = Array.isArray(section?.questions)
      ? section.questions
      : [];

    questions.forEach((question, questionIndex) => {
      const qLabel = `Q${questionIndex + 1}`;
      const subparts = Array.isArray(question?.subparts) ? question.subparts : [];

      if (subparts.length > 0) {
        // Stem question: parent prompt is exempt; every subpart must pass.
        subparts.forEach((subpart, subIndex) => {
          if (!promptContainsCommandTerm(subpart?.prompt ?? "")) {
            issues.push({
              location: `${heading}, ${qLabel}(${subpartLetter(subIndex)})`,
              promptTail: promptTail(subpart?.prompt ?? ""),
              kind: "subpart",
            });
          }
        });
        return;
      }

      if (!promptContainsCommandTerm(question?.prompt ?? "")) {
        issues.push({
          location: `${heading}, ${qLabel}`,
          promptTail: promptTail(question?.prompt ?? ""),
          kind: "question",
        });
      }
    });
  });

  return issues;
}
