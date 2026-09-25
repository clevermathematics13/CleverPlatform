import { createHash } from "node:crypto";
import { z } from "zod";
import { formatQuestionLabel } from "./paper-labels";
import { subpartLetter } from "./assignments";
import { mathSpans, proseOnly, splitMathText } from "./math-text";
import { texProblem } from "./tex-render";
import { parseExpression } from "./diagram-math";

/**
 * The student-facing explanation of one part of a mark scheme: what a
 * student reads beside the part while self-assessing.
 *
 *   answer  -- the final answer, first and on its own;
 *   marks   -- "How the marks work": what earns each mark, adding up to the
 *              part's marks;
 *   watch   -- at most three short "watch out" notes;
 *   steps   -- the "Explain more" slides: a short worked explanation, one
 *              idea per slide, each with an optional diagram and a longer
 *              "explain this further" text for a student still stuck.
 *
 * Written by the model from the teacher's own answer and mark scheme
 * (lib/mark-scheme-explanation-prompt.ts), checked here before it is stored
 * (checkExplanation), and stored per part in mark_scheme_explanations keyed
 * on (test_id, question_number, part_label) with a hash of what it was
 * written from (explanationSourceHash). A student sees it only while that
 * hash still matches: once the teacher edits the part's answer or scheme,
 * the part falls back to the teacher's own text until it is rewritten.
 *
 * Maths is LaTeX in the lib/math-text.ts form ($...$, $$...$$, \$ for a
 * price), typeset with KaTeX by lib/tex-render.ts, which is also what checks
 * it here -- so an explanation that reaches a student renders.
 *
 * Server-only at runtime (node:crypto, KaTeX); the browser imports its types.
 */

// ---- Schema ----------------------------------------------------------------
//
// The structured-output schema the model writes to. Every field is required
// and nullable where it may be absent, as the house schemas are. Structured
// output does not enforce lengths or counts, and the SDK's own parse would
// throw on a violated .max() -- losing the whole draft over one long note --
// so the limits live in checkExplanation instead, which can say what is
// wrong and ask for a fix.

const MIXED = "Text with maths in LaTeX between $...$ (inline) or $$...$$ (display). A money sign is written \\$.";
const TEX = "LaTeX only, WITHOUT dollar signs.";

const WorkingDiagramSchema = z.object({
  kind: z.literal("working"),
  lines: z
    .array(
      z.object({
        math: z.string().describe(`One line of working. ${TEX} e.g. 7x = 70`),
        note: z
          .string()
          .describe(`The move that produced this line, 2-8 words, e.g. "divide both sides by $7$". Empty for the first line. ${MIXED}`),
      }),
    )
    .describe("2-8 lines of equivalent working, top to bottom."),
  caption: z.string().describe("One plain sentence saying what the diagram shows (read aloud by screen readers)."),
});

const AreaModelDiagramSchema = z.object({
  kind: z.literal("area_model"),
  rowHeads: z.array(z.string()).describe(`Terms down the left side (one factor). ${TEX}`),
  colHeads: z.array(z.string()).describe(`Terms along the top (the other factor). ${TEX}`),
  cells: z.array(z.array(z.string())).describe(`cells[r][c] = rowHeads[r] times colHeads[c]. ${TEX}`),
  caption: z.string(),
});

const NumberLineDiagramSchema = z.object({
  kind: z.literal("number_line"),
  min: z.number(),
  max: z.number(),
  step: z.number().describe("Distance between tick marks."),
  points: z
    .array(z.object({ value: z.number(), label: z.string().describe(TEX), open: z.boolean().describe("true = hollow circle (value excluded)") }))
    .describe("Marked values, at most 8."),
  jumps: z
    .array(z.object({ from: z.number(), to: z.number(), label: z.string().describe(`${TEX} e.g. +3`) }))
    .describe("Curved arrows from one value to another, e.g. counting in steps. At most 12."),
  ranges: z
    .array(
      z.object({
        from: z.number().nullable().describe("null = continues to the left edge"),
        to: z.number().nullable().describe("null = continues to the right edge"),
        includeFrom: z.boolean(),
        includeTo: z.boolean(),
      }),
    )
    .describe("Shaded intervals, e.g. for an inequality. At most 3."),
  caption: z.string(),
});

