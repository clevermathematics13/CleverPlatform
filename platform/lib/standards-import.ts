/**
 * standards-import.ts
 * -----------------------------------------------------------------------------
 * Turning a Grade 9 Standard Level paper and its teacher rubric into a
 * gradeable test.
 *
 * A Standard Level assessment arrives as two PDFs the teacher wrote outside
 * the platform: the paper the students sat, and a Teacher Marking Rubric
 * that maps every part to a strand, names the standards each strand
 * assesses, sets the level bands and says what a full-mark response to each
 * part shows. Nothing in the assessment creator produced them, so there is
 * no draft to derive test_items from -- and future papers "may look
 * different from this first assessment", so a hand-written seed per paper
 * is not a plan.
 *
 * This module is the read: a structured-output call that transcribes the two
 * documents into the shape lib/standards-rubric.ts and the tests/test_items
 * tables want, then a validator that checks the transcription against
 * itself (26 parts that sum to the printed 42; four strands that sum to the
 * printed strand totals; every part in exactly one strand). The teacher
 * reviews the result on screen and saves it; nothing is written by the read.
 *
 * Separated from the route so the prompts and the validator are testable and
 * so the validator is the same function the save route runs again -- a draft
 * the teacher edited on screen is re-checked before it becomes a test.
 * -----------------------------------------------------------------------------
 */

import { z } from "zod";
import {
  StandardsRubricSchema,
  checkRubricAgainstItems,
  normalisePartRef,
  partRefLabel,
  type RubricFinding,
  type StandardsRubric,
} from "./standards-rubric";

/**
 * The model that reads the PDFs. One call per assessment, at the teacher's
 * desk, transcribing a mark scheme students will be graded by: the expensive
 * failure is a misread part, not a slow read, so this is the strongest model
 * with adaptive thinking, the same choice lib/practice-question-generator.ts
 * makes for the same reason.
 */
export const STANDARDS_IMPORT_MODEL = "claude-opus-5";

// -----------------------------------------------------------------------------
// What the model returns
// -----------------------------------------------------------------------------
//
// Every field is required (nullable where it may be unknown) rather than
// optional: structured output wants a closed schema, and a field the model
// may leave out is a field it will leave out.

const ExtractedItemSchema = z.object({
  questionNumber: z.number().int().min(1),
  /** "a", "b", "c" ... or "" for a question with no parts. Lower-case letters only. */
  partLabel: z.string(),
  maxMarks: z.number().int().min(0),
  /** The question as printed, self-contained: the shared stem of a multi-part question repeated on every part. Maths in $...$ LaTeX. */
  questionText: z.string(),
  /** The rubric's "a full-mark response shows..." for this part, plus the answer, plus any marking notes the rubric gives. */
  markschemeText: z.string(),
});

const ExtractedStrandSchema = z.object({
  code: z.string(),
  name: z.string(),
  standards: z.array(z.string()),
  /** Part refs as the rubric writes them: "2d", "5". */
  parts: z.array(z.string()),
  /** The strand's mark total as printed on the rubric, or null if it prints none. */
  statedMarks: z.number().int().nullable(),
  descriptors: z.object({
    exceeding: z.string().nullable(),
    meeting: z.string().nullable(),
    approaching: z.string().nullable(),
    beginning: z.string().nullable(),
  }),
});

export const ExtractedAssessmentSchema = z.object({
  /** The paper's title as printed, e.g. "Key Assessment 1 - Unit 1". */
  name: z.string(),
  /** ISO date (YYYY-MM-DD) the paper was sat, from the cover, or null. A date range uses its first day. */
  testDate: z.string().nullable(),
  timeAllowedMinutes: z.number().int().nullable(),
  calculatorPermitted: z.boolean().nullable(),
  /** The total printed on the cover, or null. */
  statedTotalMarks: z.number().int().nullable(),
  items: z.array(ExtractedItemSchema),
  /** Level band proportions as the rubric states them (0-1). Null when the rubric gives none; the platform's default is 0.85 / 0.65 / 0.40. */
  bands: z
    .object({ exceeding: z.number(), meeting: z.number(), approaching: z.number() })
    .nullable(),
  strands: z.array(ExtractedStrandSchema),
  /** Descriptors for the overall level, if the rubric prints any. */
  overallDescriptors: z.object({
    exceeding: z.string().nullable(),
    meeting: z.string().nullable(),
    approaching: z.string().nullable(),
    beginning: z.string().nullable(),
  }),
  /** Where the rubric came from, for the record: its printed title. */
  rubricSource: z.string().nullable(),
  /** Anything the reader was unsure about, one line each, for the teacher. */
  readerNotes: z.array(z.string()),
});

export type ExtractedAssessment = z.infer<typeof ExtractedAssessmentSchema>;

// -----------------------------------------------------------------------------
// What gets saved
// -----------------------------------------------------------------------------

export const StandardsDraftItemSchema = z.object({
  questionNumber: z.number().int().min(1),
  partLabel: z.string().trim().max(8),
  maxMarks: z.number().int().min(0).max(50),
  questionText: z.string().trim(),
  markschemeText: z.string().trim(),
});

