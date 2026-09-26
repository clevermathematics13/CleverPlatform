/**
 * The bulk mark-scheme build: what a transcription must look like, how it is
 * checked, and how it becomes changes to question_parts.
 *
 * Pure (zod, KaTeX and other pure modules only), so every rule here is
 * covered by markscheme-build.test.ts. The model call lives in
 * lib/markscheme-transcribe.ts; writing is done by the database function
 * apply_markscheme_build, which re-checks the rows before it changes them.
 *
 * The rules, and why (docs/HANDOFF.md has the counts):
 * - A part that already has a scheme, or that a teacher verified, is never
 *   overwritten. The one exception is a question whose parts all carry the
 *   same whole-question text, which an old per-question "Extract" wrote.
 * - A question already used by a test or a saved exam keeps its structure:
 *   the build may only fill parts, or create exactly the labels those tests
 *   use. Anything else is flagged for the teacher, because the grader joins
 *   test_items to question_parts by label at marking time.
 * - Otherwise the printed scheme decides the parts: a single unlabelled part
 *   is relabelled to the first printed label and the others are inserted.
 * - A question with any flag gets no changes at all. Half a question is
 *   worse than none: the teacher reviews it whole.
 */

import katex from "katex";
import { z } from "zod";
import { summarizeSchemeMarks } from "@/lib/mark-codes";
import { sortOrderFromLabel } from "@/lib/part-labels";

// ---- what the model returns ---------------------------------------------

export const TranscribedPartSchema = z.object({
  label: z
    .string()
    .describe('The part label exactly as printed, such as "(a)" or "(b)(ii)". "" when the question has no labelled parts.'),
  marks: z
    .number()
    .int()
    .nullable()
    .describe('The marks the scheme prints for this part, such as 3 for "[3 marks]". null when it prints none for this part.'),
  latex: z
    .string()
    .describe("This part's mark scheme as LaTeX, every mark code after \\hfill, ending with \\hfill [N marks] when marks are printed."),
});

export const TranscribedSchemeSchema = z.object({
  questionNumber: z
    .number()
    .int()
    .nullable()
    .describe("The question number printed on the scheme, or null when none is visible."),
  totalMarks: z
    .number()
    .int()
    .nullable()
    .describe('The question total from "Total [N marks]", or null when it is not printed.'),
  parts: z.array(TranscribedPartSchema),
  unreadable: z
    .array(z.string())
    .describe("Each place you could not read with certainty. Empty when there are none."),
  sourceProblems: z
    .array(z.string())
    .describe(
      "Real problems with the images only: a different question, a scheme visibly cut off, a reference to a part that is not there. Never a missing question number, label, marks or total. Empty when there are none."
    ),
  misprints: z
    .array(z.string())
    .describe("Each obvious misprint in the scheme itself, transcribed as printed. Empty when there are none."),
  diagrams: z
    .array(z.string())
    .describe("Each diagram or graph described in words instead of transcribed. Empty when there are none."),
});

export type TranscribedScheme = z.infer<typeof TranscribedSchemeSchema>;

/** A transcription as a build row stores it; the first prompt version did not ask for misprints or diagrams. */
export function readStoredTranscription(raw: unknown): TranscribedScheme | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const parsed = TranscribedSchemeSchema.safeParse({ misprints: [], diagrams: [], ...(raw as Record<string, unknown>) });
  return parsed.success ? parsed.data : null;
}

// ---- labels and codes -------------------------------------------------------

