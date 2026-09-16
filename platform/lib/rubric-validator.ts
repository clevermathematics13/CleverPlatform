import type { AssignmentDraft } from "./assignments";
import { buildTestItemsFromSections } from "./formative-assessment-bridge";
import { findLooseRegisterTerms } from "./mathematical-register";

/**
 * Pre-publication quality checks for a Formative Assessment's mark scheme.
 *
 * buildFormativeAssessmentSystemPrompt() already tells the model how a mark
 * scheme must be written -- units in both the question and the scheme, a
 * bare-answer rule on Solve/Show/Hence parts, an exclusion on explanation
 * parts, codes that sum to the part's marks. Nothing checked that the draft
 * it returned actually obeyed those rules, so a paper could ship with a
 * stated requirement nothing enforces.
 *
 * Auditing Formative Assessment 1 after the fact found 17 of 41 parts
 * carrying a scheme defect, three of which did real damage:
 *
 *   Q12(a) awarded M1 "for both expressions evaluated" and then awarded the
 *     same M1 when only one value was present. Two graders read it two ways
 *     and a student's mark hung on the difference.
 *   Q12(c) asked the student to use units and then never required them, so
 *     12 students earned the mark without any -- correctly, under the scheme
 *     as written.
 *   Q14(c) was promised follow-through by the paper's own markingPrinciples,
 *     while its own scheme never mentioned FT. A marker reading the part
 *     alone would not apply it.
 *
 * What those three share is that none is visible while reading a single
 * part: each is a disagreement BETWEEN the scheme and something else -- the
 * question, a paper-level principle, or another clause of itself. That is
 * why per-part review kept missing them, and it is what this module checks.
 *
 * Findings are advisory data, never a rewrite: a mark scheme is the
 * teacher's professional judgement, and a validator that silently edited one
 * would be substituting a regex for that judgement. Blocking findings are
 * the ones where the scheme cannot be applied as written; warnings are
 * design smells a teacher may well accept on purpose.
 */

export type RubricFindingSeverity = "block" | "warn";

export interface RubricFinding {
  /** 1-15, matching the audit or review that motivated each rule. */
  rule: number;
  /** Stable slug, safe to match on in tests and UI. */
  code: string;
  severity: RubricFindingSeverity;
  /** "Q4(c)", or "(paper)" for a draft-level finding. */
  part: string;
  message: string;
}

interface FlatPart {
  label: string;
  questionNumber: number;
  partLabel: string;
  marks: number;
  question: string;
  scheme: string;
  /**
   * The label the PAPER prints for this part -- "2.1(c)", not "Q6(c)".
   *
   * The renderer numbers questions within their level; the bridge numbers
   * them across the whole paper because that is what test_items and the
   * gradebook key on. Both are right for their own job, and a finding is
   * useless if it names a label the teacher cannot find on the page.
   */
  printedLabel: string;
  /** Whether this part renders a line marked "Answer" (see the orchestrator). */
  hasAnswerLine: boolean;
}

/** Options a paper-level rule needs and the draft alone cannot supply. */
export interface RubricContext {
  /** From the exam conditions; enables the time-budget rule. */
  timeAllowedMinutes?: number;
}

// ---- shared matchers -------------------------------------------------------

/** Papers ask for units in several voices: "Use units", "Include units", "with units". */
const UNITS_IN_QUESTION = /\b(?:use|include|state|give|show|with)\s+(?:the\s+)?units\b/i;

/**
 * A scheme REQUIRING units, as opposed to merely containing a currency symbol.
 *
 * Distinguishing the two matters more than it looks. Q13(c)'s scheme reads
 * "$684.8 or $684.80 both accepted" and Q13(d)'s offers "(e.g. $640 tax of
 * $44.80 versus $7)" -- both are worked values in an example, and treating a
 * stray "$" as a units rule flagged three good schemes on the first run. The
 * [^.] guard keeps the match inside one sentence, so a "Requires ..." in one
 * clause cannot bind to a dollar figure in the next.
 */
const UNITS_IN_SCHEME =
  /\b(?:requires?|must|needs?)\b[^.]{0,80}\b(?:units?|dollars?)\b|\band the units\b|\b(?:units?|dollars?)\b[^.]{0,40}\b(?:required|must be)\b/i;
