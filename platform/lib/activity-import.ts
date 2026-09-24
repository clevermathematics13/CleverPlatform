/**
 * activity-import.ts
 * -----------------------------------------------------------------------------
 * Turning a Math Medic worksheet and its answer key into a gradeable activity.
 *
 * An Exploration arrives as two PDFs from Math Medic: the blank worksheet the
 * students filled in, and an answer key, which is normally the SAME worksheet
 * with the answers written on it by hand and a QuickNotes box listing the
 * lesson's learning targets. Nothing in the assessment creator produced them,
 * and a new one arrives every lesson, so a hand-written seed per Exploration
 * is not a plan.
 *
 * This module is the read: a structured-output call that transcribes the two
 * documents into the shape lib/activity-rubric.ts and the tests/test_items
 * tables want, then a validator the teacher's edited draft is re-checked by
 * before it is saved.
 *
 * WHAT IT DOES DIFFERENTLY FROM lib/standards-import.ts, and why:
 *
 *   - It invents the marks. A Math Medic worksheet prints none, because it is
 *     not a mark-bearing paper. The reader assigns 1 or 2 per part on how many
 *     separable ideas the part contains, which is what lib/activity-rubric.ts
 *     turns into Got it / Almost / Not yet.
 *
 *   - There is therefore NO total to check the transcription against. The
 *     Standard Level importer leans on the printed strand totals to catch a
 *     part read as "2d" when it said "2a"; there is nothing here that can play
 *     that role, so the checks that remain are structural (every part carries a
 *     descriptor, every part is evidence of something, no part listed twice)
 *     and the teacher's eye does the rest. Say so on the importer page.
 *
 *   - A part may be evidence of more than one learning target, which a strand
 *     rubric forbids for its strands.
 * -----------------------------------------------------------------------------
 */

import { z } from "zod";
import {
  ActivityRubricSchema,
  DEFAULT_OUTCOME_BANDS,
  checkActivityRubricAgainstItems,
  normalisePartRef,
  partRefLabel,
  type ActivityRubric,
  type RubricFinding,
} from "./activity-rubric";

/**
 * The model that reads the PDFs. Same choice, for the same reason, as
 * STANDARDS_IMPORT_MODEL: one call per activity at the teacher's desk, and
 * the expensive failure is a misread answer key, not a slow read. Here the
 * key is usually HANDWRITTEN over the worksheet, which is the harder read of
 * the two and the reason this is not a cheaper model.
 */
export const ACTIVITY_IMPORT_MODEL = "claude-opus-5";

/**
 * The marks a part may carry. One idea or two -- see rule 7 of the marking
 * policy. Anything else means the reader has split the part wrongly.
 */
export const MAX_MARKS_PER_PART = 2;

// -----------------------------------------------------------------------------
// What the model returns
// -----------------------------------------------------------------------------
//
// Every field is required (nullable where it may be unknown) rather than
// optional: structured output wants a closed schema, and a field the model
// may leave out is a field it will leave out.

const ExtractedActivityItemSchema = z.object({
  questionNumber: z.number().int().min(1),
  /** "a", "b", "c" ... or "" for a question with no parts. Lower-case letters only. */
  partLabel: z.string(),
  /** 1 for one idea, 2 for two separable ideas. Nothing else. */
  maxMarks: z.number().int().min(1).max(MAX_MARKS_PER_PART),
  /** For a lettered part: the question's shared context as printed (the scenario, the given formula, the sequence), identical on every part of that question. Null for a question with no parts, or with no shared context. Maths in $...$ LaTeX. */
  stemText: z.string().nullable(),
  /** The part's own wording as printed. Together with stemText it must be self-contained. Maths in $...$ LaTeX. */
  questionText: z.string(),
  /** What having the idea looks like, from the key: the answer, and for a 2-mark part what each mark is for. */
  markschemeText: z.string(),
});

const ExtractedLearningTargetSchema = z.object({
  /** As the lesson prints it: "LT1", "LT #2" -> "LT2". */
  code: z.string(),
  name: z.string(),
  /** The QuickNotes elaboration under the target, or null. */
  note: z.string().nullable(),
  /** Part refs as the worksheet numbers them: "2d", "5". A part may appear under more than one target. */
  parts: z.array(z.string()),
});

export const ExtractedActivitySchema = z.object({
  /** The activity's title as printed, e.g. "Exploration 1.1 - Equations that Describe Patterns". */
  name: z.string(),
  /** The lesson number as printed, e.g. "1.1", or null. */
  lesson: z.string().nullable(),
  /** "exploration" for a pre-lesson Exploration, "homework" for anything sat after the lesson. */
  kind: z.enum(["exploration", "homework"]),
  items: z.array(ExtractedActivityItemSchema),
  targets: z.array(ExtractedLearningTargetSchema),
  /** True when the targets were read off a QuickNotes box; false when the reader proposed them. */
  targetsFromLesson: z.boolean(),
  /** Where the key came from, for the record: its printed title. */
  keySource: z.string().nullable(),
  /** Anything the reader was unsure about, one line each, for the teacher. */
  readerNotes: z.array(z.string()),
});

