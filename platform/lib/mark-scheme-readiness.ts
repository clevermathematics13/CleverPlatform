/**
 * Which parts of an assessment AI marking will skip because no mark scheme is
 * stored for them -- worked out from the grading units that assembleMarkScheme
 * (lib/ai-grading.ts) builds, so the answer is the grader's own.
 *
 * A part whose markschemeSource is "none" is dropped by
 * loadGradeableMarkScheme (lib/ai-grading-run.ts) before any model call: it
 * gets no result row and no mark. Marking is refused outright only when EVERY
 * part is like that, so a paper with a few gaps used to be marked without
 * them and say so only afterwards ("graded X/Y of Z total"). 27AH [L67] P1
 * reached the point of scanning with 12 of its 14 parts (59 of 70 marks) in
 * that state and nothing on screen said so. This module lets the import and
 * the Mark Scans page say it before any scan is marked.
 *
 * Only "none" counts. A whole-question or draft mark scheme is still marked,
 * and assembleMarkScheme already warns about each part that uses one.
 *
 * Pure, and imports GradingUnit as a type only, so it is safe in a client
 * bundle. Its wording says "AI": teacher surfaces only (platform/CLAUDE.md).
 */

import type { GradingUnit } from "./ai-grading";

/** The fields of a grading unit this module reads. */
export type ReadinessUnit = Pick<
  GradingUnit,
  "testItemId" | "questionNumber" | "partLabel" | "maxMarks" | "questionCode" | "markschemeSource"
>;

export interface MissingPart {
  testItemId: string;
  partLabel: string;
  maxMarks: number;
}

export interface MissingQuestion {
  questionNumber: number;
  /** The PPQ bank code; "" for a part that has none (a custom-authored item). */
  questionCode: string;
  parts: MissingPart[];
  /** The parts' max marks, summed. */
  marks: number;
}

export interface MarkSchemeReadiness {
  totalParts: number;
  totalMarks: number;
  missingParts: number;
  missingMarks: number;
  /** The parts with no mark scheme, grouped by question in paper order. */
  missing: MissingQuestion[];
}

/**
 * Counts every part and groups the ones with no mark scheme by question.
 * Units arrive in test_items.sort_order (assembleMarkScheme orders them so),
 * which is paper order; groups keep the order they were first seen in.
 */
export function summariseMarkSchemeReadiness(units: readonly ReadinessUnit[]): MarkSchemeReadiness {
  let totalMarks = 0;
  let missingParts = 0;
  let missingMarks = 0;
  const groups = new Map<string, MissingQuestion>();
  for (const u of units) {
    totalMarks += u.maxMarks;
    // The same test loadGradeableMarkScheme uses to drop a part.
    if (u.markschemeSource !== "none") continue;
    missingParts += 1;
    missingMarks += u.maxMarks;
    const key = `${u.questionNumber}|${u.questionCode}`;
    let group = groups.get(key);
    if (!group) {
      group = { questionNumber: u.questionNumber, questionCode: u.questionCode, parts: [], marks: 0 };
      groups.set(key, group);
    }
    group.parts.push({ testItemId: u.testItemId, partLabel: u.partLabel, maxMarks: u.maxMarks });
    group.marks += u.maxMarks;
  }
  return { totalParts: units.length, totalMarks, missingParts, missingMarks, missing: [...groups.values()] };
}

/** "4 marks", "1 mark". */
export function marksLabel(n: number): string {
  return `${n} mark${n === 1 ? "" : "s"}`;
}

/** "(a), (b)" -- or "" for a question marked as one whole part. */
export function partList(parts: readonly Pick<MissingPart, "partLabel">[]): string {
  return parts
    .filter((p) => p.partLabel)
    .map((p) => `(${p.partLabel})`)
    .join(", ");
}

