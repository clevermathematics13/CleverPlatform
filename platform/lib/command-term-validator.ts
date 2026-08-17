/**
 * Command-term validator for generated Nuanced Analysis drafts.
 * -------------------------------------------------------------
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
 *  3. A lowercase match for terms that commonly appear as NOUNS in setup
 *     text ("the box plot below", "the initial state", "the list of
 *     values") is rejected ONLY when immediately preceded by a determiner
 *     ("the", "a", "an", "this", "that", "these", "those", "its", "your",
 *     "our", "their") — that possessive/article is what marks the word as a
 *     noun. Any other lowercase occurrence counts as the verb use, since
 *     that is how these words actually appear as the task instruction in
 *     real IB phrasing — e.g. "...find P(X∩Y) = 0.1, state, with a reason,
 *     whether X and Y are independent events" uses "state" as the sentence's
 *     own imperative verb, with no coordinating lead-in word before it at
 *     all. An earlier version of this rule required a lead-in word ("and
 *     state", "or sketch", "hence plot") before ANY lowercase ambiguous
 *     term, which incorrectly flagged that exact phrasing as missing a
 *     command term even though "state" plainly IS the command term there.
 *     Determiner-exclusion still blocks the noun archetype that motivated
 *     this rule ("the box plot below" — "state"/"plot"/etc. immediately
 *     following "the" is excluded) without over-rejecting legitimate verb
 *     phrasing that happens not to have a coordinating word before it.
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
 * Determiners that mark an immediately-following ambiguous term as a NOUN
 * ("the state", "a sketch", "your list") rather than the sentence's
 * imperative verb. This is a negative lookbehind: a lowercase ambiguous
 * term is accepted as a command term UNLESS one of these words sits right
 * before it. NOTE: every regex in this file is deliberately built without
 * any backslash escape sequences — command terms and determiners are purely
 * alphabetic (letters + spaces), so none are needed, and backslash-free
 * source is immune to the repo's known double-backslash push-corruption
 * failure mode.
 */
const NOUN_DETERMINERS = "(?:the|a|an|this|that|these|those|its|your|our|their)";

type CompiledTerm = {
  term: string;
  /** Canonical capitalization, word-bounded. */
  canonical: RegExp;
  /** Case-insensitive, word-bounded. */
  anyCase: RegExp;
  /**
   * Case-insensitive, word-bounded, AND not immediately preceded by a noun
   * determiner (see NOUN_DETERMINERS above). Used only for ambiguous terms.
   */
  verbUse: RegExp;
  ambiguous: boolean;
};

const COMPILED_TERMS: CompiledTerm[] = DEFAULT_COMMAND_TERMS.map((term) => {
  // Terms are alphabetic words separated by single spaces; no regex
  // metacharacters to escape.
  return {
    term,
    canonical: new RegExp(`(?:^|[^A-Za-z])${term}(?![A-Za-z])`),
    anyCase: new RegExp(`(?:^|[^A-Za-z])${term}(?![A-Za-z])`, "i"),
    // The left boundary MUST be a lookbehind, not a consumed [^A-Za-z]
    // character class: consuming the space before the term shifts the match
    // start past it, so a determiner-exclusion lookbehind placed right
    // before the term would then be testing the wrong position (it would
    // see what's before the consumed space, not before the term itself).
    // Node's V8 engine supports variable-length lookbehind natively.
    // TWO lookbehinds, not one: real noun phrases usually have exactly one
    // word between the determiner and the ambiguous noun ("the box plot",
    // "the initial state", "your given list") — testing only the
    // immediately-preceding word missed "the box plot" entirely (the
    // determiner sits before "box", not before "plot"), which is the exact
    // archetype this file was originally written to catch.
    verbUse: new RegExp(
      `(?<![A-Za-z])(?<!${NOUN_DETERMINERS} )(?<!${NOUN_DETERMINERS} [a-z]+ )${term}(?![A-Za-z])`,
      "i",
    ),
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
    if (compiled.ambiguous && compiled.verbUse.test(text)) return true;
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
