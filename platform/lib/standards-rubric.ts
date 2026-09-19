/**
 * standards-rubric.ts
 * -----------------------------------------------------------------------------
 * How a Grade 9 STANDARD Level assessment is graded, once the parts are marked.
 *
 * Grade 9 Extended reports a paper as marks out of a total, banded into a 1-7
 * level by a grade boundary set (lib/grade-bands.ts). Grade 9 Standard does
 * not. Its teacher rubric (Key Assessment 1, Unit 1, September 2026 is the
 * first) groups every part of the paper into a handful of STRANDS, each
 * strand naming the Common Core standards it assesses, and turns the strand
 * total into one of four PERFORMANCE LEVELS -- Exceeding, Meeting,
 * Approaching, Beginning -- at about 85%, 65% and 40% of the strand's marks.
 * The overall level is the same bands applied to the whole paper.
 *
 * So the rubric is DATA on the test, not a second grading pipeline. The parts
 * are still graded one at a time by lib/ai-grading.ts against each part's own
 * "a full-mark response shows..." descriptor (stored as that item's
 * markscheme_text, source = 'custom'), and still accepted one at a time into
 * Clev's Marks. What this module adds is everything that follows from the
 * marks: which strand each part feeds, where the level thresholds fall for a
 * strand of that size, and the per-student report. It is stored as
 * `tests.standards_rubric` (jsonb) and is the only thing that makes a test
 * standards-referenced -- a test without one is graded exactly as before.
 *
 * Future Standard Level papers may look nothing like the first one: different
 * strands, different standards, a different number of them. That is why the
 * strand list, the part-to-strand map and the band proportions are all in the
 * rubric rather than in code, and why nothing here knows the letters A-D.
 *
 * Client-safe on purpose: no fs, no server imports, so the AI-grade review
 * panel can show a live strand report from the marks a teacher is editing.
 * The marking POLICY the grader loads for these papers lives in
 * grading_policies/g9_standard_level_marking_principles.md, read by
 * lib/ai-grading.ts at module init, not here.
 * -----------------------------------------------------------------------------
 */

import { z } from "zod";
import { parseStandardEntry, validateStandardCode } from "./ccss-math-codes";

// -----------------------------------------------------------------------------
// Performance levels
// -----------------------------------------------------------------------------

export type PerformanceLevel = "exceeding" | "meeting" | "approaching" | "beginning";

/** Highest first, which is the order every table on the rubric prints them. */
export const PERFORMANCE_LEVELS: ReadonlyArray<{
  value: PerformanceLevel;
  label: string;
  /** The abbreviation the teacher rubric's score record uses. */
  short: string;
}> = [
  { value: "exceeding", label: "Exceeding", short: "E" },
  { value: "meeting", label: "Meeting", short: "M" },
  { value: "approaching", label: "Approaching", short: "AP" },
  { value: "beginning", label: "Beginning", short: "B" },
];

export function performanceLevelLabel(level: PerformanceLevel): string {
  return PERFORMANCE_LEVELS.find((l) => l.value === level)?.label ?? level;
}

export function performanceLevelShort(level: PerformanceLevel): string {
  return PERFORMANCE_LEVELS.find((l) => l.value === level)?.short ?? level;
}

// -----------------------------------------------------------------------------
// The rubric
// -----------------------------------------------------------------------------

/**
 * A part reference as the rubric writes it: the question number followed
 * directly by the part letter, "2d", or the bare number for a question with
 * no parts, "5". Matched against test_items by (question_number, part_label)
 * after normalisation, so "2(d)", "2 d" and "2D" all mean the same part.
 */
const PART_REF_RE = /^(\d+)\s*[(]?\s*([a-z]+(?:\s*[(]?\s*(?:i{1,3}|iv|v)\s*[)]?)?)?\s*[)]?$/i;

const PartRefSchema = z
  .string()
  .trim()
  .min(1)
  .refine((s) => PART_REF_RE.test(s), { message: "A part is written like 2d, or 5 for a whole question" });

/**
 * Minimum proportion of a strand's marks for each level, highest first.
 * "beginning" is everything below approaching, so it has no threshold.
 */
export const LevelBandsSchema = z
  .object({
    exceeding: z.number().gt(0).lte(1),
    meeting: z.number().gt(0).lte(1),
    approaching: z.number().gt(0).lte(1),
  })
  .refine((b) => b.exceeding > b.meeting && b.meeting > b.approaching, {
    message: "Bands must descend: exceeding above meeting above approaching",
  });

export type LevelBands = z.infer<typeof LevelBandsSchema>;