const BarModelDiagramSchema = z.object({
  kind: z.literal("bar_model"),
  bars: z
    .array(
      z.object({
        label: z.string().describe(MIXED),
        segments: z.array(
          z.object({
            value: z.number().describe("Relative length; every bar uses the same scale."),
            label: z.string().describe(MIXED),
            shaded: z.boolean(),
          }),
        ),
      }),
    )
    .describe("1-4 horizontal bars drawn to the same scale."),
  caption: z.string(),
});

const TableDiagramSchema = z.object({
  kind: z.literal("table"),
  header: z.array(z.string()).describe(MIXED),
  rows: z.array(z.array(z.string())).describe(`Each row has one cell per header column. ${MIXED}`),
  caption: z.string(),
});

const SequenceDiagramSchema = z.object({
  kind: z.literal("sequence"),
  terms: z.array(z.string()).describe(`2-10 terms in order. ${TEX}`),
  jumps: z.array(z.string()).describe(`The change from each term to the next, one fewer than the terms, e.g. -6. ${TEX}`),
  caption: z.string(),
});

const GraphDiagramSchema = z.object({
  kind: z.literal("graph"),
  xMin: z.number(),
  xMax: z.number(),
  yMin: z.number(),
  yMax: z.number(),
  curves: z
    .array(
      z.object({
        expr: z
          .string()
          .describe("y in terms of x, plain calculator syntax: x^2 - 4, 2*sin(x) + 1, (x+1)/(x-2), sqrt(x), abs(x), ln(x), e^x, pi. Brackets around every function argument."),
        label: z.string().describe(`${TEX} e.g. y = x^2 - 4`),
      }),
    )
    .describe("At most 3 curves."),
  points: z
    .array(z.object({ x: z.number(), y: z.number(), label: z.string().describe(`${TEX} e.g. (2, 0)`), open: z.boolean() }))
    .describe("At most 8 marked points."),
  caption: z.string(),
});

const TilesDiagramSchema = z.object({
  kind: z.literal("tiles"),
  figures: z
    .array(
      z.object({
        label: z.string().describe('Plain text, e.g. "Figure 2".'),
        tiles: z
          .array(z.object({ row: z.number().int(), col: z.number().int(), isNew: z.boolean().describe("true = added since the previous figure") }))
          .describe("Unit squares by grid position; row 0 is the top."),
      }),
    )
    .describe("1-4 figures of a pattern made of square tiles."),
  caption: z.string(),
});

export const ExplanationDiagramSchema = z.discriminatedUnion("kind", [
  WorkingDiagramSchema,
  AreaModelDiagramSchema,
  NumberLineDiagramSchema,
  BarModelDiagramSchema,
  TableDiagramSchema,
  SequenceDiagramSchema,
  GraphDiagramSchema,
  TilesDiagramSchema,
]);

export const ExplanationStepSchema = z.object({
  title: z.string().describe("2-6 words naming the step, e.g. \"Clear the fractions\"."),
  body: z.string().describe(`1-3 short sentences, at most about 60 words. ${MIXED}`),
  diagram: ExplanationDiagramSchema.nullable().describe("A diagram when a picture shows the idea better than words, else null."),
  more: z
    .string()
    .describe(`"Explain this further": the same step explained more slowly, in smaller steps or with a simpler example. 2-5 sentences, at most about 110 words. ${MIXED}`),
});

export const MarkSchemeExplanationSchema = z.object({
  answer: z.string().describe(`The final answer, as short and clear as possible. ${MIXED}`),
  marks: z
    .array(
      z.object({
        marks: z.number().int().describe("How many marks this point is worth."),
        text: z.string().describe(`What earns them, at most about 15 words. ${MIXED}`),
      }),
    )
    .describe("How the marks work, in the order they are earned. The marks add up to exactly the part's total."),
  watch: z.array(z.string()).describe(`0-3 short "watch out" notes, at most about 20 words each. ${MIXED}`),
  steps: z.array(ExplanationStepSchema).describe("2-5 slides explaining how to get the answer, one idea per slide."),
});

