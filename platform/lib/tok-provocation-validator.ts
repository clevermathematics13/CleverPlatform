/**
 * TOK-provocation validator for generated DP Nuanced Analysis drafts.
 * -----------------------------------------------------------------------------
 * The bar in lib/tok-provocations.ts (rules T1-T8) tells the model what a TOK
 * provocation has to be. Nothing read what came back. This does, for the
 * subset of the bar a machine can decide honestly, and reports each finding
 * by the rule it breaks so the warning and the prompt speak the same language.
 *
 * WHAT IT DELIBERATELY DOES NOT CHECK. T2 (both answers defensible) and T3
 * (a position, not a topic) are the two rules that matter most and the two no
 * regex can judge. A validator that guessed at them would be wrong often, and
 * a panel that is wrong often gets ignored -- at which point it also stops
 * catching the cases it IS right about. So this checks only what is
 * mechanically decidable: the count, the named stock openers, whether the
 * provocation names anything from this packet at all, and whether the
 * Reflection actually returns to one.
 *
 * ON THE DIRECTION OF THE BIAS. validateAssessment (lib/na-assessment.ts) is
 * deliberately biased toward OVER-flagging, because a missed case there costs
 * a wrong mark on a student's grade and a false positive costs a few seconds.
 * This one is biased the other way. It is a soft warning on a teacher's
 * screen about the quality of writing they can read for themselves, so a
 * false positive on a good provocation is the expensive outcome: it teaches
 * the teacher that this panel cries wolf. Every check below therefore fires
 * only when the evidence is unambiguous, and anything arguable passes.
 *
 * DP ONLY, matching the bar. Grade 9/10 students are not in TOK and their
 * packets are generated under the older one-line rule, so validating them
 * against rules they were never given would be flagging the tool's own
 * choice. Non-DP grades return no issues at all.
 *
 * Never throws, never mutates the draft. Empty array = clean draft.
 * -----------------------------------------------------------------------------
 */

import { isDiplomaProgrammeGrade } from "./assignments";
import type { AssignmentDraft } from "./assignments";

export type TokIssueKind =
  | "count"
  | "stock-opener"
  | "unanchored"
  | "no-reflection-return"
  | "reflection-without-evidence";

export type TokIssue = {
  kind: TokIssueKind;
  /** The rule of the bar this breaks, e.g. "T1" -- see lib/tok-provocations.ts. */
  rule: string;
  /** Human-readable location, e.g. "TOK provocation 2". */
  location: string;
  /** Human-readable description, ready for direct UI display. */
  detail: string;
};

/**
 * The stock questions T6 names. Each is a real question worth asking; what
 * these patterns catch is the version that arrives unattached, which is why
 * a match alone is not an issue -- see collectIssues, where a stock opener is
 * only reported on a provocation that anchors nothing.
 *
 * NOTE: every regex in this file is built without backslash escape
 * sequences, the same rule command-term-validator.ts follows and for the
 * same reason. Character classes ([0-9], [^A-Za-z]) cover everything needed.
 */
const STOCK_OPENERS: readonly { pattern: RegExp; label: string }[] = [
  {
    pattern: /is mathematics (?:discovered or invented|invented or discovered)/i,
    label: "Is mathematics discovered or invented?",
  },
  {
    pattern: /(?:is|was) (?:mathematics|maths|math) (?:discovered|invented)(?![A-Za-z])/i,
    label: "Is mathematics discovered/invented?",
  },
  {
    pattern: /universal language/i,
    label: "Is mathematics a universal language?",
  },
  {
    pattern: /language of the universe/i,
    label: "Is mathematics the language of the universe?",
  },
  {
    pattern: /can we ever (?:be |truly |really )*(?:certain|sure|know)/i,
    label: "Can we ever be certain of anything in mathematics?",
  },
  {
    pattern: /is (?:mathematics|maths|math) beautiful/i,
    label: "Is mathematics beautiful?",
  },
] as const;

/**
 * A reference to the packet's own body. Any of these anchors a provocation
 * outright (T1) without needing the vocabulary overlap below.
 */
const PACKET_REFERENCE =
  /(?:part [0-9]|q[ .]?[0-9]|question [0-9]|this packet|this analysis|in this investigation|you (?:proved|derived|showed|found|calculated|built|constructed)|your (?:answer|result|proof|model|conjecture))/i;