export type ExtractedActivity = z.infer<typeof ExtractedActivitySchema>;

// -----------------------------------------------------------------------------
// What gets saved
// -----------------------------------------------------------------------------

export const ActivityDraftItemSchema = z.object({
  questionNumber: z.number().int().min(1),
  partLabel: z.string().trim().max(8),
  maxMarks: z.number().int().min(0).max(50),
  /** Defaulted rather than required so a draft saved before the stem existed still parses. */
  stemText: z.string().trim().nullable().default(null),
  questionText: z.string().trim(),
  markschemeText: z.string().trim(),
});

export type ActivityDraftItem = z.infer<typeof ActivityDraftItemSchema>;

/** The reviewed, editable draft the importer page holds and the save route accepts. */
export const ActivityDraftSchema = z.object({
  name: z.string().trim().min(1).max(200),
  /** YYYY-MM-DD or null. When the class did it, which the worksheet never prints. */
  activityDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  items: z.array(ActivityDraftItemSchema).min(1),
  rubric: ActivityRubricSchema,
  /** False when the reader proposed the learning targets rather than reading them. */
  targetsFromLesson: z.boolean().default(true),
  readerNotes: z.array(z.string()).default([]),
});

export type ActivityDraft = z.infer<typeof ActivityDraftSchema>;

function clean(s: string | null | undefined): string | undefined {
  const t = (s ?? "").trim();
  return t.length > 0 ? t : undefined;
}