export type MarkSchemeExplanation = z.infer<typeof MarkSchemeExplanationSchema>;
export type ExplanationStep = z.infer<typeof ExplanationStepSchema>;
export type ExplanationDiagram = z.infer<typeof ExplanationDiagramSchema>;

/** A stored row's content, or null when it is not a well-formed explanation
 *  (a row written by an older shape, or edited by hand). A null part falls
 *  back to the teacher's own text, never to a half-rendered card. */
export function parseStoredExplanation(content: unknown): MarkSchemeExplanation | null {
  const parsed = MarkSchemeExplanationSchema.safeParse(content);
  return parsed.success ? parsed.data : null;
}

// ---- Checks ----------------------------------------------------------------

export const EXPLANATION_LIMITS = {
  answer: 300,
  markPoints: 8,
  markText: 220,
  watch: 3,
  watchText: 240,
  steps: { min: 2, max: 6 },
  title: 70,
  body: 650,
  more: 1100,
  diagrams: 4,
  caption: 240,
  label: 60,
} as const;

/** Words that must never reach a student: CLAUDE.md, "Never AI ... anywhere
 *  a student can see it". Checked across everything an explanation says. */
const FORBIDDEN = /\bAI\b|artificial intelligence|\bClaude\b|\bAnthropic\b|language model|\bchatbot\b|\bLLM\b/i;

/** The marking-code shorthand a student reads in words instead
 *  (lib/student-mark-scheme.ts stripMarkCodes does the same for the teacher's
 *  own notes). Read in prose only: "A1" inside maths may be a matrix entry. */
const MARK_CODE = /\b(?:[MAR][0-9])+\b|\bFT\b|\bAG\b/;

function unescapedDollars(src: string): number {
  let n = 0;
  for (let i = 0; i < src.length; i++) {
    if (src[i] === "\\") {
      i += 1;
      continue;
    }
    if (src[i] === "$") n += 1;
  }
  return n;
}

function checkMixed(where: string, src: string, max: number, problems: string[], { required = true } = {}): void {
  if (required && src.trim() === "") {
    problems.push(`${where} is empty.`);
    return;
  }
  if (src.length > max) problems.push(`${where} is ${src.length} characters; keep it under ${max}.`);
  const segments = splitMathText(src);
  const delimiters = segments.reduce((n, s) => n + (s.kind === "inline" ? 2 : s.kind === "display" ? 4 : 0), 0);
  if (unescapedDollars(src) !== delimiters) {
    problems.push(`${where} has a $ that does not open or close maths. Write a money sign as \\$ and put every formula between a matching pair.`);
  }
  for (const span of mathSpans(src)) {
    const problem = texProblem(span.tex, span.display);
    if (problem) problems.push(`${where}: KaTeX cannot typeset "${span.tex}" (${problem}).`);
  }
  if (MARK_CODE.test(proseOnly(src))) {
    problems.push(`${where} uses a marking code (M1, A1, R1, FT, AG). Say "method mark", "answer mark", "reasoning mark" or "follow-through" instead.`);
  }
}

function checkTex(where: string, tex: string, problems: string[], { display = false, required = true } = {}): void {
  if (tex.trim() === "") {
    if (required) problems.push(`${where} is empty.`);
    return;
  }
  if (tex.length > 200) problems.push(`${where} is longer than 200 characters.`);
  if (/(?<!\\)\$/.test(tex)) {
    problems.push(`${where} is LaTeX only and must not contain dollar signs.`);
    return;
  }
  const problem = texProblem(tex, display);
  if (problem) problems.push(`${where}: KaTeX cannot typeset "${tex}" (${problem}).`);
}

function finite(...values: number[]): boolean {
  return values.every((v) => Number.isFinite(v) && Math.abs(v) <= 1e6);
}