export type StandardsDraftItem = z.infer<typeof StandardsDraftItemSchema>;

/** The reviewed, editable draft the importer page holds and the save route accepts. */
export const StandardsAssessmentDraftSchema = z.object({
  name: z.string().trim().min(1).max(200),
  /** YYYY-MM-DD or null. */
  testDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  statedTotalMarks: z.number().int().nullable(),
  items: z.array(StandardsDraftItemSchema).min(1),
  rubric: StandardsRubricSchema,
  /** Strand totals as printed on the rubric, keyed by strand code, for the consistency check. */
  statedStrandMarks: z.record(z.string(), z.number().int()).default({}),
  readerNotes: z.array(z.string()).default([]),
});

export type StandardsAssessmentDraft = z.infer<typeof StandardsAssessmentDraftSchema>;

function clean(s: string | null | undefined): string | undefined {
  const t = (s ?? "").trim();
  return t.length > 0 ? t : undefined;
}

/**
 * The model's transcription as a draft the teacher can edit and save.
 *
 * Normalises what the rubric schema is strict about (lower-case part labels,
 * trimmed strings, the platform's default bands when the rubric gives none)
 * and drops empty descriptors rather than storing "". Does NOT validate --
 * that is validateStandardsDraft, run on this and again on whatever the
 * teacher saves.
 */
export function toStandardsDraft(extracted: ExtractedAssessment): StandardsAssessmentDraft {
  const rubric: StandardsRubric = {
    version: 1,
    ...(clean(extracted.rubricSource) ? { source: clean(extracted.rubricSource) } : {}),
    bands: extracted.bands ?? { exceeding: 0.85, meeting: 0.65, approaching: 0.4 },
    strands: extracted.strands.map((s) => {
      const descriptors = {
        ...(clean(s.descriptors.exceeding) ? { exceeding: clean(s.descriptors.exceeding) } : {}),
        ...(clean(s.descriptors.meeting) ? { meeting: clean(s.descriptors.meeting) } : {}),
        ...(clean(s.descriptors.approaching) ? { approaching: clean(s.descriptors.approaching) } : {}),
        ...(clean(s.descriptors.beginning) ? { beginning: clean(s.descriptors.beginning) } : {}),
      };
      return {
        code: s.code.trim(),
        name: s.name.trim(),
        standards: s.standards.map((x) => x.trim()).filter(Boolean),
        parts: s.parts.map((p) => normalisePartRef(p)).filter(Boolean),
        ...(Object.keys(descriptors).length > 0 ? { descriptors } : {}),
      };
    }),
  };
  const overall = {
    ...(clean(extracted.overallDescriptors.exceeding) ? { exceeding: clean(extracted.overallDescriptors.exceeding) } : {}),
    ...(clean(extracted.overallDescriptors.meeting) ? { meeting: clean(extracted.overallDescriptors.meeting) } : {}),
    ...(clean(extracted.overallDescriptors.approaching) ? { approaching: clean(extracted.overallDescriptors.approaching) } : {}),
    ...(clean(extracted.overallDescriptors.beginning) ? { beginning: clean(extracted.overallDescriptors.beginning) } : {}),
  };
  if (Object.keys(overall).length > 0) rubric.overallDescriptors = overall;

  const statedStrandMarks: Record<string, number> = {};
  for (const s of extracted.strands) {
    if (typeof s.statedMarks === "number") statedStrandMarks[s.code.trim()] = s.statedMarks;
  }

  return {
    name: extracted.name.trim() || "Untitled assessment",
    testDate: extracted.testDate && /^\d{4}-\d{2}-\d{2}$/.test(extracted.testDate) ? extracted.testDate : null,
    statedTotalMarks: extracted.statedTotalMarks,
    items: extracted.items.map((it) => ({
      questionNumber: it.questionNumber,
      partLabel: it.partLabel.trim().toLowerCase().replace(/[()\s.]/g, ""),
      maxMarks: it.maxMarks,
      questionText: it.questionText.trim(),
      markschemeText: it.markschemeText.trim(),
    })),
    rubric,
    statedStrandMarks,
    readerNotes: extracted.readerNotes.map((n) => n.trim()).filter(Boolean),
  };
}

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------

/**
 * Everything that can be checked about a draft without a human: the parts
 * are distinct and carry a mark scheme, the marks add up to what the cover
 * prints, the rubric fits the parts, and each strand adds up to what the
 * rubric prints for it. Blocking findings stop a save; warnings ride along.
 *
 * The consistency checks are the point of this function. A transcription that
 * reads "2a" as "2d" produces a rubric that still parses, and the only thing
 * that catches it is strand B coming to 11 marks when the rubric prints 13.
 */
