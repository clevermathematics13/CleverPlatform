/**
 * activity-rubric.ts
 * -----------------------------------------------------------------------------
 * How a Math Medic Exploration or a homework is read, once the parts are marked.
 *
 * This is the third way a paper can be reported in this platform, and it exists
 * because the other two both answer a question an Exploration is not asking.
 * Grade 9 Extended reports marks out of a total banded into a 1-7 by a boundary
 * set (lib/grade-bands.ts). Grade 9 Standard reports a PERFORMANCE LEVEL per
 * strand of Common Core standards (lib/standards-rubric.ts). Both are verdicts
 * on work a student has already been taught. A Math Medic Exploration is sat
 * BEFORE the lesson -- being wrong on it is the design, not a failure -- so the
 * only useful thing to report is whether each student has the idea yet:
 *
 *   Got it / Almost / Not yet
 *
 * per LEARNING TARGET, which is the grouping Math Medic already prints on the
 * lesson's QuickNotes ("LT #1: Look for relationships between variables").
 *
 * So, exactly as on the Standard Level side, the rubric is DATA on the test
 * (`tests.activity_rubric`, jsonb) and not a second grading pipeline. Parts are
 * still graded one at a time by lib/ai-grading.ts against each part's own
 * descriptor, and still accepted one at a time into Clev's Marks. What this
 * module adds is everything that follows from the marks: which learning target
 * each part feeds, and what a student's marks in that target mean.
 *
 * MARKS ARE PLUMBING HERE, NOT A SCORE. Every validator downstream is built on
 * `suggestedMarks` being a whole number of awarded tokens in 0..maxMarks, so an
 * activity uses that machinery rather than fighting it: a part is worth 1 or 2
 * marks, and the outcome is read off the marks. Whether any of it reaches the
 * gradebook is per-test and off by default -- see `tests.hidden_from_gradebook`.
 *
 * Client-safe on purpose: no fs, no server imports, so the AI-grade review
 * panel can show a live target table from the marks a teacher is editing. The
 * marking POLICY the grader loads for these papers lives in
 * grading_policies/mathmedic_activity_marking_principles.md, read by
 * lib/ai-grading.ts at module init, not here.
 *
 * Part references (normalisePartRef, parsePartRef, partRefLabel, partRefForItem)
 * and the proportion-to-marks rule (minMarksForBand) are imported from
 * lib/standards-rubric.ts rather than copied: a part is written "2d" in both
 * rubrics and must mean the same part in both, and a threshold must land on the
 * same mark count whichever table prints it.
 * -----------------------------------------------------------------------------
 */

import { z } from "zod";
import {
  minMarksForBand,
  normalisePartRef,
  parsePartRef,
  partRefForItem,
  partRefLabel,
  type RubricFinding,
  type RubricItem,
} from "./standards-rubric";

export { normalisePartRef, parsePartRef, partRefForItem, partRefLabel } from "./standards-rubric";
export type { RubricFinding, RubricItem } from "./standards-rubric";

// -----------------------------------------------------------------------------
// Outcomes
// -----------------------------------------------------------------------------

export type ActivityOutcome = "got_it" | "almost" | "not_yet";

/** Highest first, which is the order every table in the UI prints them. */
export const ACTIVITY_OUTCOMES: ReadonlyArray<{
  value: ActivityOutcome;
  label: string;
  /** The abbreviation the class table and the CSV use. */
  short: string;
}> = [
  { value: "got_it", label: "Got it", short: "G" },
  { value: "almost", label: "Almost", short: "A" },
  { value: "not_yet", label: "Not yet", short: "N" },
];

export function activityOutcomeLabel(outcome: ActivityOutcome): string {
  return ACTIVITY_OUTCOMES.find((o) => o.value === outcome)?.label ?? outcome;
}

export function activityOutcomeShort(outcome: ActivityOutcome): string {
  return ACTIVITY_OUTCOMES.find((o) => o.value === outcome)?.short ?? outcome;
}

/**
 * What one PART's marks mean. No thresholds here on purpose: a part is worth
 * 1 or 2 marks, so "everything" / "something" / "nothing" is the whole scale.
 * A 1-mark part therefore has no Almost, which is correct -- either the student
 * showed the idea or they did not.
 */
export function outcomeForPart(marks: number, max: number): ActivityOutcome {
  if (max <= 0) return "not_yet";
  if (marks >= max) return "got_it";
  if (marks > 0) return "almost";
  return "not_yet";
}

// -----------------------------------------------------------------------------
// The rubric
// -----------------------------------------------------------------------------