function checkDiagram(where: string, d: ExplanationDiagram, problems: string[]): void {
  checkMixed(`${where} caption`, d.caption, EXPLANATION_LIMITS.caption, problems);
  switch (d.kind) {
    case "working": {
      if (d.lines.length < 1 || d.lines.length > 10) problems.push(`${where} needs 1-10 lines of working.`);
      d.lines.forEach((line, i) => {
        checkTex(`${where} line ${i + 1}`, line.math, problems, { display: true });
        checkMixed(`${where} line ${i + 1} note`, line.note, 90, problems, { required: false });
      });
      return;
    }
    case "area_model": {
      const rows = d.rowHeads.length;
      const cols = d.colHeads.length;
      if (rows < 1 || rows > 4 || cols < 1 || cols > 4) problems.push(`${where} needs 1-4 row and column headings.`);
      if (d.cells.length !== rows || d.cells.some((r) => r.length !== cols)) {
        problems.push(`${where} needs exactly one cell for each row heading and column heading.`);
      }
      [...d.rowHeads, ...d.colHeads].forEach((h, i) => checkTex(`${where} heading ${i + 1}`, h, problems));
      d.cells.forEach((r, ri) => r.forEach((c, ci) => checkTex(`${where} cell ${ri + 1},${ci + 1}`, c, problems, { required: false })));
      return;
    }
    case "number_line": {
      if (!finite(d.min, d.max, d.step) || !(d.max > d.min) || !(d.step > 0)) {
        problems.push(`${where} needs min < max and a positive step.`);
        return;
      }
      const ticks = (d.max - d.min) / d.step;
      if (ticks > 40 || ticks < 1) problems.push(`${where} should have between 1 and 40 tick marks; change min, max or step.`);
      if (d.points.length > 8 || d.jumps.length > 12 || d.ranges.length > 3) problems.push(`${where} has too many points, jumps or ranges.`);
      const inside = (v: number) => finite(v) && v >= d.min && v <= d.max;
      d.points.forEach((p, i) => {
        if (!inside(p.value)) problems.push(`${where} point ${i + 1} (${p.value}) is outside ${d.min} to ${d.max}.`);
        checkTex(`${where} point ${i + 1} label`, p.label, problems, { required: false });
      });
      d.jumps.forEach((j, i) => {
        if (!inside(j.from) || !inside(j.to) || j.from === j.to) problems.push(`${where} jump ${i + 1} must go between two different values on the line.`);
        checkTex(`${where} jump ${i + 1} label`, j.label, problems, { required: false });
      });
      d.ranges.forEach((r, i) => {
        if ((r.from !== null && !inside(r.from)) || (r.to !== null && !inside(r.to)) || (r.from !== null && r.to !== null && r.from >= r.to)) {
          problems.push(`${where} range ${i + 1} must run left to right inside the line.`);
        }
      });
      return;
    }
    case "bar_model": {
      if (d.bars.length < 1 || d.bars.length > 4) problems.push(`${where} needs 1-4 bars.`);
      d.bars.forEach((bar, bi) => {
        checkMixed(`${where} bar ${bi + 1} label`, bar.label, EXPLANATION_LIMITS.label, problems, { required: false });
        if (bar.segments.length < 1 || bar.segments.length > 10) problems.push(`${where} bar ${bi + 1} needs 1-10 segments.`);
        bar.segments.forEach((s, si) => {
          if (!finite(s.value) || !(s.value > 0)) problems.push(`${where} bar ${bi + 1} segment ${si + 1} needs a positive value.`);
          checkMixed(`${where} bar ${bi + 1} segment ${si + 1} label`, s.label, EXPLANATION_LIMITS.label, problems, { required: false });
        });
      });
      return;
    }
    case "table": {
      const cols = d.header.length;
      if (cols < 1 || cols > 6) problems.push(`${where} needs 1-6 columns.`);
      if (d.rows.length < 1 || d.rows.length > 10) problems.push(`${where} needs 1-10 rows.`);
      if (d.rows.some((r) => r.length !== cols)) problems.push(`${where}: every row needs exactly one cell per column.`);
      d.header.forEach((h, i) => checkMixed(`${where} heading ${i + 1}`, h, EXPLANATION_LIMITS.label, problems, { required: false }));
      d.rows.forEach((r, ri) =>
        r.forEach((c, ci) => checkMixed(`${where} cell ${ri + 1},${ci + 1}`, c, EXPLANATION_LIMITS.label, problems, { required: false })),
      );
      return;
    }
    case "sequence": {
      if (d.terms.length < 2 || d.terms.length > 10) problems.push(`${where} needs 2-10 terms.`);
      if (d.jumps.length !== 0 && d.jumps.length !== d.terms.length - 1) {
        problems.push(`${where} needs one jump between each pair of terms (${d.terms.length - 1}), or none.`);
      }
      d.terms.forEach((t, i) => checkTex(`${where} term ${i + 1}`, t, problems));
      d.jumps.forEach((j, i) => checkTex(`${where} jump ${i + 1}`, j, problems, { required: false }));
      return;
    }
    case "graph": {
      if (!finite(d.xMin, d.xMax, d.yMin, d.yMax) || !(d.xMax > d.xMin) || !(d.yMax > d.yMin)) {
        problems.push(`${where} needs xMin < xMax and yMin < yMax.`);
        return;
      }
      if (d.curves.length === 0 && d.points.length === 0) problems.push(`${where} needs at least one curve or point.`);
      if (d.curves.length > 3 || d.points.length > 8) problems.push(`${where} has too many curves or points.`);
      d.curves.forEach((c, i) => {
        const parsed = parseExpression(c.expr);
        if (!parsed.ok) problems.push(`${where} curve ${i + 1} "${c.expr}" cannot be read (${parsed.error}). Use plain calculator syntax in x.`);
        checkTex(`${where} curve ${i + 1} label`, c.label, problems, { required: false });
      });
      d.points.forEach((p, i) => {
        if (!finite(p.x, p.y) || p.x < d.xMin || p.x > d.xMax || p.y < d.yMin || p.y > d.yMax) {
          problems.push(`${where} point ${i + 1} is outside the graph's window.`);
        }
        checkTex(`${where} point ${i + 1} label`, p.label, problems, { required: false });
      });
      return;
    }
    case "tiles": {
      if (d.figures.length < 1 || d.figures.length > 4) problems.push(`${where} needs 1-4 figures.`);
      d.figures.forEach((f, fi) => {
        if (f.label.length > 30) problems.push(`${where} figure ${fi + 1} label is too long.`);
        if (f.tiles.length < 1 || f.tiles.length > 80) problems.push(`${where} figure ${fi + 1} needs 1-80 tiles.`);
        const seen = new Set<string>();
        for (const t of f.tiles) {
          if (!Number.isInteger(t.row) || !Number.isInteger(t.col) || t.row < 0 || t.col < 0 || t.row > 20 || t.col > 20) {
            problems.push(`${where} figure ${fi + 1} has a tile outside rows and columns 0-20.`);
            break;
          }
          const key = `${t.row},${t.col}`;
          if (seen.has(key)) {
            problems.push(`${where} figure ${fi + 1} has two tiles in the same place.`);
            break;
          }
          seen.add(key);
        }
      });
      return;
    }
  }
}