/** Inline Typst math, which means the provocation is naming a real object. */
const INLINE_MATH = /[$][^$]+[$]/;

/**
 * Words too common in mathematical prose to prove a provocation is about THIS
 * packet. Without this list the overlap test below would find "mathematics"
 * or "value" in every packet and declare everything anchored.
 *
 * The second group is the one that is easy to miss and was found by a failing
 * test: words that are BOTH ordinary packet vocabulary AND ordinary TOK
 * vocabulary. "Argument" is the archetype -- a packet on polar form asks for
 * the argument of z, and a generic provocation asks whether intuition should
 * be trusted against a formal argument. The two senses have nothing to do
 * with each other, so the overlap is noise, and treating it as an anchor lets
 * exactly the bolted-on provocation this validator exists to catch go
 * through. Same for proof, theorem and prove, which appear in any packet that
 * proves something and in any provocation about certainty.
 */
const GENERIC_WORDS = new Set([
  "about", "above", "accept", "after", "again", "against", "already", "also",
  "although", "always", "another", "answer", "answers", "anything", "appear",
  "appears", "argue", "argument", "arguments", "assume", "because", "become", "before", "being",
  "believe", "believed", "better", "between", "both", "calculate",
  "calculation", "calculations", "certain", "certainty", "claim", "class",
  "common", "complete", "conclusion", "conclusions", "consider", "correct",
  "could", "course", "decide", "defend", "describe", "different", "does",
  "doing", "either", "enough", "equal", "evidence", "exactly", "example",
  "explain", "first", "follow", "formal", "found", "from", "further", "given", "gives",
  "happen", "harder", "having", "however", "identify", "important", "instead",
  "knowing", "knowledge", "known", "later", "learn", "learned", "makes",
  "making", "match", "material", "math", "mathematical", "mathematician",
  "mathematicians", "mathematics", "maths", "means", "meant", "method",
  "methods", "might", "modelling", "modeling", "more", "mostly", "much",
  "must", "never", "notice", "number", "numbers", "numerical", "object",
  "objects", "often", "only", "other", "others", "otherwise", "output",
  "packet", "part", "parts", "people", "perhaps", "place", "position",
  "possible", "practice", "precise", "precision", "problem", "problems",
  "process", "proof", "proofs", "prove", "proved", "proves", "proving",
  "question", "questions", "reach", "really", "reason",
  "reasons", "result", "results", "right", "same", "school", "science",
  "separate", "should", "shows", "simply", "since", "solution", "solutions",
  "solve", "some", "something", "sometimes", "still", "student", "students",
  "study", "such", "support", "suppose", "taken", "teacher", "than", "that", "theorem", "theorems",
  "their", "them", "then", "there", "therefore", "these", "they", "thing",
  "things", "think", "this", "those", "though", "three", "through", "true",
  "truth", "under", "understand", "until", "using", "usually", "value",
  "values", "wanted", "were", "what", "whatever", "when", "where", "whether",
  "which", "while", "whole", "will", "with", "within", "without", "work",
  "working", "would", "write", "written", "wrong", "your",
]);

/**
 * Substantive words in a piece of text: long enough to carry topic meaning,
 * and not on the generic list. Five characters is the floor because the words
 * that actually anchor a provocation ("logarithm", "modulus", "Maclaurin",
 * "Wessel") are all longer than that, while the short ones are articles and
 * operators.
 */
function contentWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of (text ?? "").toLowerCase().split(/[^a-z]+/)) {
    if (word.length >= 5 && !GENERIC_WORDS.has(word)) out.add(word);
  }
  return out;
}

/**
 * Everything a provocation could legitimately be about: what the packet says
 * it covers, what its Parts are called, and what it actually asks.
 */
function packetVocabulary(draft: AssignmentDraft): Set<string> {
  const parts: string[] = [
    draft?.title ?? "",
    draft?.subtitle ?? "",
    draft?.syllabusTopics ?? "",
    draft?.prerequisites ?? "",
    draft?.atl ?? "",
  ];
  for (const section of draft?.sections ?? []) {
    parts.push(section?.heading ?? "");
    for (const question of section?.questions ?? []) {
      parts.push(question?.prompt ?? "");
      for (const subpart of question?.subparts ?? []) parts.push(subpart?.prompt ?? "");
    }
  }
  return contentWords(parts.join(" "));
}

