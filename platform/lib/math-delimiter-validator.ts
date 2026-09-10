/**
 * math-delimiter-validator.ts
 * -------------------------------------------------------------------------
 * Un-delimited-math check for generated Nuanced Analysis drafts.
 *
 * WHY THIS EXISTS: a generated packet ("Three Faces of a Quadratic") printed
 * its header and its callout boxes as raw Typst source. Syllabus Topics
 * carried "ax^2+bx+c", caret and all. Prerequisites carried
 * "a div b := a times 1/b", so a student read the words "div" and "times"
 * where the divide and multiply signs belong. Six "What you need to start
 * this Part" bullets carried "a(b+c)=ab+ac" and
 * "(x+p)(x+q) = x^2+(p+q)x+pq" the same way, and so did both TOK
 * provocations. Every one of those is correct Typst math; the model simply
 * did not put it inside $...$, so the renderer had nothing to typeset and
 * printed the characters as typed.
 *
 * The 11b MATH rule now says in as many words that it governs every field of
 * the schema, not just question prompts -- 11c and 11d already carried that
 * clause and 11b did not, which is how the model came to treat the header as
 * exempt. This validator is the check on that rule: a flagged draft still
 * renders, but the teacher sees the warning before downloading a packet
 * whose Syllabus Topics line prints "x^2".
 *
 * DELIBERATELY QUIET, because a warning nobody trusts is worse than none.
 * It reports only notation that cannot be anything but mathematics -- a
 * caret, ":=", "sqrt(", a dotted Typst operator name, an "=" sign -- and
 * only where the renderer will print it verbatim. Prose ABOUT mathematics
 * ("a is not zero", "the coefficient of x", "Parts 3-4") is not an error and
 * is not reported. Words that are ordinary English as well as Typst
 * operators ("times", "dot", "in", "min") are left out for the same reason,
 * even though the packet misused two of them: "div" and ":=" in that same
 * sentence catch it anyway, and a rule that fires on the word "times" would
 * fire on half the prose in the packet.
 *
 * That quiet costs coverage, knowingly. An expression carrying no relation,
 * exponent or operator name -- a bare "3(x+5)" -- reads to this file exactly
 * like the "Q26(a)" and "(Parts 3-4)" that every packet's prose is full of,
 * and is left alone. Everything the reported packet actually got wrong
 * carries one of the marks below.
 *
 * IMPLEMENTATION NOTE -- deliberately written with ZERO backslash escape
 * sequences and no regular expressions at all, the same defensive style as
 * command-term-validator.ts and numbering-validator.ts, so this file cannot
 * be corrupted by the known double-backslash collapse when pushed through
 * the GitHub tools.
 */

import { subpartLetter } from "./assignments";
import type { AssignmentDraft, AssignmentSection } from "./assignments";

export type MathDelimiterIssueKind =
  /** Typst notation with no reading as English: a caret, ":=", "sqrt(", "lt.eq". */
  | "unwrapped-notation"
  /** A relation written in prose: "a(b+c)=ab+ac", "p=q", "a = 1". */
  | "unwrapped-equation";

export type MathDelimiterIssue = {
  kind: MathDelimiterIssueKind;
  /** Human-readable location, e.g. "Prerequisites" or "Part 3, bullet 2". */
  location: string;
  /** Human-readable description, ready for direct UI display. */
  detail: string;
  /** The offending text, trimmed to something a warning line can carry. */
  excerpt: string;
};

/**
 * Notation the model writes when it means mathematics and nothing else.
 * Multi-character needles come before the single "^" so that a hit is
 * described by the longest thing it actually is.
 */
const NOTATION_MARKERS: Array<{ needle: string; label: string }> = [
  { needle: ":=", label: "the definition operator :=" },
  { needle: "sqrt(", label: "sqrt(" },
  { needle: "frac(", label: "frac(" },
  { needle: "macron(", label: "macron(" },
  { needle: "plus.minus", label: "plus.minus" },
  { needle: "minus.plus", label: "minus.plus" },
  { needle: "lt.eq", label: "lt.eq" },
  { needle: "gt.eq", label: "gt.eq" },
  { needle: "eq.not", label: "eq.not" },
  { needle: "dot.op", label: "dot.op" },
  { needle: ")(", label: "bracketed factors written side by side" },
  { needle: "^", label: "an exponent caret" },
];

/**
 * Typst names that are not also English words, matched as whole words so
 * that "divide", "individual" and "Nixon" do not trip them.
 */
const NOTATION_WORDS = ["div", "RR", "ZZ", "NN", "QQ", "CC"];

/** True where a character can be part of a Typst identifier. */
function isNameChar(ch: string): boolean {
  return (
    (ch >= "a" && ch <= "z") ||
    (ch >= "A" && ch <= "Z") ||
    (ch >= "0" && ch <= "9") ||
    ch === "_"
  );
}

/** Index of `word` in `text` as a whole word, or -1. */
function indexOfWord(text: string, word: string): number {
  let from = 0;
  for (;;) {
    const at = text.indexOf(word, from);
    if (at < 0) return -1;
    const before = at === 0 ? "" : text.charAt(at - 1);
    const after = text.charAt(at + word.length);
    if (!isNameChar(before) && !isNameChar(after)) return at;
    from = at + 1;
  }
}

/**
 * The stretches of a field the renderer will print verbatim.
 *
 * rich() splits on "$" and typesets the odd-indexed pieces, so the
 * even-indexed ones are the text that reaches the page as written. (An
 * odd-indexed piece can also print verbatim, when it turns out to be prose
 * two currency dollars fenced off, but that is the opposite defect and rule
 * 11d covers it -- what is being looked for here is math with no delimiters
 * around it at all.)
 */