/**
 * Everything wrong with an explanation, in words the model can act on; empty
 * when it may be shown to a student. `maxMarks` is the part's marks: "How
 * the marks work" has to add up to exactly that, since a student counts
 * their own marks from it.
 */
export function checkExplanation(e: MarkSchemeExplanation, maxMarks: number): string[] {
  const problems: string[] = [];
  const L = EXPLANATION_LIMITS;

  checkMixed("The answer", e.answer, L.answer, problems);

  if (maxMarks > 0 && e.marks.length === 0) problems.push("\"How the marks work\" is empty.");
  if (e.marks.length > L.markPoints) problems.push(`"How the marks work" has ${e.marks.length} points; use at most ${L.markPoints}.`);
  e.marks.forEach((m, i) => {
    if (!Number.isInteger(m.marks) || m.marks < 0) problems.push(`Mark point ${i + 1} must be worth a whole number of marks.`);
    checkMixed(`Mark point ${i + 1}`, m.text, L.markText, problems);
  });
  const total = e.marks.reduce((sum, m) => sum + (Number.isFinite(m.marks) ? m.marks : 0), 0);
  if (total !== maxMarks) {
    problems.push(`"How the marks work" adds up to ${total} marks, but this part is worth ${maxMarks}. Make it add up to exactly ${maxMarks}, as the teacher's mark scheme does.`);
  }

  if (e.watch.length > L.watch) problems.push(`There are ${e.watch.length} "watch out" notes; use at most ${L.watch}.`);
  e.watch.forEach((w, i) => checkMixed(`Watch-out note ${i + 1}`, w, L.watchText, problems));

  // The prompt asks for 2-5; one more is tolerated rather than thrown away.
  if (e.steps.length < L.steps.min || e.steps.length > L.steps.max) {
    problems.push(`There are ${e.steps.length} steps; use between 2 and 5.`);
  }
  let diagrams = 0;
  e.steps.forEach((s, i) => {
    const where = `Step ${i + 1}`;
    checkMixed(`${where} title`, s.title, L.title, problems);
    checkMixed(`${where} text`, s.body, L.body, problems);
    checkMixed(`${where} "explain further" text`, s.more, L.more, problems);
    if (s.diagram) {
      diagrams += 1;
      checkDiagram(`${where} diagram`, s.diagram, problems);
    }
  });
  if (diagrams > L.diagrams) problems.push(`There are ${diagrams} diagrams; use at most ${L.diagrams}.`);

  if (FORBIDDEN.test(JSON.stringify(e))) {
    problems.push("The explanation mentions AI, a model or how it was written. Students must never see that; remove it.");
  }
  return problems;
}