/** The rubric's own bands: "about 85%, 65% and 40% of the marks in each strand". */
export const DEFAULT_LEVEL_BANDS: LevelBands = { exceeding: 0.85, meeting: 0.65, approaching: 0.4 };

/** What a student at each level of a strand does, in the rubric's words. */
export const LevelDescriptorsSchema = z
  .object({
    exceeding: z.string().trim().optional(),
    meeting: z.string().trim().optional(),
    approaching: z.string().trim().optional(),
    beginning: z.string().trim().optional(),
  })
  .partial();

export type LevelDescriptors = z.infer<typeof LevelDescriptorsSchema>;

export const RubricStrandSchema = z
  .object({
    /** Short and unique within the rubric: "A", "B", ... or anything the teacher uses. */
    code: z.string().trim().min(1).max(8),
    name: z.string().trim().min(1),
    /** The standards this strand assesses, each as its code plus wording: "F-LE.A.2 Build a linear rule from ...". */
    standards: z.array(z.string().trim().min(1)).default([]),
    /** Every part that counts towards this strand. A part belongs to exactly one strand. */
    parts: z.array(PartRefSchema).min(1),
    descriptors: LevelDescriptorsSchema.optional(),
  })
  .superRefine((strand, ctx) => {
    strand.standards.forEach((entry, i) => {
      const { code } = parseStandardEntry(entry);
      const result = validateStandardCode(code);
      if (!result.ok) {
        ctx.addIssue({
          code: "custom",
          path: ["standards", i],
          message: `Strand ${strand.code}: ${result.reason}`,
        });
      }
    });
  });

export type RubricStrand = z.infer<typeof RubricStrandSchema>;

export const StandardsRubricSchema = z.object({
  version: z.literal(1),
  /** Where it came from, for the teacher: "Teacher Marking Rubric, KA1 Unit 1". */
  source: z.string().trim().optional(),
  bands: LevelBandsSchema,
  strands: z.array(RubricStrandSchema).min(1),
  /** Descriptors for the overall level, when the rubric gives any. */
  overallDescriptors: LevelDescriptorsSchema.optional(),
}).superRefine((rubric, ctx) => {
  const codes = new Set<string>();
  for (const strand of rubric.strands) {
    const code = strand.code.toUpperCase();
    if (codes.has(code)) {
      ctx.addIssue({ code: "custom", message: `Strand code "${strand.code}" is used twice` });
    }
    codes.add(code);
  }
  const seen = new Map<string, string>();
  for (const strand of rubric.strands) {
    for (const part of strand.parts) {
      const key = normalisePartRef(part);
      const other = seen.get(key);
      if (other && other !== strand.code) {
        ctx.addIssue({
          code: "custom",
          message: `Part ${part} is in strand ${other} and strand ${strand.code}; a part counts towards exactly one strand`,
        });
      }
      seen.set(key, strand.code);
    }
  }
});

export type StandardsRubric = z.infer<typeof StandardsRubricSchema>;

/**
 * Narrow an untrusted value (a jsonb column, a request body) to a rubric.
 * Null in, null out: a test without a rubric is the common case, not an error.
 */
export function parseStandardsRubric(
  value: unknown,
): { ok: true; rubric: StandardsRubric | null } | { ok: false; error: string } {
  if (value === null || value === undefined) return { ok: true, rubric: null };
  const parsed = StandardsRubricSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  return { ok: true, rubric: parsed.data };
}

// -----------------------------------------------------------------------------
// Part references
// -----------------------------------------------------------------------------

/** "2(d)" -> "2d", "5" -> "5", "3 b ii" -> "3bii". The key two refs are compared on. */
export function normalisePartRef(ref: string): string {
  return ref.toLowerCase().replace(/[()\[\]\s.]/g, "");
}

/** The ref for a test_items row, in the same normalised form. */
export function partRefForItem(item: { question_number: number; part_label: string | null }): string {
  return normalisePartRef(`${item.question_number}${item.part_label ?? ""}`);
}

/** Split a ref into the columns test_items keys on. Null when it is not a ref at all. */
export function parsePartRef(ref: string): { questionNumber: number; partLabel: string } | null {
  const m = ref.trim().match(PART_REF_RE);
  if (!m) return null;
  return { questionNumber: Number(m[1]), partLabel: (m[2] ?? "").toLowerCase().replace(/[()\s]/g, "") };
}

/** Human label for a ref, matching the review UI: "Q2(d)", "Q5". */
export function partRefLabel(ref: string): string {
  const parsed = parsePartRef(ref);
  if (!parsed) return ref;
  return parsed.partLabel ? `Q${parsed.questionNumber}(${parsed.partLabel})` : `Q${parsed.questionNumber}`;
}

