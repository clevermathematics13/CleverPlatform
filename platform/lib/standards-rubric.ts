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
 * ClevMarks. What this module adds is everything that follows from the
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
 *
 * The zod-free part -- levels, part references, thresholds and the report --
 * lives in lib/standards-report.ts and is re-exported below, so a client page
 * can import it without shipping zod; this module keeps the schemas.
 */

import { z } from "zod";
import { PART_REF_RE, normalisePartRef } from "./standards-report";

export * from "./standards-report";

// -----------------------------------------------------------------------------
// The rubric
// -----------------------------------------------------------------------------


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

export const RubricStrandSchema = z.object({
  /** Short and unique within the rubric: "A", "B", ... or anything the teacher uses. */
  code: z.string().trim().min(1).max(8),
  name: z.string().trim().min(1),
  /** The standards this strand assesses, each as its code plus wording: "F-LE.A.2 Build a linear rule from ...". */
  standards: z.array(z.string().trim().min(1)).default([]),
  /** Every part that counts towards this strand. A part belongs to exactly one strand. */
  parts: z.array(PartRefSchema).min(1),
  descriptors: LevelDescriptorsSchema.optional(),
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