// ---- What an explanation is written from -----------------------------------

/** A test_items row, as much of it as an explanation needs. Deliberately no
 *  marking_notes: those are rulings written to the marker in its own
 *  vocabulary, and the student mark scheme never shows them
 *  (lib/student-mark-scheme.ts). */
export interface ExplanationPartItem {
  id: string;
  question_number: number;
  part_label: string | null;
  max_marks: number;
  sort_order: number;
  stem_text?: string | null;
  question_text?: string | null;
  markscheme_text: string | null;
}

/** One part, as the explanation of it is written from and keyed on. */
export interface ExplanationPartSource {
  itemId: string;
  /** mark_scheme_explanations' natural key within a test. */
  key: string;
  questionNumber: number;
  partLabel: string;
  /** As the self-grade form labels the part: "2.1(a)" on a creator paper, "5" or "2(d)" otherwise. */
  label: string;
  sortOrder: number;
  maxMarks: number;
  sectionHeading: string;
  /** The question's shared lead-in, for a lettered part; "" otherwise. */
  stem: string;
  /** The part's own words. */
  prompt: string;
  /** The teacher's answer; "" for a paper that keeps it inside the scheme. */
  answer: string;
  /** The teacher's mark scheme for the part, marking codes and all. */
  markScheme: string;
}

export function explanationKey(questionNumber: number, partLabel: string | null): string {
  return `${questionNumber}|${partLabel ?? ""}`;
}

interface DraftPart {
  label: string;
  sectionHeading: string;
  stem: string;
  prompt: string;
  answer: string;
  markScheme: string;
}

interface DraftQuestionShape {
  prompt?: string;
  answer?: string;
  markScheme?: string;
  subparts?: { prompt?: string; answer?: string; markScheme?: string }[];
}

/**
 * A creator draft's parts in sort_order: a question's subparts, or the
 * question itself when it has none -- the walk buildTestItemsFromSections
 * (lib/formative-assessment-bridge.ts) assigns sort_order by, and
 * paperQuestionPrefixes and studentMarkSchemeParts rely on the same way.
 * Null when the test has no draft.
 */
function draftParts(customContent: unknown): DraftPart[] | null {
  const sections = (customContent as { sections?: { heading?: string; questions?: DraftQuestionShape[] }[] } | null | undefined)
    ?.sections;
  if (!Array.isArray(sections) || sections.length === 0) return null;
  const parts: DraftPart[] = [];
  sections.forEach((section, sIdx) => {
    (section.questions ?? []).forEach((q, qIdx) => {
      const prefix = formatQuestionLabel(sIdx, qIdx, "numeric");
      const heading = section.heading ?? "";
      if (q.subparts && q.subparts.length > 0) {
        q.subparts.forEach((sp, i) =>
          parts.push({
            label: `${prefix}(${subpartLetter(i)})`,
            sectionHeading: heading,
            stem: q.prompt ?? "",
            prompt: sp.prompt ?? "",
            answer: sp.answer ?? "",
            markScheme: sp.markScheme ?? "",
          }),
        );
      } else {
        parts.push({
          label: prefix,
          sectionHeading: heading,
          stem: "",
          prompt: q.prompt ?? "",
          answer: q.answer ?? "",
          markScheme: q.markScheme ?? "",
        });
      }
    });
  });
  return parts;
}