const FOLLOW_THROUGH = /\bFT\b|\bfollow[- ]?through\b/i;
const EXPLAIN_COMMAND = /\b(explain|justify|why|describe how)\b/i;
const WORKING_COMMAND = /\b(solve|show|determine|hence)\b/i;

/**
 * Evidence that a scheme has addressed bare answers. Deliberately broad:
 * Q9(a) says "no working scores M0M0A1", Q6(b) says "a bare '$69' earns 0",
 * and Q13(c) says "requires evidence of reuse, not restarting". All three
 * discharge the same duty in different words, and a checker that only
 * recognised one phrasing would flag good schemes.
 */
const WORKING_ADDRESSED =
  /\bbare\b|\bno working\b|\bwithout working\b|\bworking\b|\bshown\b|\bevery step\b|\bM0\b|\breuse\b|\brestart|\bevidence\b/i;

/** Evidence that a scheme says what does NOT earn the mark. */
const EXCLUSION_STATED =
  /\bearns? 0\b|\bearn 0\b|\b0 marks\b|\bdo not accept\b|\bnot accept\b|\bis not\b|\bnot a\b|\bnot just\b|\bforfeits?\b|\bdepends on\b|\bmust\b/i;

function labelOf(questionNumber: number, partLabel: string): string {
  return partLabel ? `Q${questionNumber}(${partLabel})` : `Q${questionNumber}`;
}

function flatten(draft: AssignmentDraft): FlatPart[] {
  const { printed, answerLine } = paperFacts(draft);
  // Reuse the bridge so the validator checks exactly the rows that will be
  // stored and graded -- a second flattening convention here could pass a
  // draft whose stored form is different.
  return buildTestItemsFromSections("draft", draft.sections ?? []).map((row) => ({
    label: labelOf(row.question_number, row.part_label),
    questionNumber: row.question_number,
    partLabel: row.part_label,
    marks: row.max_marks,
    question: row.question_text ?? "",
    scheme: row.markscheme_text ?? "",
    printedLabel: printed.get(row.sort_order) ?? labelOf(row.question_number, row.part_label),
    hasAnswerLine: answerLine.get(row.sort_order) ?? false,
  }));
}

/**
 * How the paper labels each part, and whether it prints an Answer line,
 * keyed by the bridge's sort_order so the two walks cannot drift apart.
 */
function paperFacts(draft: AssignmentDraft): {
  printed: Map<number, string>;
  answerLine: Map<number, boolean>;
} {
  const printed = new Map<number, string>();
  const answerLine = new Map<number, boolean>();
  let sortOrder = 0;
  (draft.sections ?? []).forEach((section, sIdx) => {
    (section.questions ?? []).forEach((question, qIdx) => {
      const stem = `${sIdx + 1}.${qIdx + 1}`;
      if (question.subparts && question.subparts.length > 0) {
        question.subparts.forEach((sp, spIdx) => {
          printed.set(sortOrder, `${stem}(${String.fromCharCode(97 + spIdx)})`);
          answerLine.set(sortOrder, sp.requiresWorking === true);
          sortOrder++;
        });
      } else {
        printed.set(sortOrder, stem);
        answerLine.set(sortOrder, question.requiresWorking === true);
        sortOrder++;
      }
    });
  });
  return { printed, answerLine };
}

/**
 * Award codes the scheme actually allocates, as opposed to codes it merely
 * mentions while explaining an exception.
 *
 * A scheme says "M1 for collecting like terms" to allocate a mark and "earns
 * M1R0" to describe what happens when something is missing; both contain the
 * token M1. Counting every token would make Q8(b) look like a 3-mark part.
 * An allocation is either the code that opens the scheme ("A1. Accept
 * 7p/100.") or a code followed by "for" -- the two forms the generator's own
 * examples use.
 */
function allocatedCodes(scheme: string): number[] {
  // Keyed by match position, because a scheme opening "M1 for ..." satisfies
  // both forms and must still be counted once. AG is listed before A so the
  // alternation does not consume the "A" of "AG1" and then fail on the "G".
  const sites = new Map<number, number>();

  const opener = /^\s*(?:AG|M|A|R)([1-9])\b/.exec(scheme);
  if (opener) sites.set(opener.index, Number(opener[1]));

  const allocation = /\b(?:AG|M|A|R)([1-9])\s+for\b/g;
  let m: RegExpExecArray | null;
  while ((m = allocation.exec(scheme)) !== null) {
    sites.set(m.index, Number(m[1]));
  }

  return [...sites.values()];
}