/**
 * Does this provocation name anything from this packet (T1), and would it
 * survive the portability test (T5)?
 *
 * Three ways to pass, any one of which is enough. The vocabulary overlap is
 * the portability test in mechanical form: a provocation sharing no
 * substantive word with the packet it sits on top of could be pasted onto any
 * other packet unchanged, which is exactly what T5 asks you to check.
 */
function isAnchored(body: string, vocabulary: Set<string>): boolean {
  if (PACKET_REFERENCE.test(body)) return true;
  if (INLINE_MATH.test(body)) return true;
  for (const word of contentWords(body)) {
    if (vocabulary.has(word)) return true;
  }
  return false;
}

function firstStockOpener(body: string): string | null {
  for (const { pattern, label } of STOCK_OPENERS) {
    if (pattern.test(body)) return label;
  }
  return null;
}

/** A reflection question that returns to a provocation at all (T8). */
const REFLECTION_RETURN = /(?:tok|theory of knowledge|provocation)/i;

/**
 * Deliberately generous: any of these counts as asking for evidence. The
 * check exists to catch a reflection prompt that asks how the student FEELS
 * about mathematics, not to police phrasing.
 */
const REFLECTION_EVIDENCE =
  /(?:result|evidence|q[ .]?[0-9]|question [0-9]|part [0-9]|numbered|your (?:answer|proof|working)|specific)/i;

function collectIssues(draft: AssignmentDraft): TokIssue[] {
  const issues: TokIssue[] = [];
  const provocations = Array.isArray(draft?.tokProvocations) ? draft.tokProvocations : [];

  if (provocations.length !== 2) {
    issues.push({
      kind: "count",
      rule: "T0",
      location: "TOK provocations",
      detail:
        provocations.length === 0
          ? "This packet has no TOK provocations. The contract is exactly 2, and the Reflection returns to one of them."
          : `This packet has ${provocations.length}. The contract is exactly 2, and the Reflection returns to one of them.`,
    });
  }

  const vocabulary = packetVocabulary(draft);

  provocations.forEach((provocation, index) => {
    const body = (provocation?.body ?? "").trim();
    const location = `TOK provocation ${index + 1}`;
    if (!body) {
      issues.push({
        kind: "count",
        rule: "T0",
        location,
        detail: "This provocation is empty.",
      });
      return;
    }

    if (isAnchored(body, vocabulary)) return;

    // Unanchored. If it is also one of the stock questions, say which -- that
    // is a more useful warning than the general one, and one issue per
    // provocation keeps the panel readable.
    const stock = firstStockOpener(body);
    if (stock) {
      issues.push({
        kind: "stock-opener",
        rule: "T6",
        location,
        detail: `Reads as the stock question "${stock}" with nothing from this packet attached. Reach the same question through an object the packet actually builds.`,
      });
      return;
    }

    issues.push({
      kind: "unanchored",
      rule: "T1/T5",
      location,
      detail:
        "Names nothing from this packet — no Part or question, no mathematical object, and no vocabulary this packet uses. It would fit any other packet unchanged.",
    });
  });

  // Only judged when the draft has a Reflection at all: a missing Reflection
  // is a different defect, and reporting it here would double up.
  const reflection = Array.isArray(draft?.reflectionQuestions) ? draft.reflectionQuestions : [];
  if (reflection.length > 0) {
    const returning = reflection.filter((q) => REFLECTION_RETURN.test(q ?? ""));
    if (returning.length === 0) {
      issues.push({
        kind: "no-reflection-return",
        rule: "T8",
        location: "Reflection",
        detail:
          "No reflection question returns to a TOK provocation. The provocations are printed as something the student will be asked to defend.",
      });
    } else if (!returning.some((q) => REFLECTION_EVIDENCE.test(q ?? ""))) {
      issues.push({
        kind: "reflection-without-evidence",
        rule: "T8",
        location: "Reflection",
        detail:
          "The TOK reflection question does not ask for a result from this packet as the evidence, so it invites an opinion the student cannot support.",
      });
    }
  }

  return issues;
}

/**
 * Validates a generated draft's TOK provocations against the decidable part
 * of the bar. Returns no issues for pre-DP grades, which are not held to it.
 */
export function validateDraftTokProvocations(
  draft: AssignmentDraft,
  gradeLevel: string,
): TokIssue[] {
  if (!isDiplomaProgrammeGrade(gradeLevel)) return [];
  return collectIssues(draft);
}