/**
 * Every part of a test as its explanation is written from: the creator draft
 * when the test has one (its answer and scheme are what the student page
 * shows), else each item's own text. In sort_order. A draft part with no
 * item, or an item past the end of the draft, is left out -- the student
 * page cannot show it either.
 */
export function explanationPartSources(
  customContent: unknown,
  items: ReadonlyArray<ExplanationPartItem>,
): ExplanationPartSource[] {
  const draft = draftParts(customContent);
  const sorted = [...items].sort((a, b) => a.sort_order - b.sort_order);
  const sources: ExplanationPartSource[] = [];
  for (const item of sorted) {
    const partLabel = item.part_label ?? "";
    const base = {
      itemId: item.id,
      key: explanationKey(item.question_number, partLabel),
      questionNumber: item.question_number,
      partLabel,
      sortOrder: item.sort_order,
      maxMarks: item.max_marks,
    };
    if (draft) {
      const part = draft[item.sort_order];
      if (!part) continue;
      sources.push({ ...base, ...part });
    } else {
      sources.push({
        ...base,
        label: partLabel ? `${item.question_number}(${partLabel})` : String(item.question_number),
        sectionHeading: "",
        stem: item.stem_text ?? "",
        prompt: item.question_text ?? "",
        answer: "",
        markScheme: item.markscheme_text ?? "",
      });
    }
  }
  return sources;
}

/** Whether there is anything to explain: a part with neither an answer nor
 *  a scheme has nothing an explanation could be faithful to. */
export function canExplain(source: ExplanationPartSource): boolean {
  return source.answer.trim() !== "" || source.markScheme.trim() !== "";
}

/**
 * What an explanation was written from, as a hash: the part's words, the
 * teacher's answer and scheme, and its marks. Not its label, position or
 * item id -- a creator re-save recreates test_items with new ids and the
 * explanation of an unchanged part should survive it.
 */
export function explanationSourceHash(source: Pick<ExplanationPartSource, "stem" | "prompt" | "answer" | "markScheme" | "maxMarks">): string {
  const payload = JSON.stringify([source.stem.trim(), source.prompt.trim(), source.answer.trim(), source.markScheme.trim(), source.maxMarks]);
  return createHash("sha256").update(payload).digest("hex");
}

// ---- Stored explanations -----------------------------------------------------

/** A mark_scheme_explanations row (lib/mark-scheme-explanation-store.ts). */
export interface StoredExplanation {
  key: string;
  sourceHash: string;
  /** Null when the stored content is not a well-formed explanation. */
  content: MarkSchemeExplanation | null;
  model: string;
  promptVersion: number;
  updatedAt: string;
}

export type ExplanationState = "current" | "outdated" | "missing";

/** Whether a part's stored explanation may still be shown: it exists, reads,
 *  and was written from the part as it stands now. */
export function explanationState(source: ExplanationPartSource, stored: StoredExplanation | undefined): ExplanationState {
  if (!stored || !stored.content) return "missing";
  return stored.sourceHash === explanationSourceHash(source) ? "current" : "outdated";
}

/** The explanations a student may be shown, by test_items.id. */
export function currentExplanations(
  sources: ReadonlyArray<ExplanationPartSource>,
  stored: ReadonlyMap<string, StoredExplanation>,
): Map<string, MarkSchemeExplanation> {
  const current = new Map<string, MarkSchemeExplanation>();
  for (const source of sources) {
    const row = stored.get(source.key);
    if (row?.content && explanationState(source, row) === "current") current.set(source.itemId, row.content);
  }
  return current;
}