/**
 * Minimum proportion of a learning target's marks for each outcome, highest
 * first. "not_yet" is everything below almost, so it has no threshold.
 *
 * A target spans several parts, so unlike a single part it does need bands:
 * one slip across five parts is still Got it, and the teacher decides where
 * that line falls rather than this file.
 */
export const OutcomeBandsSchema = z
  .object({
    gotIt: z.number().gt(0).lte(1),
    almost: z.number().gt(0).lte(1),
  })
  .refine((b) => b.gotIt > b.almost, {
    message: "Bands must descend: Got it above Almost",
  });

export type OutcomeBands = z.infer<typeof OutcomeBandsSchema>;

/**
 * Where the lines fall by default: Got it at 80% of a target's marks, Almost
 * at 50%. Deliberately more forgiving than the Standard Level bands (85/65/40)
 * -- this is pre-instruction work and the report is a teaching signal, not a
 * grade, so the cost of reading "Almost" as "Got it" is small and the cost of
 * the reverse is a student reteaught something they already knew.
 */
export const DEFAULT_OUTCOME_BANDS: OutcomeBands = { gotIt: 0.8, almost: 0.5 };

/** What the activity is. Changes the wording in the UI, nothing in the marking. */
export type ActivityKind = "exploration" | "homework";

export const ACTIVITY_KINDS: ReadonlyArray<{ value: ActivityKind; label: string; blurb: string }> = [
  {
    value: "exploration",
    label: "Exploration",
    blurb: "Sat before the lesson. Being wrong is expected; the report says what to teach.",
  },
  {
    value: "homework",
    label: "Homework",
    blurb: "Sat after the lesson. The report says what has not landed yet.",
  },
];

export const ActivityKindSchema = z.enum(["exploration", "homework"]);

/**
 * The classes the Exploration/homework route is offered for.
 *
 * 9D only, deliberately, while the route is new: 9D is the Standard Level
 * class the first Exploration was brought in for, and the marking policy has
 * not been measured on real work from anyone yet. Math Medic runs in the
 * Extended classes too, and DP homework would fit this route as well, so this
 * list is expected to grow -- widen it here, not at each call site.
 *
 * Matched by NAME, because that is what the teacher reads in the dropdown,
 * and because the course id changes every school year while "9D" does not.
 * The same choice, for the same reason, as ASSESSMENT_COURSE_NAMES in
 * lib/assessment-kind.ts.
 */
export const ACTIVITY_COURSE_NAMES = ["9D"] as const;

/**
 * The courses to offer, given everything that exists. Order is preserved from
 * the input so the list reads the same every time. An activity's OWN course is
 * always offered alongside these, whatever it is, so that re-saving one cannot
 * quietly move it.
 */
export function allowedActivityCourses<T extends { id: string; name: string }>(
  all: T[],
  loadedCourseId: string | null = null,
): T[] {
  const names = new Set<string>(ACTIVITY_COURSE_NAMES);
  return all.filter((c) => names.has(c.name) || (loadedCourseId !== null && c.id === loadedCourseId));
}

/**
 * A part reference as the rubric writes it, reusing the Standard Level side's
 * grammar exactly: "2d", or the bare number "5" for a question with no parts.
 */
const ActivityPartRefSchema = z
  .string()
  .trim()
  .min(1)
  .refine((s) => parsePartRef(s) !== null, {
    message: "A part is written like 2d, or 5 for a whole question",
  });

export const LearningTargetSchema = z.object({
  /** Short and unique within the rubric: "LT1", "LT2", or whatever the lesson prints. */
  code: z.string().trim().min(1).max(8),
  /** The target in the lesson's own words: "Look for relationships between variables". */
  name: z.string().trim().min(1),
  /** Optional elaboration, e.g. the QuickNotes line under the target. */
  note: z.string().trim().optional(),
  /** Every part that shows whether the student has this target. */
  parts: z.array(ActivityPartRefSchema).min(1),
});

export type LearningTarget = z.infer<typeof LearningTargetSchema>;