/** "(b)(ii)" -> "bii", "(a)" -> "a", "Part (c)" -> "c", "" -> "". */
export function toBankLabel(printed: string): string {
  return printed
    .toLowerCase()
    .replace(/\bpart\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

const BANK_LABEL_RE = /^[a-z](?:i|ii|iii|iv|v|vi|vii|viii|ix|x)?$/;
const TOP_LEVEL_ROMAN = new Set(["ii", "iii", "iv", "vi", "vii", "viii", "ix"]);

/** '' or a letter with an optional roman numeral: what unitLabel can print. */
export function isValidBankLabel(label: string): boolean {
  return label === "" || BANK_LABEL_RE.test(label);
}

/** The question number a bank code names: "22N.1.SL.TZ0.S_1" -> 1, "08M.2.AHL.TZ2.H_09" -> 9, "SP.2.01" -> 1. */
export function questionNumberFromCode(code: string): number | null {
  const m = code.match(/_(\d+)$/) ?? code.match(/\.(\d+)$/);
  return m ? Number(m[1]) : null;
}

// ---- normalising a transcription ------------------------------------------

export interface NormalizedPart {
  /** Bank label, e.g. "bii". */
  label: string;
  /** As the scheme printed it, e.g. "(b)(ii)". */
  printedLabel: string;
  marks: number | null;
  latex: string;
}

export interface NormalizedScheme {
  questionNumber: number | null;
  totalMarks: number | null;
  parts: NormalizedPart[];
  unreadable: string[];
  sourceProblems: string[];
  misprints: string[];
  diagrams: string[];
}

const TOTAL_LINE_RE = /^\s*(?:\\hfill\s*)?(?:\\textbf\{\s*)?total\s*\[\s*(\d+)\s*marks?\s*\]\s*\}?\s*$/gim;

function marksStatement(marks: number): string {
  return `\\hfill [${marks} ${marks === 1 ? "mark" : "marks"}]`;
}

/**
 * Bank labels, paper order, and two mechanical repairs the checks would
 * otherwise flag: a "Total [N marks]" line inside a part moves to
 * totalMarks, and a part whose printed marks the text does not state gets
 * its "\hfill [N marks]" appended.
 */
export function normalizeTranscription(t: TranscribedScheme): NormalizedScheme {
  let totalMarks = t.totalMarks;
  const parts = t.parts.map((p) => {
    let latex = p.latex.replace(TOTAL_LINE_RE, (_, n: string) => {
      totalMarks ??= Number(n);
      return "";
    });
    latex = latex.replace(/\n{3,}/g, "\n\n").trim();
    if (p.marks !== null && !/\[\s*\d+\s*marks?\s*\]/i.test(latex)) {
      latex = `${latex}\n\n${marksStatement(p.marks)}`;
    }
    return { label: toBankLabel(p.label), printedLabel: p.label.trim(), marks: p.marks, latex };
  });
  const ordered = parts
    .map((p, i) => ({ p, i }))
    .sort((a, b) => sortOrderFromLabel(a.p.label, 1000 + a.i) - sortOrderFromLabel(b.p.label, 1000 + b.i) || a.i - b.i)
    .map(({ p }) => p);
  return {
    questionNumber: t.questionNumber,
    totalMarks,
    parts: ordered,
    unreadable: t.unreadable,
    sourceProblems: t.sourceProblems,
    misprints: t.misprints,
    diagrams: t.diagrams,
  };
}

// ---- a teacher's corrections, from LaTeX Review ----------------------------

/** One proposed part as LaTeX Review shows it and the teacher edits it. */
export interface EditedPart {
  /** As printed, e.g. "(a)" or "(b)(ii)"; "" when the question has no labelled parts. */
  label: string;
  marks: number | null;
  latex: string;
}

/** The proposal a flagged build makes: its parts in paper order, with the marks the checks settled on. */
export function proposalParts(t: TranscribedScheme, resolvedMarks: readonly (number | null)[] = []): EditedPart[] {
  return normalizeTranscription(t).parts.map((p, i) => ({
    label: p.printedLabel,
    marks: p.marks ?? resolvedMarks[i] ?? null,
    latex: p.latex,
  }));
}

/**
 * A teacher's corrected proposal as a scheme to plan from. The teacher has
 * checked it against the images, so their marks stand and the code
 * arithmetic is not checked again. What is still refused is anything the
 * bank cannot hold: no parts, labels the marking screen cannot print or a
 * label twice, an unlabelled part beside labelled ones, marks that are not
 * whole numbers, an empty scheme, or maths KaTeX cannot render.
 */
export function schemeFromEdits(
  original: TranscribedScheme,
  edits: readonly EditedPart[]
): { scheme: NormalizedScheme; marks: number[]; problems: string[] } {
  const scheme = normalizeTranscription({
    questionNumber: original.questionNumber,
    totalMarks: null,
    parts: edits.map((e) => ({
      label: e.label,
      marks: e.marks,
      // A marks statement the teacher did not update would contradict their marks.
      latex: e.latex.replace(MARKS_STATEMENT_END_RE, "").trim(),
    })),
    unreadable: [],
    sourceProblems: [],
    misprints: original.misprints ?? [],
    diagrams: original.diagrams ?? [],
  });
  const problems: string[] = [];
  if (scheme.parts.length === 0) problems.push("There are no parts to save.");
  problems.push(...labelIssues(scheme.parts));
  for (const p of scheme.parts) {
    const name = p.printedLabel || "The question";
    if (p.marks === null || !Number.isInteger(p.marks) || p.marks < 0) problems.push(`${name} needs its marks as a whole number.`);
    if (!p.latex.replace(MARKS_STATEMENT_END_RE, "").trim()) problems.push(`${name} has no scheme text.`);
    for (const e of latexMathErrors(p.latex)) problems.push(`${name}: maths does not render: ${e}`);
  }
  return { scheme, marks: scheme.parts.map((p) => p.marks ?? 0), problems };
}

// ---- sub-parts that share their parent's marks ------------------------------

const ROMANS = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"];
const SUBPART_LINE_RE = /^\s*\((i|ii|iii|iv|v|vi|vii|viii|ix|x)\)(?=\s|$)\s*/;
const MARKS_STATEMENT_END_RE = /\\hfill\s*\[\s*\d+\s*marks?\s*\]\s*$/i;

/**
 * A part whose (i), (ii) ... share one printed "[N marks]", cut at the lines
 * that start with those labels. Each piece is valued by its own codes, and
 * the pieces must add up to the part's marks. Null when it cannot be cut
 * cleanly: scheme text before "(i)", labels out of order, or a piece whose
 * codes allow more than one total.
 */
export function splitSubparts(p: NormalizedPart): NormalizedPart[] | null {
  if (!p.label) return null;
  const pieces: { roman: string; lines: string[] }[] = [];
  for (const line of p.latex.replace(MARKS_STATEMENT_END_RE, "").trim().split("\n")) {
    const m = line.match(SUBPART_LINE_RE);
    if (m) pieces.push({ roman: m[1], lines: [line.slice(m[0].length)] });
    else if (pieces.length > 0) pieces[pieces.length - 1].lines.push(line);
    else if (line.trim()) return null;
  }
  if (pieces.length < 2 || pieces.some((piece, i) => piece.roman !== ROMANS[i])) return null;

  const out: NormalizedPart[] = [];
  for (const piece of pieces) {
    const body = piece.lines.join("\n").trim();
    const totals = summarizeSchemeMarks(body).possibleTotals;
    if (!body || totals.length !== 1) return null;
    out.push({
      label: `${p.label}${piece.roman}`,
      printedLabel: `${p.printedLabel}(${piece.roman})`,
      marks: totals[0],
      latex: `${body}\n\n${marksStatement(totals[0])}`,
    });
  }
  if (p.marks !== null && out.reduce((s, x) => s + (x.marks ?? 0), 0) !== p.marks) return null;
  return out;
}

export interface AlignedScheme {
  scheme: NormalizedScheme;
  marks: (number | null)[];
  /** Labels whose marks came from their codes, because the scheme printed only their parent's. */
  derived: Set<string>;
}

/**
 * The scheme with a part cut into its sub-parts wherever the bank (or a
 * test) uses exactly those sub-part labels and not the part's own. The IB
 * often prints one "[5 marks]" for (a) while the question paper, and so the
 * bank, gives (a)(i) and (a)(ii) marks of their own.
 */
export function alignSubparts(scheme: NormalizedScheme, marks: (number | null)[], wanted: Set<string>): AlignedScheme {
  const parts: NormalizedPart[] = [];
  const outMarks: (number | null)[] = [];
  const derived = new Set<string>();
  scheme.parts.forEach((p, i) => {
    const subLabels = [...wanted].filter(
      (l) => p.label !== "" && l.startsWith(p.label) && ROMANS.includes(l.slice(p.label.length))
    );
    if (subLabels.length > 0 && !wanted.has(p.label)) {
      const pieces = splitSubparts({ ...p, marks: marks[i] ?? p.marks });
      if (pieces && pieces.length === subLabels.length && pieces.every((q) => wanted.has(q.label))) {
        for (const q of pieces) {
          parts.push(q);
          outMarks.push(q.marks);
          derived.add(q.label);
        }
        return;
      }
    }
    parts.push(p);
    outMarks.push(marks[i]);
  });
  return { scheme: { ...scheme, parts }, marks: outMarks, derived };
}

// ---- KaTeX ------------------------------------------------------------------

interface MathSpan {
  tex: string;
  display: boolean;
}

/** The maths in a LaTeX string: $$..$$, $..$, \[..\], \(..\); \$ is a dollar. */
export function mathSpans(latex: string): { spans: MathSpan[]; unbalanced: boolean } {
  const spans: MathSpan[] = [];
  let i = 0;
  while (i < latex.length) {
    const ch = latex[i];
    if (ch === "\\" && latex[i + 1] === "$") {
      i += 2;
      continue;
    }
    const open =
      latex.startsWith("$$", i) ? "$$" : ch === "$" ? "$" : latex.startsWith("\\[", i) ? "\\[" : latex.startsWith("\\(", i) ? "\\(" : null;
    if (!open) {
      i += 1;
      continue;
    }
    const close = open === "\\[" ? "\\]" : open === "\\(" ? "\\)" : open;
    let j = i + open.length;
    let found = -1;
    while (j < latex.length) {
      if (latex[j] === "\\" && (open === "$" || open === "$$") && latex[j + 1] === "$") {
        j += 2;
        continue;
      }
      if (latex.startsWith(close, j)) {
        found = j;
        break;
      }
      j += 1;
    }
    if (found < 0) return { spans, unbalanced: true };
    spans.push({ tex: latex.slice(i + open.length, found), display: open === "$$" || open === "\\[" });
    i = found + close.length;
  }
  return { spans, unbalanced: false };
}

/** Every maths span KaTeX cannot parse. LatexRenderer shows those as red source text. */
export function latexMathErrors(latex: string): string[] {
  const { spans, unbalanced } = mathSpans(latex);
  const errors: string[] = [];
  if (unbalanced) errors.push("unbalanced maths delimiters");
  for (const span of spans) {
    try {
      katex.renderToString(span.tex, { displayMode: span.display, throwOnError: true, strict: "ignore" });
    } catch (err) {
      const message = err instanceof Error ? err.message.replace(/^KaTeX parse error:\s*/, "") : String(err);
      errors.push(`"${span.tex.slice(0, 40)}${span.tex.length > 40 ? "..." : ""}": ${message}`);
    }
  }
  return errors;
}

// ---- checks -----------------------------------------------------------------

export interface CheckContext {
  /** The number the bank code names, e.g. 4 for "...H_4". */
  expectedQuestionNumber: number | null;
  /** The bank's own total when it is real, not the catalogue import's 1-mark placeholder. */
  bankTotal: number | null;
}

export interface TranscriptionCheck {
  /** Blocking: any issue sends the question to the teacher instead of the bank. */
  issues: string[];
  /** Worth recording, not worth a flag. */
  warnings: string[];
  /** Marks per part after the checks, derived from the codes where the scheme printed none. */
  resolvedMarks: (number | null)[];
}

function partName(p: NormalizedPart): string {
  return p.printedLabel || "the question";
}

function combine(sets: number[][]): number[] {
  let out = [0];
  for (const s of sets) {
    const next = new Set<number>();
    for (const a of out) for (const b of s) if (next.size < 256) next.add(a + b);
    out = [...next];
  }
  return out.sort((a, b) => a - b);
}

/** What the bank cannot hold about a set of part labels. */
function labelIssues(parts: NormalizedPart[]): string[] {
  const issues: string[] = [];
  const labels = parts.map((p) => p.label);
  const seen = new Set<string>();
  for (const p of parts) {
    if (!isValidBankLabel(p.label)) issues.push(`Label "${p.printedLabel}" is not a letter with an optional roman numeral.`);
    if (seen.has(p.label)) issues.push(`Label "${p.printedLabel}" appears twice.`);
    seen.add(p.label);
  }
  if (labels.some((l) => TOP_LEVEL_ROMAN.has(l))) {
    issues.push("Parts are numbered with top-level roman numerals, which the marking screen cannot label.");
  }
  if (labels.includes("") && parts.length > 1) {
    issues.push("An unlabelled part sits beside labelled ones.");
  }
  return issues;
}

export function checkTranscription(scheme: NormalizedScheme, ctx: CheckContext): TranscriptionCheck {
  const issues: string[] = [];
  const warnings: string[] = [];
  const parts = scheme.parts;

  if (parts.length === 0) {
    return { issues: ["No parts were transcribed."], warnings, resolvedMarks: [] };
  }

  issues.push(...labelIssues(parts));

  // Source.
  if (
    ctx.expectedQuestionNumber !== null &&
    scheme.questionNumber !== null &&
    scheme.questionNumber !== ctx.expectedQuestionNumber
  ) {
    issues.push(`The scheme is for question ${scheme.questionNumber}, not ${ctx.expectedQuestionNumber}.`);
  }
  for (const u of scheme.unreadable) issues.push(`Unreadable: ${u}`);
  for (const s of scheme.sourceProblems) issues.push(`Source: ${s}`);
  // Transcribed faithfully, so worth recording but not a reason to hold the scheme back.
  for (const m of scheme.misprints) warnings.push(`Misprint in the scheme: ${m}`);
  for (const d of scheme.diagrams) warnings.push(`Diagram described in words: ${d}`);

  // Each part.
  const totalsPerPart: number[][] = [];
  const resolvedMarks: (number | null)[] = [];
  for (const p of parts) {
    if (!p.latex.trim()) issues.push(`${partName(p)} has no scheme text.`);
    for (const e of latexMathErrors(p.latex)) issues.push(`${partName(p)}: maths does not render: ${e}`);

    const summary = summarizeSchemeMarks(p.latex);
    totalsPerPart.push(summary.possibleTotals);
    if (summary.strayCodes.length) {
      warnings.push(`${partName(p)}: codes without \\hfill (not counted): ${summary.strayCodes.join(", ")}`);
    }
    const counted = summary.codes.filter((c) => c.kind === "M" || c.kind === "A" || c.kind === "R").length;
    if (counted === 0 && summary.nTotal === 0) issues.push(`${partName(p)} has no mark codes.`);

    if (p.marks !== null) {
      if (!summary.possibleTotals.includes(p.marks)) {
        issues.push(`${partName(p)}: the codes add up to ${summary.possibleTotals.join(" or ")}, but it prints [${p.marks} marks].`);
      }
      for (const stated of summary.statedMarks) {
        if (stated !== p.marks) issues.push(`${partName(p)} states [${stated} marks] but is recorded as ${p.marks}.`);
      }
      resolvedMarks.push(p.marks);
    } else {
      resolvedMarks.push(summary.possibleTotals.length === 1 ? summary.possibleTotals[0] : null);
    }
  }

  // The question as a whole.
  const printed = parts.filter((p) => p.marks !== null);
  if (printed.length === parts.length) {
    const sum = parts.reduce((s, p) => s + (p.marks ?? 0), 0);
    if (scheme.totalMarks !== null && sum !== scheme.totalMarks) {
      issues.push(`The parts add up to ${sum}, but the question total is [${scheme.totalMarks} marks].`);
    }
  } else {
    const possible = combine(totalsPerPart);
    const target = scheme.totalMarks ?? ctx.bankTotal;
    if (target === null) {
      issues.push("The scheme prints no marks and the bank has no real total to check the codes against.");
    } else if (!possible.includes(target)) {
      issues.push(
        `The codes add up to ${possible.join(" or ")}, but the ${scheme.totalMarks !== null ? "printed" : "bank's"} total is ${target}.`
      );
    }
    if (resolvedMarks.some((m) => m === null)) {
      issues.push("Some parts print no marks and their codes allow more than one total.");
    }
  }

  return { issues, warnings, resolvedMarks };
}

// ---- turning a checked scheme into part changes -----------------------------

export interface ExistingPart {
  id: string;
  part_label: string;
  marks: number;
  sort_order: number;
  markscheme_latex: string | null;
  content_latex: string | null;
  command_term: string | null;
  command_terms: string[] | null;
  latex_verified: boolean;
  subtopic_codes: string[] | null;
  primary_subtopic_code: string | null;
}

/** The structure a question's tests and saved exams already rely on. */
export interface InUseTarget {
  /** Bank labels they use; [""] is one whole-question item. */
  labels: string[];
  /** test_items.max_marks per label, where a test fixes it. */
  maxMarks: Record<string, number>;
}

export type PartAction =
  | {
      kind: "fill";
      partId: string;
      expectedLabel: string;
      expectedLatex: string;
      latex: string;
      /** New marks, or null to leave them. */
      marks: number | null;
    }
  | {
      kind: "relabel";
      partId: string;
      expectedLabel: string;
      expectedLatex: string;
      label: string;
      sortOrder: number;
      marks: number;
      latex: string;
    }
  | {
      kind: "insert";
      label: string;
      sortOrder: number;
      marks: number;
      latex: string;
      subtopicCodes: string[];
      primarySubtopicCode: string | null;
      /** The unlabelled part these subtopics were copied from, if any. */
      inheritedFromPartId: string | null;
    };

export interface PartPlan {
  inUse: boolean;
  actions: PartAction[];
  /** Everything a teacher should see before this plan is applied. */
  flags: string[];
  /**
   * The flags a teacher cannot accept past in LaTeX Review: anything about a
   * question a test or saved exam uses, and overwriting a scheme that is
   * already there. The rest are for their judgement.
   */
  blocking: string[];
  /** Clear question_images.part_id on this question's scheme images (a split re-labels its parts). */
  resetImagePartIds: boolean;
}

function hasText(s: string | null | undefined): boolean {
  return !!s && s.trim().length > 0;
}

/** Every part carries the same non-empty scheme: an old whole-question Extract, not per-part schemes. */
export function isIdenticalSiblingCopy(existing: ExistingPart[]): boolean {
  if (existing.length < 2) return false;
  if (existing.some((p) => p.latex_verified || !hasText(p.markscheme_latex))) return false;
  const first = existing[0].markscheme_latex!.trim();
  return existing.every((p) => p.markscheme_latex!.trim() === first);
}

/** The bank's total when it is real: not a missing question, not the catalogue's 1-mark placeholder. */
export function realBankTotal(existing: ExistingPart[]): number | null {
  if (existing.length === 0) return null;
  if (existing.length === 1 && existing[0].part_label === "" && existing[0].marks <= 1) return null;
  return existing.reduce((s, p) => s + (p.marks ?? 0), 0);
}

/** A multi-part scheme as one unit: each part under its printed label, as the grader expects a whole-question scheme. */
export function wholeQuestionLatex(scheme: NormalizedScheme): string {
  if (scheme.parts.length === 1 && scheme.parts[0].label === "") return scheme.parts[0].latex;
  return scheme.parts.map((p) => `${p.printedLabel}\n${p.latex}`).join("\n\n");
}

function schemeTotal(scheme: NormalizedScheme, marks: (number | null)[]): number | null {
  if (marks.every((m) => m !== null)) return (marks as number[]).reduce((s, m) => s + m, 0);
  return scheme.totalMarks;
}

export function planPartChanges(args: {
  existing: ExistingPart[];
  scheme: NormalizedScheme;
  /** Marks per scheme part, from checkTranscription. */
  marks: (number | null)[];
  inUse: InUseTarget | null;
  /**
   * A teacher has read the flags in LaTeX Review and accepts the plan: it
   * keeps its actions unless a flag is blocking.
   */
  acceptFlags?: boolean;
}): PartPlan {
  const { existing, inUse } = args;
  const acceptFlags = args.acceptFlags ?? false;
  const { scheme, marks, derived } = alignSubparts(
    args.scheme,
    args.marks,
    new Set(inUse ? inUse.labels : existing.map((p) => p.part_label))
  );
  const flags: string[] = [];
  const blocking: string[] = [];
  const block = (flag: string) => {
    flags.push(flag);
    blocking.push(flag);
  };
  const actions: PartAction[] = [];
  const rebuild = isIdenticalSiblingCopy(existing);
  const locked = (p: ExistingPart) => p.latex_verified || (hasText(p.markscheme_latex) && !rebuild);
  const byLabel = new Map(existing.map((p) => [p.part_label, p]));
  const markOf = new Map(scheme.parts.map((p, i) => [p.label, marks[i]]));
  const schemePart = new Map(scheme.parts.map((p) => [p.label, p]));
  const total = schemeTotal(scheme, marks);
  const schemeUnlabelled = scheme.parts.length === 1 && scheme.parts[0].label === "";
  const hasUnlabelled = byLabel.has("");
  const labelled = existing.filter((p) => p.part_label !== "");

  const fill = (p: ExistingPart, latex: string, newMarks: number | null) => {
    if (locked(p)) return;
    actions.push({
      kind: "fill",
      partId: p.id,
      expectedLabel: p.part_label,
      expectedLatex: p.markscheme_latex ?? "",
      latex,
      marks: newMarks !== null && newMarks !== p.marks ? newMarks : null,
    });
  };

  if (inUse) {
    const targets = [...new Set(inUse.labels)];
    if (targets.length === 1 && targets[0] === "") {
      // One whole-question item: exactly one unlabelled part holding everything.
      const whole = wholeQuestionLatex(scheme);
      const tested = inUse.maxMarks[""];
      if (total === null) flags.push("In use as one item, but the scheme's total is unknown.");
      else if (tested !== undefined && tested !== total) {
        flags.push(`In use as one item worth ${tested}, but the scheme totals ${total}.`);
      }
      if (existing.length === 0) {
        if (total !== null) {
          actions.push({
            kind: "insert",
            label: "",
            sortOrder: 0,
            marks: total,
            latex: whole,
            subtopicCodes: [],
            primarySubtopicCode: null,
            inheritedFromPartId: null,
          });
        }
      } else if (existing.length === 1 && hasUnlabelled) {
        const p = byLabel.get("")!;
        if (total !== null && p.marks !== total) flags.push(`In use; the bank has ${p.marks} marks but the scheme totals ${total}.`);
        fill(p, whole, null);
      } else {
        flags.push("In use as one whole-question item, but the bank has labelled parts.");
      }
    } else {
      if (hasUnlabelled) {
        flags.push(
          `In use with parts ${targets.map((l) => `(${l})`).join(", ")} beside the bank's unlabelled part; adding them would count marks twice.`
        );
      }
      for (const label of targets) {
        const sp = schemePart.get(label);
        const m = markOf.get(label) ?? null;
        if (!sp) {
          flags.push(`In use with part (${label}), which the scheme does not show.`);
          continue;
        }
        const tested = inUse.maxMarks[label];
        if (tested !== undefined && m !== null && tested !== m) {
          flags.push(`In use: (${label}) is worth ${tested} in its test but ${m} in the scheme.`);
        }
        const p = byLabel.get(label);
        if (p) {
          if (m !== null && p.marks !== m) flags.push(`In use; the bank gives (${label}) ${p.marks} marks, the scheme ${m}.`);
          fill(p, sp.latex, null);
        } else if (m === null) {
          flags.push(`In use: (${label}) has no known marks to create it with.`);
        } else {
          actions.push({
            kind: "insert",
            label,
            sortOrder: sortOrderFromLabel(label, 900),
            marks: m,
            latex: sp.latex,
            subtopicCodes: [],
            primarySubtopicCode: null,
            inheritedFromPartId: null,
          });
        }
      }
    }
    // A test already relies on this question's structure: nothing here is the teacher's to wave through.
    return settle({ inUse: true, actions, flags, blocking: [...flags], resetImagePartIds: false }, acceptFlags);
  }

  // Not in use: the printed scheme decides the structure.
  if (schemeUnlabelled) {
    const latex = scheme.parts[0].latex;
    const m = marks[0] ?? scheme.totalMarks;
    if (existing.length === 0) {
      if (m === null) block("The scheme's marks are unknown.");
      else {
        actions.push({
          kind: "insert",
          label: "",
          sortOrder: 0,
          marks: m,
          latex,
          subtopicCodes: [],
          primarySubtopicCode: null,
          inheritedFromPartId: null,
        });
      }
    } else if (existing.length === 1 && hasUnlabelled) {
      fill(byLabel.get("")!, latex, m);
    } else {
      flags.push(`The bank has parts ${existing.map((p) => `(${p.part_label})`).join(", ")} but the scheme shows none.`);
    }
    return settle({ inUse: false, actions, flags, blocking, resetImagePartIds: false }, acceptFlags);
  }

  const missingMarks = scheme.parts.filter((_, i) => marks[i] === null).map((p) => p.printedLabel);
  if (missingMarks.length) block(`No marks known for ${missingMarks.join(", ")}.`);

  if (existing.length === 0) {
    scheme.parts.forEach((sp, i) => {
      actions.push({
        kind: "insert",
        label: sp.label,
        sortOrder: sortOrderFromLabel(sp.label, 900 + i),
        marks: marks[i] ?? 0,
        latex: sp.latex,
        subtopicCodes: [],
        primarySubtopicCode: null,
        inheritedFromPartId: null,
      });
    });
  } else if (existing.length === 1 && hasUnlabelled) {
    const only = byLabel.get("")!;
    if (locked(only)) block("The unlabelled part already has a scheme; it will not be split.");
    if (hasText(only.content_latex)) flags.push("The unlabelled part carries the whole question's text, which would land on part (a).");
    if (hasText(only.command_term) || (only.command_terms?.length ?? 0) > 0) {
      flags.push("The unlabelled part carries a command term, which would land on part (a).");
    }
    scheme.parts.forEach((sp, i) => {
      if (i === 0) {
        actions.push({
          kind: "relabel",
          partId: only.id,
          expectedLabel: "",
          expectedLatex: only.markscheme_latex ?? "",
          label: sp.label,
          sortOrder: sortOrderFromLabel(sp.label, 10),
          marks: marks[i] ?? 0,
          latex: sp.latex,
        });
      } else {
        actions.push({
          kind: "insert",
          label: sp.label,
          sortOrder: sortOrderFromLabel(sp.label, 900 + i),
          marks: marks[i] ?? 0,
          latex: sp.latex,
          subtopicCodes: [...(only.subtopic_codes ?? [])],
          primarySubtopicCode: only.primary_subtopic_code,
          inheritedFromPartId: only.id,
        });
      }
    });
    return settle({ inUse: false, actions, flags, blocking, resetImagePartIds: true }, acceptFlags);
  } else if (hasUnlabelled) {
    flags.push("The bank mixes an unlabelled part with labelled ones.");
  } else {
    const schemeLabels = new Set(scheme.parts.map((p) => p.label));
    const extra = labelled.filter((p) => !schemeLabels.has(p.part_label)).map((p) => `(${p.part_label})`);
    if (extra.length) flags.push(`The bank has ${extra.join(", ")}, which the scheme does not show; nothing is deleted.`);
    scheme.parts.forEach((sp, i) => {
      const p = byLabel.get(sp.label);
      const m = marks[i];
      // Marks the scheme printed replace the bank's. Marks worked out from
      // the codes, or a verified part's, are only compared: a disagreement
      // there is for the teacher to settle.
      if (p && m !== null && m !== p.marks && (locked(p) || derived.has(sp.label))) {
        flags.push(`The bank gives (${sp.label}) ${p.marks} mark${p.marks === 1 ? "" : "s"}, the scheme ${m}.`);
      }
      if (p) fill(p, sp.latex, m);
      else {
        actions.push({
          kind: "insert",
          label: sp.label,
          sortOrder: sortOrderFromLabel(sp.label, 900 + i),
          marks: marks[i] ?? 0,
          latex: sp.latex,
          subtopicCodes: [],
          primarySubtopicCode: null,
          inheritedFromPartId: null,
        });
      }
    });
  }
  return settle({ inUse: false, actions, flags, blocking, resetImagePartIds: false }, acceptFlags);
}

/**
 * All or nothing: a flagged question keeps its flags and loses its actions,
 * unless a teacher accepts it and none of the flags is blocking.
 */
function settle(plan: PartPlan, acceptFlags: boolean): PartPlan {
  if (plan.flags.length === 0) return plan;
  if (acceptFlags && plan.blocking.length === 0) return plan;
  return { ...plan, actions: [], resetImagePartIds: false };
}

// ---- a teacher's Accept in LaTeX Review ---------------------------------------

export type AcceptDecision =
  | { ok: true; plan: PartPlan & { acceptedFlags: string[] } }
  | { ok: false; reason: "invalid" | "blocked" | "nothing"; problems: string[] };

/**
 * What a teacher's Accept of a flagged build may do. Their corrected parts
 * are planned again against the question as it is now; flags they have
 * read are accepted, blocking ones never are (a question a test uses, a
 * scheme already there), and neither is a disagreement between the tests
 * themselves. The plan that comes back has no flags left, which is what
 * apply_markscheme_build() requires; the ones the teacher accepted are kept
 * beside it as acceptedFlags, for the record.
 */
export function decideAcceptance(args: {
  transcription: TranscribedScheme;
  edits: readonly EditedPart[];
  existing: ExistingPart[];
  inUse: InUseTarget | null;
  inUseConflicts?: readonly string[];
}): AcceptDecision {
  const { scheme, marks, problems } = schemeFromEdits(args.transcription, args.edits);
  if (problems.length > 0) return { ok: false, reason: "invalid", problems };
  if (args.inUseConflicts?.length) return { ok: false, reason: "blocked", problems: [...args.inUseConflicts] };
  const plan = planPartChanges({ existing: args.existing, scheme, marks, inUse: args.inUse, acceptFlags: true });
  if (plan.blocking.length > 0) return { ok: false, reason: "blocked", problems: plan.blocking };
  if (plan.actions.length === 0) {
    return {
      ok: false,
      reason: "nothing",
      problems: plan.flags.length > 0 ? plan.flags : ["Every part this scheme covers already has a scheme or was verified."],
    };
  }
  return { ok: true, plan: { ...plan, flags: [], acceptedFlags: plan.flags } };
}
