import type { AssignmentDraft } from "./assignments";
import { buildTestItemsFromSections } from "./formative-assessment-bridge";

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
  /** 1-9, matching the audit that motivated each rule. */
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
  }));
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

/** Rule 9: a single code gated on two independent conditions. */
function ruleConjunctOnOneMark(part: FlatPart, out: RubricFinding[]): void {
  const conjunct = (text: string) =>
    /\bboth\b/i.test(text.replace(BOTH_AS_IDIOM, ""));

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
export function validateRubric(draft: AssignmentDraft): RubricFinding[] {
  const parts = flatten(draft);
  const findings: RubricFinding[] = [];

  rulePrincipleConflict(draft, parts, findings);
  ruleFollowThroughPromised(draft, parts, findings);

  for (const part of parts) {
    ruleSelfContradiction(part, findings);
    ruleUnitsAlignment(part, findings);
    ruleBareScheme(part, findings);
    ruleExplanationExclusion(part, findings);
    ruleBareAnswerRule(part, findings);
    ruleCodeSum(part, findings);
    ruleConjunctOnOneMark(part, findings);
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