export const ActivityRubricSchema = z
  .object({
    version: z.literal(1),
    kind: ActivityKindSchema,
    /** Where it came from, for the teacher: "Math Medic Lesson 1.1 answer key". */
    source: z.string().trim().optional(),
    /** The lesson this belongs to, as the teacher names it: "1.1". */
    lesson: z.string().trim().optional(),
    bands: OutcomeBandsSchema,
    targets: z.array(LearningTargetSchema).min(1),
  })
  .superRefine((rubric, ctx) => {
    const codes = new Set<string>();
    for (const target of rubric.targets) {
      const code = target.code.toUpperCase();
      if (codes.has(code)) {
        ctx.addIssue({ code: "custom", message: `Learning target "${target.code}" is used twice` });
      }
      codes.add(code);
    }
    // Unlike a strand, a part MAY feed more than one learning target: an
    // Exploration question that asks for an equation and then for what it
    // means shows both "describe a relationship" and "use operations to write
    // it". Only an exact duplicate inside ONE target is a mistake.
    for (const target of rubric.targets) {
      const seen = new Set<string>();
      for (const part of target.parts) {
        const key = normalisePartRef(part);
        if (seen.has(key)) {
          ctx.addIssue({
            code: "custom",
            message: `${partRefLabel(part)} is listed twice in ${target.code}`,
          });
        }
        seen.add(key);
      }
    }
  });

export type ActivityRubric = z.infer<typeof ActivityRubricSchema>;

/**
 * Narrow an untrusted value (a jsonb column, a request body) to a rubric.
 * Null in, null out: a test without one is the common case, not an error.
 */
export function parseActivityRubric(
  value: unknown,
): { ok: true; rubric: ActivityRubric | null } | { ok: false; error: string } {
  if (value === null || value === undefined) return { ok: true, rubric: null };
  const parsed = ActivityRubricSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  return { ok: true, rubric: parsed.data };
}

// -----------------------------------------------------------------------------
// Targets against a test's items
// -----------------------------------------------------------------------------

/**
 * Does this rubric fit this test? A target naming a part the test does not
 * have would silently shrink that target's total, so it blocks. A part in no
 * target only means it is not evidence for any of them, which is normal on a
 * homework with a warm-up question, so it warns.
 */
export function checkActivityRubricAgainstItems(
  rubric: ActivityRubric,
  items: RubricItem[],
): RubricFinding[] {
  const findings: RubricFinding[] = [];
  const byRef = new Map(items.map((i) => [partRefForItem(i), i]));
  const claimed = new Set<string>();

  for (const target of rubric.targets) {
    for (const part of target.parts) {
      const key = normalisePartRef(part);
      if (!byRef.has(key)) {
        findings.push({
          severity: "block",
          message: `${target.code} lists ${partRefLabel(part)}, which is not a part of this activity`,
        });
      }
      claimed.add(key);
    }
  }

  for (const item of items) {
    if (!claimed.has(partRefForItem(item))) {
      findings.push({
        severity: "warn",
        message: `${partRefLabel(`${item.question_number}${item.part_label ?? ""}`)} is in no learning target, so it is marked but reported nowhere`,
      });
    }
  }

  return findings;
}

/** Every learning target a test item feeds. Empty when the rubric leaves it out. */
export function targetsForItem(
  rubric: ActivityRubric,
  item: { question_number: number; part_label: string | null },
): LearningTarget[] {
  const key = partRefForItem(item);
  return rubric.targets.filter((t) => t.parts.some((p) => normalisePartRef(p) === key));
}

// -----------------------------------------------------------------------------
// The per-student report
// -----------------------------------------------------------------------------

/** One part inside a target report, so the teacher can see what let it down. */
export interface ActivityPartReport {
  itemId: string;
  label: string;
  marks: number | null;
  max: number;
  outcome: ActivityOutcome | null;
}

export interface TargetReport {
  code: string;
  name: string;
  note?: string;
  marks: number;
  max: number;
  outcome: ActivityOutcome | null;
  /** The fewest marks that reach each outcome, for a target of this size. */
  thresholds: { gotIt: number; almost: number };
  markedParts: number;
  totalParts: number;
  parts: ActivityPartReport[];
}

export interface ActivityReport {
  targets: TargetReport[];
  /** Every part is marked: the outcomes are settled rather than running totals. */
  complete: boolean;
  /** How many parts carry a mark, over how many the activity has. */
  markedParts: number;
  totalParts: number;
}

export function outcomeThresholds(max: number, bands: OutcomeBands): { gotIt: number; almost: number } {
  return {
    gotIt: minMarksForBand(bands.gotIt, max),
    almost: minMarksForBand(bands.almost, max),
  };
}

/** The outcome `marks` out of `max` earns across a target. Zero marks cannot place anyone. */
export function outcomeForTarget(marks: number, max: number, bands: OutcomeBands): ActivityOutcome | null {
  if (max <= 0) return null;
  const t = outcomeThresholds(max, bands);
  if (marks >= t.gotIt) return "got_it";
  if (marks >= t.almost) return "almost";
  return "not_yet";
}