// -----------------------------------------------------------------------------
// Levels
// -----------------------------------------------------------------------------

/**
 * The fewest marks that reach a band, for a strand of `max` marks.
 *
 * Ceiling, not rounding: the rubric's "about 85%" of an 11-mark strand is
 * printed as 10-11, and 0.85 x 11 = 9.35 rounds to 9 but ceils to 10. The
 * same rule reproduces every threshold on the KA1 rubric (13 marks: 12, 9, 6;
 * 9 marks: 8, 6, 4; 42 marks: 36, 28, 17), which is the test that pins it.
 * The epsilon keeps 0.4 x 10 = 4.000000000000001 from ceiling to 5.
 */
export function minMarksForBand(proportion: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.ceil(proportion * max - 1e-9));
}

export interface LevelThresholds {
  exceeding: number;
  meeting: number;
  approaching: number;
}

export function levelThresholds(max: number, bands: LevelBands): LevelThresholds {
  return {
    exceeding: minMarksForBand(bands.exceeding, max),
    meeting: minMarksForBand(bands.meeting, max),
    approaching: minMarksForBand(bands.approaching, max),
  };
}

/** The level `marks` out of `max` earns. A strand of zero marks cannot place anyone. */
export function levelForMarks(marks: number, max: number, bands: LevelBands): PerformanceLevel | null {
  if (max <= 0) return null;
  const t = levelThresholds(max, bands);
  if (marks >= t.exceeding) return "exceeding";
  if (marks >= t.meeting) return "meeting";
  if (marks >= t.approaching) return "approaching";
  return "beginning";
}

/** "10-11", "8-9", "5-7", "0-4": the mark ranges for each level, as the rubric prints them. */
export function levelRanges(max: number, bands: LevelBands): Record<PerformanceLevel, string> {
  const t = levelThresholds(max, bands);
  const range = (lo: number, hi: number) => (lo > hi ? "-" : lo === hi ? `${lo}` : `${lo}-${hi}`);
  return {
    exceeding: range(t.exceeding, max),
    meeting: range(t.meeting, t.exceeding - 1),
    approaching: range(t.approaching, t.meeting - 1),
    beginning: range(0, t.approaching - 1),
  };
}

// -----------------------------------------------------------------------------
// Rubric against a test's items
// -----------------------------------------------------------------------------

/** The columns of test_items this module reads. */
export interface RubricItem {
  id: string;
  question_number: number;
  part_label: string | null;
  max_marks: number;
}

export interface RubricFinding {
  severity: "block" | "warn";
  message: string;
}

/**
 * Does this rubric fit this test? Blocking findings mean a strand total would
 * be wrong (a part that does not exist on the test); warnings mean a part of
 * the test is outside every strand, which the rubric's own rule ("every part
 * counts towards exactly one strand") says should not happen but a bonus
 * question legitimately is.
 */
export function checkRubricAgainstItems(rubric: StandardsRubric, items: RubricItem[]): RubricFinding[] {
  const findings: RubricFinding[] = [];
  const byRef = new Map(items.map((i) => [partRefForItem(i), i]));
  const claimed = new Set<string>();

  for (const strand of rubric.strands) {
    for (const part of strand.parts) {
      const key = normalisePartRef(part);
      if (!byRef.has(key)) {
        findings.push({
          severity: "block",
          message: `Strand ${strand.code} lists ${partRefLabel(part)}, which is not a part of this test`,
        });
      }
      claimed.add(key);
    }
  }

  for (const item of items) {
    if (!claimed.has(partRefForItem(item))) {
      findings.push({
        severity: "warn",
        message: `${partRefLabel(`${item.question_number}${item.part_label ?? ""}`)} (${item.max_marks} mark${
          item.max_marks === 1 ? "" : "s"
        }) is in no strand, so it counts towards the total but no strand level`,
      });
    }
  }

  return findings;
}

/** The strand a test item feeds, or null when the rubric leaves it out. */
export function strandForItem(rubric: StandardsRubric, item: { question_number: number; part_label: string | null }): RubricStrand | null {
  const key = partRefForItem(item);
  for (const strand of rubric.strands) {
    if (strand.parts.some((p) => normalisePartRef(p) === key)) return strand;
  }
  return null;
}

// -----------------------------------------------------------------------------
// The per-student report
// -----------------------------------------------------------------------------

export interface StrandReport {
  code: string;
  name: string;
  marks: number;
  max: number;
  level: PerformanceLevel | null;
  thresholds: LevelThresholds;
  /** How many of the strand's parts have a mark. A level over a half-marked strand is provisional. */
  markedParts: number;
  totalParts: number;
}