/** Parts a marking principle names, e.g. "In Q6(b), Q13(c) and Q14(c)". */
function partsNamedIn(principle: string, parts: FlatPart[]): FlatPart[] {
  const named = new Set<string>();
  const withPart = /\bQ\s*(\d+)\s*\(\s*([a-z])\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = withPart.exec(principle)) !== null) {
    named.add(labelOf(Number(m[1]), m[2].toLowerCase()));
  }
  // A bare "Q4" names every part of question 4.
  const wholeQuestions = new Set<number>();
  const bare = /\bQ\s*(\d+)\b(?!\s*\()/gi;
  while ((m = bare.exec(principle)) !== null) wholeQuestions.add(Number(m[1]));

  return parts.filter(
    (p) => named.has(p.label) || wholeQuestions.has(p.questionNumber)
  );
}

// ---- the rules -------------------------------------------------------------

/** Rule 1: a code awarded on a "both" condition, and also awarded when only one is met. */
function ruleSelfContradiction(part: FlatPart, out: RubricFinding[]): void {
  const bothClause = /\b((?:M|A|R|AG)[1-9])\s+for\s+both\b/gi;
  const gatedOnBoth = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = bothClause.exec(part.scheme)) !== null) {
    gatedOnBoth.add(m[1].toUpperCase());
  }
  if (gatedOnBoth.size === 0) return;

  // An exception clause of the form "...alone earns M1A0" awards the first code.
  const exception = /\b(?:alone|only|one [a-z]+ alone)\b[^.]*?\b((?:M|A|R|AG)[1-9])(?:M|A|R|AG)0\b/gi;
  while ((m = exception.exec(part.scheme)) !== null) {
    const awarded = m[1].toUpperCase();
    if (gatedOnBoth.has(awarded)) {
      out.push({
        rule: 1,
        code: "scheme-self-contradiction",
        severity: "block",
        part: part.label,
        message:
          `${awarded} is awarded "for both ...", but an exception clause awards the same ` +
          `${awarded} when only one is present. Both cannot hold -- decide whether the ` +
          `partial case earns ${awarded} or not, and say so once.`,
      });
    }
  }
}

/** Rule 2: units required by the question and the scheme, or by neither. */
function ruleUnitsAlignment(part: FlatPart, out: RubricFinding[]): void {
  const asked = UNITS_IN_QUESTION.test(part.question);
  const required = UNITS_IN_SCHEME.test(part.scheme);
  if (asked && !required) {
    out.push({
      rule: 2,
      code: "units-asked-not-required",
      severity: "block",
      part: part.label,
      message:
        'The question says "use units" but the scheme never requires them, so an answer ' +
        "without units still earns the mark. Either require units in the scheme or stop asking for them.",
    });
  } else if (!asked && required) {
    out.push({
      rule: 2,
      code: "units-required-not-asked",
      severity: "block",
      part: part.label,
      message:
        "The scheme requires units the question never asks for. A student cannot be " +
        "penalised for missing an instruction they were not given.",
    });
  }
}

/** Rule 3: a principle naming a part must not assert something the part's scheme omits. */
function rulePrincipleConflict(
  draft: AssignmentDraft,
  parts: FlatPart[],
  out: RubricFinding[]
): void {
  const subjects = [
    { name: "units", inPrinciple: /\bunits?\b/i, inScheme: UNITS_IN_SCHEME },
    {
      name: "the working requirement",
      inPrinciple: /\bworking\b|\bevery step\b|\bbare\b/i,
      inScheme: WORKING_ADDRESSED,
    },
  ];
  for (const principle of draft.markingPrinciples ?? []) {
    const named = partsNamedIn(principle, parts);
    if (named.length === 0) continue;
    for (const subject of subjects) {
      if (!subject.inPrinciple.test(principle)) continue;
      for (const part of named) {
        if (subject.inScheme.test(part.scheme)) continue;
        out.push({
          rule: 3,
          code: "principle-not-reflected-in-scheme",
          severity: "block",
          part: part.label,
          message:
            `A marking principle names this part and asserts ${subject.name}, but this ` +
            `part's own scheme says nothing about it. A marker reading only the part will ` +
            `apply a different standard from one who read the principles.`,
        });
      }
    }
  }
}