/** "LT #2" -> "LT2", "  lt1 " -> "LT1". The rubric caps a code at 8 characters. */
export function normaliseTargetCode(code: string): string {
  return code.replace(/[\s#.]/g, "").toUpperCase().slice(0, 8);
}

/**
 * The model's transcription as a draft the teacher can edit and save.
 *
 * Normalises what the rubric schema is strict about (lower-case part labels,
 * tidied target codes, trimmed strings) and fills in the platform's default
 * outcome bands, which no Math Medic document states. Does NOT validate --
 * that is validateActivityDraft, run on this and again on whatever the
 * teacher saves.
 */
export function toActivityDraft(
  extracted: ExtractedActivity,
  opts: { activityDate?: string | null } = {}
): ActivityDraft {
  const rubric: ActivityRubric = {
    version: 1,
    kind: extracted.kind,
    ...(clean(extracted.keySource) ? { source: clean(extracted.keySource) } : {}),
    ...(clean(extracted.lesson) ? { lesson: clean(extracted.lesson) } : {}),
    bands: DEFAULT_OUTCOME_BANDS,
    targets: extracted.targets.map((t) => ({
      code: normaliseTargetCode(t.code),
      name: t.name.trim(),
      ...(clean(t.note) ? { note: clean(t.note) } : {}),
      // De-duplicate within a target: the same part under one target twice is
      // a transcription slip, and the schema rejects it outright.
      parts: [...new Set(t.parts.map((p) => normalisePartRef(p)).filter(Boolean))],
    })),
  };

  const date = opts.activityDate ?? null;

  return {
    name: extracted.name.trim() || "Untitled activity",
    activityDate: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    items: extracted.items.map((it) => ({
      questionNumber: it.questionNumber,
      partLabel: it.partLabel.trim().toLowerCase().replace(/[()\s.]/g, ""),
      maxMarks: it.maxMarks,
      stemText: clean(it.stemText) ?? null,
      questionText: it.questionText.trim(),
      markschemeText: it.markschemeText.trim(),
    })),
    rubric,
    targetsFromLesson: extracted.targetsFromLesson,
    readerNotes: extracted.readerNotes.map((n) => n.trim()).filter(Boolean),
  };
}

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------

/**
 * Everything that can be checked about a draft without a human.
 *
 * Weaker than validateStandardsDraft on purpose, because there is nothing to
 * be strong with: a worksheet with no printed marks and a key with no printed
 * totals gives no arithmetic that a misreading would break. What is left is
 * structural, and the importer page says plainly that the teacher's eye is
 * the real check.
 */
export function validateActivityDraft(draft: ActivityDraft): RubricFinding[] {
  const findings: RubricFinding[] = [];

  const seen = new Set<string>();
  for (const it of draft.items) {
    const key = normalisePartRef(`${it.questionNumber}${it.partLabel}`);
    const label = partRefLabel(`${it.questionNumber}${it.partLabel}`);
    if (seen.has(key)) findings.push({ severity: "block", message: `${label} appears twice in the parts list` });
    seen.add(key);
    if (it.maxMarks <= 0) {
      findings.push({ severity: "block", message: `${label} is worth ${it.maxMarks} marks; every part needs at least 1` });
    }
    if (it.maxMarks > MAX_MARKS_PER_PART) {
      findings.push({
        severity: "warn",
        message: `${label} is worth ${it.maxMarks} marks. An activity part is 1 idea or 2; more than that usually means the part should be split, and it makes Almost cover too wide a range`,
      });
    }
    if (!it.markschemeText) {
      findings.push({ severity: "block", message: `${label} has no answer from the key, so it cannot be marked` });
    }
    if (!it.questionText) {
      findings.push({ severity: "warn", message: `${label} has no question text; the marker sees only the answer` });
    }
  }

  const items = draft.items.map((it, i) => ({
    id: String(i),
    question_number: it.questionNumber,
    part_label: it.partLabel,
    max_marks: it.maxMarks,
  }));
  findings.push(...checkActivityRubricAgainstItems(draft.rubric, items));

  if (!draft.targetsFromLesson) {
    findings.push({
      severity: "warn",
      message:
        "The lesson printed no learning targets, so these were proposed from the mathematics. Check they are the ones you are teaching.",
    });
  }

  return findings;
}

export function hasBlockingFindings(findings: RubricFinding[]): boolean {
  return findings.some((f) => f.severity === "block");
}

// -----------------------------------------------------------------------------
// Prompts
// -----------------------------------------------------------------------------

export function buildActivityImportSystemPrompt(): string {
  return [
    "You are transcribing a Math Medic mathematics activity and its answer key into structured data, so the platform can mark scanned student work part by part and report whether each student has each LEARNING TARGET yet.",
    "",
    "You are given two PDFs: the blank WORKSHEET the students filled in, and the ANSWER KEY. The key is usually the same worksheet with the answers written on it BY HAND, often in more than one colour, sometimes with arrows and margin notes. Read both completely before answering. Where they disagree, the worksheet decides the question wording and the key decides the answer.",
    "",
    "THIS IS NOT AN EXAM. It carries no marks and no total, and it is usually sat BEFORE the lesson it introduces, so the students have not been taught the material. Transcribe; do not improve, reword or add questions.",
    "",
    "PARTS. One entry per answerable question, in the worksheet's order. A question with lettered parts is one entry per letter (partLabel \"a\", \"b\", ... lower-case, no brackets); a question with no parts is one entry with partLabel \"\". If the worksheet restarts its numbering on a later page or section (a Check Your Understanding block that begins again at 1), CONTINUE the numbering instead of repeating it -- carry on from the highest number used so far -- and say which printed question it is at the start of that part's questionText. Two parts may not share a (questionNumber, partLabel).",
    "",
    "MARKS. The worksheet prints none; you assign them. A part is worth 2 if it contains two separable ideas that a student could have one of without the other -- two quantities asked for, two patterns to notice, a substitution and then a value, a relationship and then the equation for it. It is worth 1 if it contains one. Never anything else. For a 2-mark part, markschemeText must say what each of the two marks is for.",
    "",
    "STEM AND QUESTION TEXT. A student reading stemText and questionText together, with no other context, must be able to attempt the part. Put the shared context (the scenario, the given formula, the sequence) in stemText, word for word and identical on every one of its lettered parts; put only the part's own wording in questionText. A demand the part's mark depends on (\"show your work\", \"explain\") belongs in that part's questionText, never only in the stem. A question with no parts, or with no shared context, has stemText null and everything in questionText. Describe a table, diagram or figure in words precisely enough to reproduce it -- for a table the students fill in, give its columns and its row labels and say which cells are blank. Write mathematics in LaTeX between single dollars: $c = 8t$, $\\frac{5}{9}(F - 32)$. Keep the worksheet's own wording otherwise.",
    "",
    "MARK SCHEME TEXT. Read the answer off the key, including anything handwritten in the margin. State the answer plainly. List the equivalent forms that must also be accepted -- an Exploration routinely asks for a relationship without fixing how to write it, so $c = 8t$, $8t = c$ and $t = c/8$ are one answer, and a student who writes any of them has the idea. Where the key shows working, say which part of it is the idea being looked for. Where a wrong route is predictable, name it and say it earns nothing. Do not invent marking rules the key does not support, and do not require working to be shown unless the question itself asks the student to explain, describe or show how they know.",
    "",
    "LEARNING TARGETS. Math Medic lessons print these in a QuickNotes box on the key, usually as \"LT #1\", \"LT #2\", \"LT #3\". Transcribe them: the code (as \"LT1\", \"LT2\"), the target in the lesson's own words as name, and any elaboration under it as note. Then list, for each target, every part that is evidence of it. A part MAY appear under more than one target, and should when it genuinely shows both. Every part should be evidence of at least one target. Set targetsFromLesson true when you read them off the document. If the documents print no targets at all, propose two to four from the mathematics the activity actually covers and set targetsFromLesson FALSE.",
    "",
    "kind is \"exploration\" for a Math Medic Exploration (a discovery activity, usually page 1, sat before the lesson) and \"homework\" for a practice set sat afterwards. name is the printed title; lesson is the printed lesson number like \"1.1\"; keySource is the key's own printed title.",
    "",
    "readerNotes: one line per thing you were unsure of (handwriting you could not read, an answer the key leaves blank, a figure you had to describe from context, a part whose learning target was not obvious). Empty if none.",
    "",
    "Return only the JSON object.",
  ].join("\n");
}

export function buildActivityImportUserPrompt(input: { worksheetFileName: string; keyFileName: string }): string {
  return `The first PDF is the blank worksheet (${input.worksheetFileName}). The second PDF is the answer key (${input.keyFileName}), whose answers are probably handwritten. Transcribe them into the JSON object now.`;
}