/**
 * Learning-target outcomes from one student's marks, keyed by test_items.id.
 *
 * A missing or null mark is "not marked yet", not zero -- the outcome is still
 * computed from what is there, so a teacher reviewing a half-accepted activity
 * sees where it is heading, and `complete` says whether to trust it. A student
 * with no marks at all has null outcomes everywhere.
 *
 * There is deliberately no overall figure. An Exploration has no total worth
 * printing: "Got it on LT1, Not yet on LT3" is the whole point, and rolling
 * that into one number is the grade this route exists to avoid.
 */
export function buildActivityReport(
  rubric: ActivityRubric,
  items: RubricItem[],
  marksByItemId: ReadonlyMap<string, number | null | undefined> | Record<string, number | null | undefined>,
): ActivityReport {
  const lookup: (id: string) => number | null | undefined =
    marksByItemId instanceof Map
      ? (id) => (marksByItemId as ReadonlyMap<string, number | null | undefined>).get(id)
      : (id) => (marksByItemId as Record<string, number | null | undefined>)[id];
  const markOf = (id: string): number | null => {
    const v = lookup(id);
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const byRef = new Map(items.map((i) => [partRefForItem(i), i]));

  const targets: TargetReport[] = rubric.targets.map((target) => {
    let marks = 0;
    let max = 0;
    let markedParts = 0;
    const parts: ActivityPartReport[] = [];

    for (const ref of target.parts) {
      const item = byRef.get(normalisePartRef(ref));
      if (!item) continue;
      max += item.max_marks;
      const m = markOf(item.id);
      if (m !== null) {
        marks += m;
        markedParts += 1;
      }
      parts.push({
        itemId: item.id,
        label: partRefLabel(`${item.question_number}${item.part_label ?? ""}`),
        marks: m,
        max: item.max_marks,
        outcome: m === null ? null : outcomeForPart(m, item.max_marks),
      });
    }

    return {
      code: target.code,
      name: target.name,
      ...(target.note ? { note: target.note } : {}),
      marks,
      max,
      outcome: markedParts > 0 ? outcomeForTarget(marks, max, rubric.bands) : null,
      thresholds: outcomeThresholds(max, rubric.bands),
      markedParts,
      totalParts: parts.length,
      parts,
    };
  });

  let marked = 0;
  for (const item of items) if (markOf(item.id) !== null) marked += 1;

  return {
    targets,
    complete: items.length > 0 && marked === items.length,
    markedParts: marked,
    totalParts: items.length,
  };
}

// -----------------------------------------------------------------------------
// Class export
// -----------------------------------------------------------------------------

export interface StudentActivityRow {
  name: string;
  /** "9D", when the roster spans classes. */
  className: string | null;
  report: ActivityReport | null;
  absent: boolean;
}

/** How many students sit at each outcome for one target. The reteach signal. */
export interface TargetTally {
  code: string;
  name: string;
  got_it: number;
  almost: number;
  not_yet: number;
  /** Students with no mark yet on any part of this target. */
  unmarked: number;
}

export function tallyTargets(rubric: ActivityRubric, rows: StudentActivityRow[]): TargetTally[] {
  return rubric.targets.map((target, index) => {
    const tally: TargetTally = { code: target.code, name: target.name, got_it: 0, almost: 0, not_yet: 0, unmarked: 0 };
    for (const row of rows) {
      if (row.absent) continue;
      const outcome = row.report?.targets[index]?.outcome ?? null;
      if (outcome === null) tally.unmarked += 1;
      else tally[outcome] += 1;
    }
    return tally;
  });
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The class's learning targets as a CSV: one row per student, one column per
 * target holding the outcome. An absent student has "ABS" in every column; an
 * unmarked one has blanks. CRLF line ends, which is what a spreadsheet opening
 * it on Windows expects.
 *
 * Outcomes are written out in full ("Got it"), not abbreviated: this file is
 * read by a human deciding what to reteach, not pasted into PowerSchool.
 */
export function buildActivityReportCsv(rubric: ActivityRubric, rows: StudentActivityRow[]): string {
  const header = ["Student", "Class", ...rubric.targets.map((t) => `${t.code} ${t.name}`)];
  const lines = [header.map(csvCell).join(",")];

  for (const row of rows) {
    const cells: (string | number)[] = [row.name, row.className ?? ""];
    for (let i = 0; i < rubric.targets.length; i++) {
      if (row.absent) {
        cells.push("ABS");
        continue;
      }
      const outcome = row.report?.targets[i]?.outcome ?? null;
      cells.push(outcome ? activityOutcomeLabel(outcome) : "");
    }
    lines.push(cells.map(csvCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