/** One sentence on what AI marking will do about the gaps; null when there are none. */
export function markSchemeGapHeadline(r: MarkSchemeReadiness): string | null {
  if (r.totalParts === 0) {
    return "This assessment has no parts recorded, so there is nothing for AI marking to mark.";
  }
  if (r.missingParts === 0) return null;
  if (r.missingParts === r.totalParts) {
    return r.totalParts === 1
      ? `The only part of this assessment (${marksLabel(r.totalMarks)}) has no mark scheme, so AI marking cannot run on it until it has one.`
      : `None of the ${r.totalParts} parts (${marksLabel(r.totalMarks)}) has a mark scheme, so AI marking cannot run on this assessment until at least one does.`;
  }
  return `${r.missingParts} of ${r.totalParts} parts (${r.missingMarks} of ${marksLabel(r.totalMarks)}) ${
    r.missingParts === 1 ? "has" : "have"
  } no mark scheme and will be skipped by AI marking.`;
}

/**
 * The note an import adds to its warnings: ONE string, so the teacher sees one
 * item per issue. The headline and what to do about it, then a line per
 * question ("Q2 18M.1.SL.TZ2.S_3 (a), (b) -- 6 marks"). Null when nothing is
 * missing, and for an assessment with no parts, which has nothing to list.
 */
export function markSchemeGapWarning(r: MarkSchemeReadiness): string | null {
  const headline = markSchemeGapHeadline(r);
  if (!headline || r.missing.length === 0) return null;
  // The PPQ Bank's own per-question "Extract" writes one scheme onto every
  // part of a multi-part question (app/api/questions/ocr-latex/route.ts), so
  // point at LaTeX Review, whose "Extract & apply" splits it by part.
  const fix = r.missing.some((q) => q.questionCode)
    ? `Extract each question's mark scheme in LaTeX Review with "Extract & apply", which splits it into parts; the Mark Scans page links to each question.`
    : "These parts were saved without mark scheme text.";
  const lines = r.missing.map((q) => {
    const name = [`Q${q.questionNumber}`, q.questionCode, partList(q.parts)].filter(Boolean).join(" ");
    return `${name} -- ${marksLabel(q.marks)}`;
  });
  return [`${headline} ${fix}`, ...lines].join("\n");
}

/** Where a banner row sends the teacher to supply the missing mark scheme. */
export type GapLink =
  | { kind: "review"; href: string }
  | { kind: "bank"; href: string; notInBank: boolean }
  | { kind: "none" };

/** One question of the Mark Scans banner, ready to render. */
export interface GapRow {
  key: string;
  /** "Q5", or the paper's own "2.3" on a Formative Assessment. */
  label: string;
  /** "(a), (b)", or "" for a whole question. */
  parts: string;
  questionCode: string;
  marks: number;
  link: GapLink;
}

/**
 * The banner's rows. A bank question links to LaTeX Review on that question
 * (?focus= takes ib_questions.id); a code the bank does not hold, or one whose
 * id lookup failed (questionIdByCode null), links to the PPQ Bank search; a
 * custom part has nowhere to link to.
 */
export function markSchemeGapRows(
  r: MarkSchemeReadiness,
  opts: {
    /** ib_questions.id by code; null when that lookup failed. */
    questionIdByCode: ReadonlyMap<string, string> | null;
    /** The paper's own numbering by test_items.sort_order (lib/paper-labels.ts). */
    prefixBySortOrder?: ReadonlyMap<number, string>;
    /** test_items.sort_order by test_items.id. */
    sortOrderByItemId?: ReadonlyMap<string, number>;
  }
): GapRow[] {
  return r.missing.map((q) => {
    const firstSortOrder = opts.sortOrderByItemId?.get(q.parts[0]?.testItemId ?? "");
    const prefix = firstSortOrder === undefined ? undefined : opts.prefixBySortOrder?.get(firstSortOrder);
    let link: GapLink = { kind: "none" };
    if (q.questionCode) {
      const id = opts.questionIdByCode?.get(q.questionCode);
      link = id
        ? { kind: "review", href: `/dashboard/questions/review?focus=${encodeURIComponent(id)}` }
        : {
            kind: "bank",
            href: `/dashboard/questions?search=${encodeURIComponent(q.questionCode)}`,
            notInBank: opts.questionIdByCode !== null,
          };
    }
    return {
      key: `${q.questionNumber}|${q.questionCode}`,
      label: prefix ?? `Q${q.questionNumber}`,
      parts: partList(q.parts),
      questionCode: q.questionCode,
      marks: q.marks,
      link,
    };
  });
}