/** Rule 4: FT promised by a principle must be restated in the part's scheme. */
function ruleFollowThroughPromised(
  draft: AssignmentDraft,
  parts: FlatPart[],
  out: RubricFinding[]
): void {
  for (const principle of draft.markingPrinciples ?? []) {
    if (!FOLLOW_THROUGH.test(principle)) continue;
    for (const part of partsNamedIn(principle, parts)) {
      if (FOLLOW_THROUGH.test(part.scheme)) continue;
      out.push({
        rule: 4,
        code: "follow-through-promised-not-stated",
        severity: "block",
        part: part.label,
        message:
          "A marking principle promises follow-through for this part, but the part's scheme " +
          "never mentions FT. Follow-through only happens if the marker in front of the part " +
          "knows it applies -- restate it here.",
      });
    }
  }
}

/** Rule 5: a scheme must say more than its own mark code. */
function ruleBareScheme(part: FlatPart, out: RubricFinding[]): void {
  const stripped = part.scheme
    .replace(/\b(?:M|A|R|AG|FT)[0-9]\b/g, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .trim();
  if (stripped.length === 0) {
    out.push({
      rule: 5,
      code: "bare-scheme",
      severity: "block",
      part: part.label,
      message:
        `The scheme is "${part.scheme.trim()}" and states no acceptance criterion, so every ` +
        "marker decides this part from scratch. Say what earns the mark.",
    });
  }
}

/** Rule 6: an explanation part should say what does not earn the mark. */
function ruleExplanationExclusion(part: FlatPart, out: RubricFinding[]): void {
  const isExplanation =
    EXPLAIN_COMMAND.test(part.question) || /\bR[1-9]\b/.test(part.scheme);
  if (!isExplanation) return;
  if (EXCLUSION_STATED.test(part.scheme)) return;
  out.push({
    rule: 6,
    code: "explanation-without-exclusion",
    severity: "warn",
    part: part.label,
    message:
      "An explanation part with no stated exclusion. Reasoning marks are where markers " +
      "diverge most, so name something that does NOT earn it -- a verdict, a restatement, " +
      "or the wrong reason.",
  });
}

/** Rule 7: Solve/Show/Determine/Hence parts must address bare answers. */
function ruleBareAnswerRule(part: FlatPart, out: RubricFinding[]): void {
  if (!WORKING_COMMAND.test(part.question)) return;
  if (WORKING_ADDRESSED.test(part.scheme)) return;
  out.push({
    rule: 7,
    code: "working-command-without-bare-answer-rule",
    severity: "block",
    part: part.label,
    message:
      "The command term requires visible working, but the scheme never says what a correct " +
      "answer with no working earns. That is the whole point of the command term.",
  });
}

/** A question telling the student to stop before collecting like terms. */
const NO_SIMPLIFY_IN_QUESTION =
  /\b(?:do not|don't|without|never)\s+(?:simplify|simplifying|collect|collecting)\b|\bleave\s+(?:it\s+|the answer\s+)?unsimplified\b|\bunsimplified\b/i;

/** A scheme whose credited answer is the unsimplified form. */
const UNSIMPLIFIED_IN_SCHEME =
  /\bunsimplified\b|\bnot simplified\b|\bdo not simplify\b|\bwithout simplif/i;

/**
 * Rule 10: an "unsimplified" requirement must appear on both sides.
 *
 * FA1 Q8(a) credited "the correctly distributed, unsimplified expression
 * 6k - 12 + 5k - 6" while its question said only "Expand the brackets. Write
 * the result." 42 students produced that expression; 24 were given the mark
 * and 18 were refused it for having gone on to write 11k - 18 on the answer
 * line -- a rule neither the question nor the scheme states. Q7(a), one page
 * earlier, does say "Do not simplify further", which is what makes the
 * omission at Q8(a) a slip rather than a house style.
 *
 * Checked in both directions for the same reason as rule 2: a student cannot
 * obey an instruction they were not given, and a marker should not have to
 * invent what a simplified answer earns when the question forbade it.
 */
function ruleSimplifyAlignment(part: FlatPart, out: RubricFinding[]): void {
  const questionForbids = NO_SIMPLIFY_IN_QUESTION.test(part.question);
  const schemeWantsUnsimplified = UNSIMPLIFIED_IN_SCHEME.test(part.scheme);

  if (schemeWantsUnsimplified && !questionForbids) {
    out.push({
      rule: 10,
      code: "unsimplified-required-not-asked",
      severity: "block",
      part: part.label,
      message:
        "The scheme credits the unsimplified form, but the question never tells the student " +
        "to stop there. A student who expands and then tidies up has done what was asked and " +
        "more -- say \"do not simplify further\" in the question, or accept the simplified form.",
    });
  } else if (questionForbids && !schemeWantsUnsimplified) {
    out.push({
      rule: 10,
      code: "no-simplify-asked-not-marked",
      severity: "block",
      part: part.label,
      message:
        "The question tells the student not to simplify, but the scheme never says what a " +
        "simplified answer earns. That is the one mistake this instruction invites, and every " +
        "marker will have to decide it alone.",
    });
  }
}

/** Rule 8: allocated codes must sum to the part's marks. */
function ruleCodeSum(part: FlatPart, out: RubricFinding[]): void {
  const codes = allocatedCodes(part.scheme);
  if (codes.length === 0) return; // rule 5 already covers a scheme with nothing in it
  const total = codes.reduce((a, b) => a + b, 0);
  if (total !== part.marks) {
    out.push({
      rule: 8,
      code: "code-sum-mismatch",
      severity: "warn",
      part: part.label,
      message:
        `The scheme allocates ${total} mark(s) of codes but the part is worth ${part.marks}. ` +
        "One of the two is wrong.",
    });
  }
}

/**
 * "both" that does not signal a conjunct condition. "Multiplying both sides
 * by 2" is how you describe rearranging an equation, and "both accepted" says
 * two forms are allowed -- the opposite of requiring two things at once.
 */
const BOTH_AS_IDIOM = /\bboth sides\b|\bboth accepted\b|\bboth are accepted\b/i;

/**
 * The other way a scheme writes a conjunct: an uppercase AND.
 *
 * Case is the whole signal here, and it is narrow on purpose. A lowercase
 * "and" in a mark scheme is almost always prose -- "expand and simplify",
 * "accept 0.72c and 72% of c" -- and 24 of the 76 one-mark parts in the live
 * corpus carry one, so reading every "and" as a conjunct would bury the rule
 * under its own noise within a single paper. An uppercase AND is written to
 * mean exactly this and nothing else: it appears on 6 of those 103 parts,
 * every one of them genuinely gated on two things at once, and three were
 * already caught by the word "both" standing beside it.
 *
 * KA1 Q13(b) is why this was added. Its scheme reads "R1 for reading 0.72c as
 * a 28% reduction AND giving the reason", while its question asked only
 * "explain why the student is wrong" -- so the paper printed one demand and
 * marked another. 18 of the 33 graded responses scored 0, and most of those
 * zeros are not mathematical failures: some name the 28% and give no reason,
 * some give the reason and never name the 28%, and three answered the printed
 * question exactly as printed ("0.72c != 0.7c", "if it was 30% it would be
 * 0.70c, so the student is wrong") and were marked wrong for it. Rule 14
 * checks a question against its scheme where it can name the missing words;
 * this rule catches the shape that makes the misalignment easy to write in
 * the first place, whichever half is later judged the wrong one.
 */
const AND_AS_CONJUNCT = /\bAND\b/;

/** Rule 9: a single code gated on two independent conditions. */
function ruleConjunctOnOneMark(part: FlatPart, out: RubricFinding[]): void {
  const conjunct = (text: string) => {
    const literal = text.replace(BOTH_AS_IDIOM, "");
    return /\bboth\b/i.test(literal) || AND_AS_CONJUNCT.test(literal);
  };

  const codes = allocatedCodes(part.scheme);
  const report = (code: string) => {
    out.push({
      rule: 9,
      code: "single-mark-two-conditions",
      severity: "warn",
      part: part.label,
      message:
        `${code} is gated on two conditions at once, so a wrong answer cannot tell you ` +
        "which half the student missed. Consider splitting it, or accept the lost " +
        "diagnostic detail deliberately.",
    });
  };

  // With a single award, any condition in the scheme attaches to it however
  // the sentences are arranged -- Q3(a) opens "A1." and states the conjunct
  // in the sentence after, which a clause-by-clause scan misses entirely.
  if (codes.length === 1) {
    if (conjunct(part.scheme)) {
      const award = /\b((?:AG|M|A|R)[1-9])\b/.exec(part.scheme);
      report(award ? award[1].toUpperCase() : "The mark");
    }
    return;
  }

  for (const clause of part.scheme.split(/(?<=[.;])\s+/)) {
    const award = /\b((?:AG|M|A|R)[1-9])\b/.exec(clause);
    if (!award || !conjunct(clause)) continue;
    report(award[1].toUpperCase());
    return; // one finding per part is enough to prompt a look
  }
}

// ---- entry point -----------------------------------------------------------

/**
 * Every rubric finding in a draft, in reading order. Never throws: a draft
 * with missing sections or schemes yields findings, not an exception, since
 * this runs on model output that may be malformed in any number of ways.
 */

// ---- rules 10-14: the paper as a student reads it ---------------------------
//
// The nine rules above check a mark scheme against itself and against the
// paper's own principles. These five check the QUESTION against what the page
// actually prints, which is the other place a paper can disagree with itself.
// Every one of them comes from a teacher reading a generated summative front
// to back before giving it:
//
//   "Context for Q4" sat above a question the paper numbered 2.1.
//   The instructions promised "the line marked Answer" on parts that have none.
//   Forty-six minutes of work were suggested inside a fifty-minute paper.
//
// None is a mathematical error, and every one of them costs a student time
// they were not given.

/** A cross-reference to a question by number, in any of the usual voices. */
const QUESTION_CROSS_REFERENCE = /\b(?:Q|question)\s*\.?\s*(\d+)\b/i;

/** A subpart prompt that numbers itself: "(a) ...", "a) ...", "(iii) ...". */
const SELF_NUMBERED = /^\s*\(?\s*(?:[a-z]|[ivx]{1,4})\s*[).]\s+/i;

/** The instructions promising somewhere specific to put the final answer. */
const PROMISES_ANSWER_LINE = /\bline\s+marked\s+["'\u2018\u201c]?answer\b/i;

/**
 * ... unless the promise is qualified. "On the line marked Answer where one is
 * given" is true of every paper, and a rule that flagged it would push authors
 * away from the wording that fixes the problem.
 */
const ANSWER_LINE_QUALIFIED =
  /\bwhere\s+(?:one\s+is\s+)?(?:given|provided|shown)\b|\bif\s+(?:one\s+is\s+)?(?:given|provided)\b/i;

/** A part that has just pinned the variables to particular values. */
const SUBSTITUTES_VALUES = /\b(?:when|where|if|for)\b[^.]{0,40}[a-z]\s*=\s*-?\d/i;

/** A part asking for something general rather than a number. */
const ASKS_FOR_EXPRESSION = /\bwrite\s+(?:an?|the)\s+expression\b|\bexpression\s+for\b/i;

const IN_TERMS_OF = /\bin terms of\b|\bgeneral\b|\bfor any\b/i;

/**
 * Rule 10 -- a question that numbers itself.
 *
 * The renderer prints "2.1" beside the question, from its position. A prompt
 * that also says "Context for Q6" gives the same question two names, and the
 * one it chose is not the one on the page: the bridge numbers globally for
 * test_items, the renderer numbers within the level for the student.
 */
function ruleQuestionNumbersItself(part: FlatPart, out: RubricFinding[]): void {
  const match = QUESTION_CROSS_REFERENCE.exec(part.question);
  if (!match) return;
  out.push({
    rule: 10,
    code: "question-numbers-itself",
    severity: "block",
    part: part.label,
    message:
      `The prompt refers to "${match[0]}", but the paper prints this part as ` +
      `${part.printedLabel}. A student looking for ${match[0]} will not find it. ` +
      "Drop the number -- the renderer supplies it -- or refer to a part by its " +
      "letter, as in \"your expression from part (a)\".",
  });
}

/**
 * Rule 11 -- a subpart that numbers itself.
 *
 * The renderer prints (a), (b), (c) from position. A prompt that opens "(a)"
 * is printed as "(a) (a) ...".
 */
function ruleSubpartNumbersItself(part: FlatPart, out: RubricFinding[]): void {
  if (!part.partLabel || !SELF_NUMBERED.test(part.question)) return;
  out.push({
    rule: 11,
    code: "subpart-numbers-itself",
    severity: "block",
    part: part.label,
    message:
      "The prompt begins with its own part letter, and the renderer prints one " +
      `too, so the paper reads "(a) (a) ..." at ${part.printedLabel}. Start the prompt at the question.`,
  });
}

/**
 * Rule 12 -- instructions that promise an Answer line the parts do not have.
 *
 * Only a part with requiresWorking renders "Answer" beneath its working box;
 * every other part is ruled lines. Telling a student to write their final
 * answer "on the line marked Answer" is then false for most of the paper, and
 * a student who believes it will hunt for something that is not there.
 */
function ruleAnswerLinePromise(
  draft: AssignmentDraft,
  parts: FlatPart[],
  out: RubricFinding[],
): void {
  const promise = (draft.instructions ?? []).find(
    (line) => PROMISES_ANSWER_LINE.test(line) && !ANSWER_LINE_QUALIFIED.test(line),
  );
  if (!promise) return;
  const without = parts.filter((p) => !p.hasAnswerLine);
  if (without.length === 0) return;
  out.push({
    rule: 12,
    code: "instruction-promises-missing-answer-line",
    severity: "block",
    part: "(paper)",
    message:
      `The instructions say to write the final answer on the line marked Answer, but ` +
      `${without.length} of ${parts.length} parts print no such line -- only a part that ` +
      "requires working does. Say where the answer goes on the parts that have no " +
      `Answer line (${without.slice(0, 3).map((p) => p.printedLabel).join(", ")}` +
      `${without.length > 3 ? ", ..." : ""}), or give those parts one.`,
  });
}

/**
 * Rule 13 -- the paper has to fit the time, with room to check.
 *
 * S8 of the generator prompt already says the levels must sum to no more than
 * the time allowed. Nothing enforced it, and "no more than" is not the real
 * bar: a paper that fills its own time allowance to the minute leaves nothing
 * for reading, page-turning, being stuck, or checking. Eighty per cent is the
 * usual working figure.
 */
const TIME_BUDGET_FRACTION = 0.8;

function ruleTimeBudget(
  draft: AssignmentDraft,
  context: RubricContext,
  out: RubricFinding[],
): void {
  const allowed = context.timeAllowedMinutes;
  if (!allowed || allowed <= 0) return;
  const suggested = (draft.sections ?? []).reduce(
    (sum, section) => sum + (section.estimatedMinutes ?? 0),
    0,
  );
  if (suggested <= 0) return;

  if (suggested > allowed) {
    out.push({
      rule: 13,
      code: "time-budget-exceeded",
      severity: "block",
      part: "(paper)",
      message:
        `The levels suggest ${suggested} minutes of work in a ${allowed}-minute paper. ` +
        "A paper that cannot be finished in the time printed on its own cover measures " +
        "speed rather than mathematics.",
    });
    return;
  }

  const comfortable = Math.floor(allowed * TIME_BUDGET_FRACTION);
  if (suggested > comfortable) {
    out.push({
      rule: 13,
      code: "time-budget-tight",
      severity: "warn",
      part: "(paper)",
      message:
        `The levels suggest ${suggested} minutes of work in a ${allowed}-minute paper, ` +
        `leaving ${allowed - suggested} minutes for reading, being stuck, and checking. ` +
        `About ${comfortable} minutes of work is the usual ceiling. Explanation-heavy ` +
        "papers run longest, because writing a reason takes longer than writing a value.",
    });
  }
}

/**
 * Rule 14 -- "write an expression" straight after a part that used numbers.
 *
 * Part (b) evaluates at x = 5 and y = 7; part (c) then says "write an
 * expression for the discounted total". A reasonable student cannot tell
 * whether that means the general expression or the discounted value of the
 * purchase they have just costed. Three words fix it.
 */
function ruleExpressionAfterSubstitution(parts: FlatPart[], out: RubricFinding[]): void {
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    const previous = parts[i - 1];
    if (part.questionNumber !== previous.questionNumber) continue;
    if (!ASKS_FOR_EXPRESSION.test(part.question)) continue;
    if (IN_TERMS_OF.test(part.question)) continue;
    if (!SUBSTITUTES_VALUES.test(previous.question)) continue;
    out.push({
      rule: 14,
      code: "expression-after-substitution",
      severity: "warn",
      part: part.label,
      message:
        `${previous.printedLabel} pinned the variables to particular values, and this part ` +
        "asks for an expression without saying which. Add \"in terms of ...\" so a student " +
        "cannot reasonably read it as asking for the value they just found.",
    });
  }
}

/**
 * Rule 15 -- the mathematical register.
 *
 * lib/mathematical-register.ts is spliced into every generator's system
 * prompt, but a prompt is a request. This is the check, and it reads the
 * question text and the mark scheme alike: a scheme that accepts "they
 * agree" teaches the loose word just as surely as a prompt that asks for it.
 *
 * A warning, never blocking. The patterns are narrow but they are still
 * patterns, and a teacher who has a reason to write one of these words
 * should not have to argue with a regex to save their paper.
 */
function ruleMathematicalRegister(parts: FlatPart[], out: RubricFinding[]): void {
  for (const part of parts) {
    for (const field of ["question", "scheme"] as const) {
      for (const hit of findLooseRegisterTerms(part[field])) {
        out.push({
          rule: 15,
          code: "loose-mathematical-register",
          severity: "warn",
          part: part.label,
          message:
            `${part.printedLabel}'s ${field === "question" ? "wording" : "mark scheme"} says ` +
            `"${hit.found}". Write ${hit.instead}.`,
        });
      }
    }
  }
}

export function validateRubric(
  draft: AssignmentDraft,
  /** Paper-level facts the draft does not carry; see RubricContext. */
  context: RubricContext = {},
): RubricFinding[] {
  const parts = flatten(draft);
  const findings: RubricFinding[] = [];

  rulePrincipleConflict(draft, parts, findings);
  ruleFollowThroughPromised(draft, parts, findings);
  ruleAnswerLinePromise(draft, parts, findings);
  ruleTimeBudget(draft, context, findings);
  ruleExpressionAfterSubstitution(parts, findings);
  ruleMathematicalRegister(parts, findings);

  for (const part of parts) {
    ruleSelfContradiction(part, findings);
    ruleUnitsAlignment(part, findings);
    ruleBareScheme(part, findings);
    ruleExplanationExclusion(part, findings);
    ruleBareAnswerRule(part, findings);
    ruleSimplifyAlignment(part, findings);
    ruleCodeSum(part, findings);
    ruleConjunctOnOneMark(part, findings);
    ruleQuestionNumbersItself(part, findings);
    ruleSubpartNumbersItself(part, findings);
  }

  return findings.sort((a, b) => a.rule - b.rule || a.part.localeCompare(b.part));
}

export interface RubricValidationSummary {
  blocking: number;
  warnings: number;
  /** True when nothing blocks publication. Warnings do not stop a paper. */
  publishable: boolean;
}

export function summarizeRubricFindings(
  findings: RubricFinding[]
): RubricValidationSummary {
  const blocking = findings.filter((f) => f.severity === "block").length;
  return {
    blocking,
    warnings: findings.length - blocking,
    publishable: blocking === 0,
  };
}

/**
 * Whether a save should be held back for review.
 *
 * `acknowledged` is compared against exactly `true` rather than tested for
 * truthiness, because the value arrives from a JSON body and, on the client,
 * from a click handler. `onClick={handleSave}` hands React's mouse event to
 * the first parameter, and any truthy value there would wave a paper through
 * on its first save without the teacher ever seeing a finding -- the one
 * failure that would make this gate worthless while looking like it worked.
 */
export function shouldHoldForRubricReview(
  findings: RubricFinding[],
  acknowledged: unknown
): boolean {
  return !summarizeRubricFindings(findings).publishable && acknowledged !== true;
}