export interface StandardsReport {
  strands: StrandReport[];
  overall: {
    marks: number;
    max: number;
    level: PerformanceLevel | null;
    thresholds: LevelThresholds;
    markedParts: number;
    totalParts: number;
  };
  /** Every part is marked: the levels are final rather than running totals. */
  complete: boolean;
}

/**
 * Strand totals and levels from one student's marks, keyed by test_items.id.
 * A missing or null mark is "not marked yet", not zero -- the level is still
 * computed from what is there (a teacher reviewing a half-accepted paper
 * wants to see where it is heading) but `complete` says whether to trust it.
 * A student with no marks at all has null levels everywhere.
 *
 * The overall total is over EVERY item, including any outside all strands
 * (a bonus question), because that is what the paper is out of.
 */
export function buildStandardsReport(
  rubric: StandardsRubric,
  items: RubricItem[],
  marksByItemId: ReadonlyMap<string, number | null | undefined> | Record<string, number | null | undefined>,
): StandardsReport {
  const lookup: (id: string) => number | null | undefined =
    marksByItemId instanceof Map
      ? (id) => (marksByItemId as ReadonlyMap<string, number | null | undefined>).get(id)
      : (id) => (marksByItemId as Record<string, number | null | undefined>)[id];
  const markOf = (id: string): number | null => {
    const v = lookup(id);
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const byRef = new Map(items.map((i) => [partRefForItem(i), i]));

  const strands: StrandReport[] = rubric.strands.map((strand) => {
    let marks = 0;
    let max = 0;
    let markedParts = 0;
    let totalParts = 0;
    for (const part of strand.parts) {
      const item = byRef.get(normalisePartRef(part));
      if (!item) continue;
      totalParts += 1;
      max += item.max_marks;
      const m = markOf(item.id);
      if (m !== null) {
        marks += m;
        markedParts += 1;
      }
    }
    return {
      code: strand.code,
      name: strand.name,
      marks,
      max,
      level: markedParts > 0 ? levelForMarks(marks, max, rubric.bands) : null,
      thresholds: levelThresholds(max, rubric.bands),
      markedParts,
      totalParts,
    };
  });

  let overallMarks = 0;
  let overallMax = 0;
  let overallMarked = 0;
  for (const item of items) {
    overallMax += item.max_marks;
    const m = markOf(item.id);
    if (m !== null) {
      overallMarks += m;
      overallMarked += 1;
    }
  }

  return {
    strands,
    overall: {
      marks: overallMarks,
      max: overallMax,
      level: overallMarked > 0 ? levelForMarks(overallMarks, overallMax, rubric.bands) : null,
      thresholds: levelThresholds(overallMax, rubric.bands),
      markedParts: overallMarked,
      totalParts: items.length,
    },
    complete: items.length > 0 && overallMarked === items.length,
  };
}

// -----------------------------------------------------------------------------
// Class export
// -----------------------------------------------------------------------------

export interface StudentStandardsRow {
  name: string;
  /** "9D", when the roster spans classes. */
  className: string | null;
  report: StandardsReport | null;
  absent: boolean;
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The class's strand levels as a CSV: one row per student, one marks column
 * and one level column per strand, then the overall. Levels use the rubric's
 * own abbreviations (E, M, AP, B). An absent student has "ABS" in every
 * column; an unmarked one has blanks. CRLF line ends, which is what a
 * spreadsheet opening it on Windows expects.
 */
export function buildStandardsReportCsv(rubric: StandardsRubric, rows: StudentStandardsRow[]): string {
  const header = ["Student", "Class"];
  for (const s of rubric.strands) header.push(`${s.code} marks`, `${s.code} level`);
  header.push("Total", "Overall level");

  const lines = [header.map(csvCell).join(",")];
  for (const row of rows) {
    const cells: (string | number)[] = [row.name, row.className ?? ""];
    if (row.absent) {
      for (let i = 0; i < rubric.strands.length * 2 + 2; i++) cells.push("ABS");
    } else if (!row.report || row.report.overall.markedParts === 0) {
      for (let i = 0; i < rubric.strands.length * 2 + 2; i++) cells.push("");
    } else {
      for (const strand of row.report.strands) {
        cells.push(`${strand.marks}/${strand.max}`, strand.level ? performanceLevelShort(strand.level) : "");
      }
      cells.push(
        `${row.report.overall.marks}/${row.report.overall.max}`,
        row.report.overall.level ? performanceLevelShort(row.report.overall.level) : "",
      );
    }
    lines.push(cells.map(csvCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
