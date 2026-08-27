/**
 * na-anchor-locking.ts
 * -----------------------------------------------------------------------------
 * Validation gate for na_packet_versions.anchors_locked.
 *
 * WHY THIS EXISTS: A.1 ("Sixty Times a Person") shipped and was graded for
 * nine days with five real bugs, all found by hand, after the fact:
 * sub-part marks summing to more than the question's total (Q1, Q6, Q7,
 * Q13, Q19), a question with zero anchors at all (Q26(a) -- the plotting
 * grid, missed because auto_fillrect only detects FILLED rectangles and a
 * ruled grid has none), two competing answer keys with no defined
 * precedence, the assessor never seeing the actual question text, and no
 * master PDF retained after anchor locking. None of that was caught by
 * anything mechanical -- there was no gate to catch it. This module is that
 * gate: it is meant to run BEFORE any future na_packet_versions row is
 * flipped to anchors_locked = true, so the same bug classes fail loudly at
 * lock time instead of shipping silently.
 *
 * THE POSITIONAL MAPPING, AND WHY IT'S SAFE: nuanced_analyses.parts is a
 * JSONB array of { heading, questions: [...] }. Flattened in order, each
 * "question" entry is ONE base question (Q1, Q2, ... -- never a sub-part;
 * Q26's single parts[] entry covers (a)+(b)+(c) as one prompt/answer/marks
 * triple). na_anchors has no column linking an anchor back to its
 * parts[] entry, so the only signal available is POSITION: the Nth
 * question in parts[] with marks > 0 (this module's definition of
 * "gradable") should correspond to the Nth anchor base_qid group ordered
 * by sort_order. This was verified by hand against every row of A.1's
 * real data before being trusted here: 30 gradable parts[] questions map
 * 1:1, in order, onto Q1..Q30's anchor groups, with every mark sum
 * matching exactly (including Q26's corrected 2+1+2=5). The one na_anchors
 * group that isn't a numbered question ("ACTIVITY[MY NOTICINGS FROM THE
 * SANDBOX]") has marks_available = null on every anchor in the group --
 * that null-sum is what marks it as intentionally ungraded and excludes
 * it from the positional pairing, the same way a marks:0 parts[] entry
 * (e.g. the Desmos slider exploration, or the optional Branch A/B/C
 * extensions) is excluded from the gradable list. A base group is
 * "gradable" here iff at least one of its anchors has a non-null
 * marks_available -- never based on question_marks, which this module is
 * itself partly responsible for populating and so cannot be trusted as an
 * input.
 *
 * This module is pure and side-effect free (no Supabase, no fetch) so it
 * can be unit tested directly against real fixture shapes.
 */

export interface GradablePartsQuestion {
  /** 1-indexed position in the full flattened parts[] questions list (for error messages). */
  ordinal: number;
  prompt: string;
  answer: string | null;
  marks: number;
}

/**
 * Flattens nuanced_analyses.parts (an array of { questions: [...] }) into a
 * single ordered list, keeping only questions with marks > 0 -- a marks:0
 * entry is exploration/discussion content with nothing to grade, and is
 * never expected to have an anchor.
 */
export function extractGradableQuestions(parts: unknown): GradablePartsQuestion[] {
  if (!Array.isArray(parts)) return [];
  const out: GradablePartsQuestion[] = [];
  let ordinal = 0;
  for (const part of parts) {
    const questions = (part as { questions?: unknown } | null)?.questions;
    if (!Array.isArray(questions)) continue;
    for (const q of questions) {
      ordinal++;
      const marks = Number((q as { marks?: unknown } | null)?.marks ?? 0);
      if (!(marks > 0)) continue;
      const prompt = String((q as { prompt?: unknown } | null)?.prompt ?? "");
      const answerRaw = (q as { answer?: unknown } | null)?.answer;
      out.push({
        ordinal,
        prompt,
        answer: typeof answerRaw === "string" ? answerRaw : null,
        marks,
      });
    }
  }
  return out;
}

export interface AnchorForLock {
  id: string;
  qid: string;
  baseQid: string;
  sortOrder: number;
  marksAvailable: number | null;
  commandTerm: string | null;
}

export interface AnchorBaseGroup {
  baseQid: string;
  /** min sort_order across the group's anchors -- how groups are ordered. */
  sortOrder: number;
  anchors: AnchorForLock[];
}