export function validateStandardsDraft(draft: StandardsAssessmentDraft): RubricFinding[] {
  const findings: RubricFinding[] = [];

  const seen = new Set<string>();
  for (const it of draft.items) {
    const key = normalisePartRef(`${it.questionNumber}${it.partLabel}`);
    const label = partRefLabel(`${it.questionNumber}${it.partLabel}`);
    if (seen.has(key)) findings.push({ severity: "block", message: `${label} appears twice in the parts list` });
    seen.add(key);
    if (it.maxMarks <= 0) findings.push({ severity: "block", message: `${label} is worth ${it.maxMarks} marks; every part needs at least 1` });
    if (!it.markschemeText) findings.push({ severity: "block", message: `${label} has no mark scheme text, so it cannot be graded` });
    if (!it.questionText) findings.push({ severity: "warn", message: `${label} has no question text; the marker sees only the mark scheme` });
  }

  const total = draft.items.reduce((s, it) => s + it.maxMarks, 0);
  if (typeof draft.statedTotalMarks === "number" && draft.statedTotalMarks !== total) {
    findings.push({
      severity: "warn",
      message: `The parts add up to ${total} marks but the paper says ${draft.statedTotalMarks}; a part's marks may have been misread`,
    });
  }

  const items = draft.items.map((it, i) => ({
    id: String(i),
    question_number: it.questionNumber,
    part_label: it.partLabel,
    max_marks: it.maxMarks,
  }));
  findings.push(...checkRubricAgainstItems(draft.rubric, items));

  for (const strand of draft.rubric.strands) {
    const stated = draft.statedStrandMarks[strand.code];
    if (typeof stated !== "number") continue;
    const byRef = new Map(items.map((i) => [normalisePartRef(`${i.question_number}${i.part_label}`), i]));
    const computed = strand.parts.reduce((s, p) => s + (byRef.get(normalisePartRef(p))?.max_marks ?? 0), 0);
    if (computed !== stated) {
      findings.push({
        severity: "warn",
        message: `Strand ${strand.code} adds up to ${computed} marks from its parts but the rubric says ${stated}; check which parts belong to it`,
      });
    }
  }

  return findings;
}

export function hasBlockingFindings(findings: RubricFinding[]): boolean {
  return findings.some((f) => f.severity === "block");
}

// -----------------------------------------------------------------------------
// Prompts
// -----------------------------------------------------------------------------

export function buildStandardsImportSystemPrompt(): string {
  return [
    "You are transcribing a Grade 9 mathematics assessment and its teacher marking rubric into structured data, so the platform can grade scanned student work part by part and report each student's performance level per strand.",
    "",
    "You are given two PDFs: the PAPER the students sat, and the TEACHER MARKING RUBRIC. Read both completely before answering. Transcribe; do not improve, reword, re-mark or add questions. Where the two documents disagree, the rubric decides the marks and the strands, the paper decides the question wording.",
    "",
    "PARTS. One entry per markable part, in the paper's order. A question with lettered parts is one entry per letter (partLabel \"a\", \"b\", ... lower-case, no brackets); a question with no parts is one entry with partLabel \"\". Use the mark value printed beside the part, not the question total. Do not include a bonus or ungraded item that the rubric gives no marks to.",
    "",
    "QUESTION TEXT. Self-contained: a student reading only this text, with no other context, must be able to attempt the part. Repeat a question's shared stem (the sequence, the scenario, the given expressions) at the start of each of its parts. Describe a table, diagram or figure in words precisely enough to reproduce it (list the table's values; say how many tiles each figure has and how they are arranged). Write mathematics in LaTeX between single dollars: $94 - 6n$, $\\frac{1}{2}t^2$. Keep the paper's own wording otherwise.",
    "",
    "MARK SCHEME TEXT. Start from the rubric's own line for the part (its \"a full-mark response shows ...\" or equivalent) and include the correct answer. For a part worth more than one mark, add what each mark is for, drawn from the rubric's wording and its level descriptors (\"2 marks: one for ..., one for ...\"), and any error the rubric names as a specific level (\"an off-by-one rule such as 88 - 6n earns 1\"). Say when a bare answer earns 0 (parts that say show, explain, justify). Say where follow-through applies. Do not invent marking rules the rubric does not support.",
    "",
    "STRANDS. One entry per strand as the rubric prints them, with its code (usually a letter), its name, every standard it lists (code and wording), every part it covers as a ref like \"2d\" or \"5\", the strand's printed mark total (statedMarks), and its four level descriptors verbatim. Every part belongs to exactly one strand. Copy the level bands as proportions if the rubric states them (85% is 0.85); otherwise null.",
    "",
    "COVER. name is the paper's printed title; testDate is the first day of the printed date as YYYY-MM-DD; timeAllowedMinutes, calculatorPermitted and statedTotalMarks come from the cover, null if absent.",
    "",
    "readerNotes: one line per thing you were unsure of (an unreadable mark value, a part the rubric does not mention, a figure you had to describe from context). Empty if none.",
    "",
    "Return only the JSON object.",
  ].join("\n");
}

export function buildStandardsImportUserPrompt(input: { paperFileName: string; rubricFileName: string }): string {
  return `The first PDF is the paper (${input.paperFileName}). The second PDF is the teacher marking rubric (${input.rubricFileName}). Transcribe them into the JSON object now.`;
}