function undelimited(text: string): string[] {
  return text.split("$").filter((_part, i) => i % 2 === 0);
}

/** A window of `text` around `at`, short enough for one warning line. */
function excerptAround(text: string, at: number): string {
  const width = 64;
  const start = Math.max(0, at - Math.floor(width / 3));
  const end = Math.min(text.length, start + width);
  const body = text.slice(start, end).trim();
  return (start > 0 ? "..." : "") + body + (end < text.length ? "..." : "");
}

/** The earliest piece of unmistakable Typst notation in `text`, or null. */
function findNotation(text: string): { at: number; label: string } | null {
  let best: { at: number; label: string } | null = null;
  const consider = (at: number, label: string) => {
    if (at >= 0 && (best === null || at < best.at)) best = { at, label };
  };
  for (const marker of NOTATION_MARKERS) consider(text.indexOf(marker.needle), marker.label);
  for (const word of NOTATION_WORDS) consider(indexOfWord(text, word), word);
  return best;
}

/**
 * Records at most one issue for one field. One is enough: the fix is the
 * same for every hit in a field, and a warning listing the same field six
 * times is a warning the teacher scrolls past.
 */
function checkField(
  issues: MathDelimiterIssue[],
  location: string,
  value: unknown
): void {
  if (typeof value !== "string" || value.length === 0) return;

  for (const part of undelimited(value)) {
    const hit = findNotation(part);
    if (hit) {
      issues.push({
        kind: "unwrapped-notation",
        location,
        detail:
          "writes " +
          hit.label +
          " outside $...$, so it prints as typed instead of as mathematics",
        excerpt: excerptAround(part, hit.at),
      });
      return;
    }
  }

  for (const part of undelimited(value)) {
    const at = part.indexOf("=");
    if (at >= 0) {
      issues.push({
        kind: "unwrapped-equation",
        location,
        detail: "writes an equation outside $...$, so it prints as plain text",
        excerpt: excerptAround(part, at),
      });
      return;
    }
  }
}

/** Every field of one Part that the packet typesets through rich(). */
function checkSection(
  issues: MathDelimiterIssue[],
  section: AssignmentSection,
  index: number
): void {
  const heading = (section?.heading ?? "").trim() || "Part " + String(index);
  checkField(issues, heading + " heading", section?.heading);

  const bullets = Array.isArray(section?.prerequisiteBox?.items)
    ? section.prerequisiteBox.items
    : [];
  bullets.forEach((item, i) => {
    checkField(issues, heading + ", bullet " + String(i + 1), item);
  });

  if (section?.spotlight) {
    checkField(issues, heading + ", spotlight", section.spotlight.body);
  }

  const rows = Array.isArray(section?.translationTable?.rows)
    ? section.translationTable.rows
    : [];
  checkField(issues, heading + ", translation caption", section?.translationTable?.caption);
  rows.forEach((row, i) => {
    const where = heading + ", translation row " + String(i + 1);
    checkField(issues, where, row?.informal);
    checkField(issues, where, row?.formal);
  });

  if (section?.geometricReading) {
    checkField(issues, heading + ", geometric reading", section.geometricReading.body);
  }

  const questions = Array.isArray(section?.questions) ? section.questions : [];
  questions.forEach((question, q) => {
    const label = heading + ", Q" + String(q + 1);
    checkField(issues, label, question?.prompt);
    checkField(issues, label + " hint", question?.hint);
    const subparts = Array.isArray(question?.subparts) ? question.subparts : [];
    subparts.forEach((subpart, s) => {
      const sub = label + "(" + subpartLetter(s) + ")";
      checkField(issues, sub, subpart?.prompt);
      checkField(issues, sub + " hint", subpart?.hint);
    });
  });
}

/**
 * Reports every field carrying mathematics the renderer cannot typeset,
 * because the model wrote it without the $...$ around it.
 *
 * Never throws and never mutates the draft. An empty array means clean.
 */
export function validateDraftMathDelimiters(draft: AssignmentDraft): MathDelimiterIssue[] {
  const issues: MathDelimiterIssue[] = [];

  checkField(issues, "Title", draft?.title);
  checkField(issues, "Subtitle", draft?.subtitle);
  checkField(issues, "Syllabus topics", draft?.syllabusTopics);
  checkField(issues, "Prerequisites", draft?.prerequisites);
  checkField(issues, "Materials", draft?.materials);
  checkField(issues, "ATL skill", draft?.atl);
  checkField(issues, "Compulsory core", draft?.compulsoryCore);
  checkField(issues, "Planted-error intro", draft?.plantedErrorIntro);

  const instructions = Array.isArray(draft?.instructions) ? draft.instructions : [];
  instructions.forEach((line, i) => {
    checkField(issues, "Instruction " + String(i + 1), line);
  });

  const terms = Array.isArray(draft?.commandTerms) ? draft.commandTerms : [];
  terms.forEach((entry) => {
    const name = (entry?.term ?? "").trim() || "unnamed";
    checkField(issues, "Command term " + name, entry?.definition);
  });

  const toks = Array.isArray(draft?.tokProvocations) ? draft.tokProvocations : [];
  toks.forEach((tok, i) => {
    checkField(issues, "TOK provocation " + String(i + 1), tok?.body);
  });

  if (draft?.internationalMindedness) {
    checkField(issues, "International mindedness", draft.internationalMindedness.body);
  }

  const reflections = Array.isArray(draft?.reflectionQuestions) ? draft.reflectionQuestions : [];
  reflections.forEach((line, i) => {
    checkField(issues, "Reflection question " + String(i + 1), line);
  });

  const sections = Array.isArray(draft?.sections) ? draft.sections : [];
  sections.forEach((section, i) => checkSection(issues, section, i));

  return issues;
}