/** Groups anchors by base_qid, ordered by each group's earliest sort_order. */
export function groupAnchorsByBase(anchors: AnchorForLock[]): AnchorBaseGroup[] {
  const groups = new Map<string, AnchorForLock[]>();
  for (const a of anchors) {
    const list = groups.get(a.baseQid);
    if (list) list.push(a);
    else groups.set(a.baseQid, [a]);
  }
  return [...groups.entries()]
    .map(([baseQid, groupAnchors]) => ({
      baseQid,
      sortOrder: Math.min(...groupAnchors.map((a) => a.sortOrder)),
      anchors: groupAnchors,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** A group is gradable iff at least one anchor in it declares a mark value. */
function isGradableGroup(group: AnchorBaseGroup): boolean {
  return group.anchors.some((a) => a.marksAvailable != null);
}

export interface MarkSplitMismatch {
  baseQid: string;
  anchorSum: number;
  authoritativeMarks: number;
  partsOrdinal: number;
}

export interface CoverageProblem {
  kind: "missing_anchor" | "unexpected_anchor";
  /** Present for missing_anchor: the parts[] question with no anchor. */
  partsOrdinal?: number;
  promptSnippet?: string;
  /** Present for unexpected_anchor: the anchor base with no parts[] question at its position. */
  baseQid?: string;
}

export interface LockValidationResult {
  markSplitMismatches: MarkSplitMismatch[];
  coverageProblems: CoverageProblem[];
  /** Gradable anchor groups paired 1:1, in order, with gradable parts[] questions. Empty on any coverage problem. */
  pairs: { group: AnchorBaseGroup; question: GradablePartsQuestion }[];
}

/**
 * Runs both checks (a) and (b) from the lock gate: mark-split (do a base
 * question's anchors sum to its authoritative parts[] total) and coverage
 * (does every gradable parts[] question have at least one anchor, and does
 * every gradable anchor group correspond to a real parts[] question).
 *
 * Returns pairs only when coverage is clean (equal counts, positionally
 * aligned) -- a coverage problem means the positional mapping itself isn't
 * trustworthy, so mark-split comparisons for the misaligned tail would be
 * comparing the wrong questions to each other and are deliberately skipped
 * rather than reported as false mark-split failures.
 */
export function validateAnchorLock(
  anchorGroups: AnchorBaseGroup[],
  gradableQuestions: GradablePartsQuestion[]
): LockValidationResult {
  const gradableGroups = anchorGroups.filter(isGradableGroup);

  const coverageProblems: CoverageProblem[] = [];
  const len = Math.max(gradableGroups.length, gradableQuestions.length);
  for (let i = 0; i < len; i++) {
    const group = gradableGroups[i];
    const question = gradableQuestions[i];
    if (question && !group) {
      coverageProblems.push({
        kind: "missing_anchor",
        partsOrdinal: question.ordinal,
        promptSnippet: question.prompt.slice(0, 80),
      });
    } else if (group && !question) {
      coverageProblems.push({ kind: "unexpected_anchor", baseQid: group.baseQid });
    }
  }

  if (coverageProblems.length > 0) {
    return { markSplitMismatches: [], coverageProblems, pairs: [] };
  }

  const pairs = gradableGroups.map((group, i) => ({ group, question: gradableQuestions[i] }));

  const markSplitMismatches: MarkSplitMismatch[] = [];
  for (const { group, question } of pairs) {
    const anchorSum = group.anchors.reduce((sum, a) => sum + (a.marksAvailable ?? 0), 0);
    if (anchorSum !== question.marks) {
      markSplitMismatches.push({
        baseQid: group.baseQid,
        anchorSum,
        authoritativeMarks: question.marks,
        partsOrdinal: question.ordinal,
      });
    }
  }

  return { markSplitMismatches, coverageProblems: [], pairs };
}

export interface RubricItemRow {
  qid: string;
  base_qid: string;
  question_number: number;
  question_text: string;
  answer_key: string | null;
  command_term: string | null;
  marks: number | null;
  question_marks: number;
  source: string;
}

/**
 * Builds one na_rubric_items row per ANCHOR (not per base question), so
 * sub-parts with their own answer box (Q26(a), Q26(b), Q26(c)) each get
 * their own editable rubric entry -- mirrors the precedent set by
 * migration 20260823151455_populate_na_rubric_items_a1.sql. question_text
 * and answer_key are the base question's single parts[] prompt/answer
 * (there is no structural sub-part breakdown in parts[] JSON -- only the
 * anchors know where the physical boxes are), while marks is each
 * anchor's own share.
 */
export function buildRubricItemRows(pairs: LockValidationResult["pairs"]): RubricItemRow[] {
  const rows: RubricItemRow[] = [];
  pairs.forEach(({ group, question }, index) => {
    for (const anchor of group.anchors) {
      rows.push({
        qid: anchor.qid,
        base_qid: group.baseQid,
        question_number: index + 1,
        question_text: question.prompt,
        answer_key: question.answer,
        command_term: anchor.commandTerm,
        marks: anchor.marksAvailable,
        question_marks: question.marks,
        source: "generated",
      });
    }
  });
  return rows;
}
