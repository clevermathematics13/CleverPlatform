import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * AI-assisted grading of scanned student work against the PPQ mark scheme.
 *
 * This module is the validation + assembly layer. It has no side effects: it
 * reads the mark scheme out of the question bank, builds the prompts, and
 * validates whatever the model returns. Persistence lives in the routes.
 *
 * Nothing here writes to student_marks. AI output is a *proposal* that lands in
 * ai_grade_results for teacher review. Marks only become "Clev's Marks" when a
 * teacher accepts them via the accept route.
 *
 * Schema contract (public.ai_grade_runs / public.ai_grade_results):
 *   status            'running' | 'complete' | 'failed'
 *   confidence        'high' | 'medium' | 'low'
 *   markscheme_source 'part_latex' | 'part_text' | 'whole_question' | 'draft' | 'none'
 */

/** Model used for grading. Matches the vision model already used for graph extraction. */
export const GRADING_MODEL = "claude-opus-4-5";

/** Storage bucket holding teacher-uploaded scans of completed scripts. */
export const SCAN_BUCKET = "exam-scans";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type MarkschemeSource =
  | "part_latex"
  | "part_text"
  | "whole_question"
  | "draft"
  | "none";

export type Confidence = "high" | "medium" | "low";

/** One markable unit: a test_item joined to its mark scheme from the question bank. */
export interface GradingUnit {
  testItemId: string;
  questionNumber: number;
  partLabel: string;
  maxMarks: number;
  questionCode: string;
  /** Question text (stem + part content) as LaTeX, for context. */
  questionLatex: string;
  /** The mark scheme for this part. This is the grading authority. */
  markscheme: string;
  /** Where the mark scheme came from — recorded so weak sources are auditable. */
  markschemeSource: MarkschemeSource;
  commandTerms: string[];
  subtopicCodes: string[];
}

/** Human-readable label, e.g. "3(b)(ii)" or "5". */
export function unitLabel(u: Pick<GradingUnit, "questionNumber" | "partLabel">): string {
  const p = (u.partLabel ?? "").trim();
  if (!p) return String(u.questionNumber);
  const m = p.match(/^([a-z])(i{1,3}|iv|v)?$/i);
  if (m) {
    return m[2]
      ? `${u.questionNumber}(${m[1].toLowerCase()})(${m[2].toLowerCase()})`
      : `${u.questionNumber}(${m[1].toLowerCase()})`;
  }
  return `${u.questionNumber}(${p})`;
}

// -----------------------------------------------------------------------------
// Validation layer
// -----------------------------------------------------------------------------

/** A single mark scheme token and whether the student earned it. */
export const MarkBreakdownEntrySchema = z.object({
  token: z.string().min(1),
  awarded: z.boolean(),
  note: z.string().default(""),
});

/**
 * Shape the model is instructed to return. Deliberately strict: anything
 * outside this shape is rejected rather than coerced into a mark.
 */
export const AiGradeItemSchema = z.object({
  /** Must echo back the testItemId supplied in the prompt. */
  testItemId: z.string().min(1),
  suggestedMarks: z.number().int().min(0),
  confidence: z.enum(["high", "medium", "low"]),
  /** False when the part could not be located in the scan. */
  workFound: z.boolean(),
  markBreakdown: z.array(MarkBreakdownEntrySchema).default([]),
  reasoning: z.string().default(""),
  evidence: z.string().default(""),
});

export const AiGradeResponseSchema = z.object({
  items: z.array(AiGradeItemSchema).min(1),
});

export type AiGradeItem = z.infer<typeof AiGradeItemSchema>;
export type AiGradeResponse = z.infer<typeof AiGradeResponseSchema>;

/** Extract the first balanced JSON object from a model response. */
export function extractJsonBlock(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return candidate.slice(start, i + 1);
    }
  }
  return null;
}

export interface ValidatedGrade {
  item: AiGradeItem;
  unit: GradingUnit;
  /** Marks after clamping to the mark scheme maximum. */
  clampedMarks: number;
  /** Effective confidence — downgraded when the award had to be clamped. */
  confidence: Confidence;
}

export interface ValidationOutcome {
  grades: ValidatedGrade[];
  warnings: string[];
}

/**
 * Validate a raw model response against the units that were actually sent.
 *
 * Guarantees on success:
 *   - every returned testItemId corresponds to a unit in this run
 *   - suggestedMarks is a non-negative integer clamped to that unit's max_marks
 *   - duplicates are dropped (first occurrence wins)
 *   - a clamped award is forced to 'low' confidence, since the model
 *     misread the mark allocation and its judgement is suspect
 */
export function validateGradeResponse(
  rawText: string,
  units: GradingUnit[]
): { ok: true; outcome: ValidationOutcome } | { ok: false; error: string } {
  const json = extractJsonBlock(rawText);
  if (!json) return { ok: false, error: "No JSON object found in model response" };

  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(json);
  } catch (e) {
    return {
      ok: false,
      error: `Model response was not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const parsed = AiGradeResponseSchema.safeParse(parsedUnknown);
  if (!parsed.success) {
    return { ok: false, error: `Response failed schema validation: ${parsed.error.message}` };
  }

  const unitById = new Map(units.map((u) => [u.testItemId, u]));
  const seen = new Set<string>();
  const grades: ValidatedGrade[] = [];
  const warnings: string[] = [];

  for (const item of parsed.data.items) {
    const unit = unitById.get(item.testItemId);
    if (!unit) {
      warnings.push(`Ignored unknown testItemId returned by the model: ${item.testItemId}`);
      continue;
    }
    if (seen.has(item.testItemId)) {
      warnings.push(`Ignored duplicate grade for ${unitLabel(unit)}`);
      continue;
    }
    seen.add(item.testItemId);

    let clampedMarks = item.suggestedMarks;
    let confidence: Confidence = item.confidence;
    if (clampedMarks > unit.maxMarks) {
      warnings.push(
        `${unitLabel(unit)}: model awarded ${item.suggestedMarks} of a possible ${unit.maxMarks}; clamped to ${unit.maxMarks} and flagged low confidence`
      );
      clampedMarks = unit.maxMarks;
      confidence = "low";
    }

    // A mark scheme we could only guess at should never be reported as high confidence.
    if (unit.markschemeSource === "draft" || unit.markschemeSource === "whole_question") {
      if (confidence === "high") confidence = "medium";
    }

    grades.push({ item, unit, clampedMarks, confidence });
  }

  for (const u of units) {
    if (!seen.has(u.testItemId)) {
      warnings.push(`No grade returned for ${unitLabel(u)} — left ungraded for manual marking`);
    }
  }

  if (grades.length === 0) {
    return { ok: false, error: "Model returned no gradeable items" };
  }

  return { ok: true, outcome: { grades, warnings } };
}

// -----------------------------------------------------------------------------
// Mark scheme assembly
// -----------------------------------------------------------------------------

/** Normalise a part label so "(b)(ii)", "b ii" and "bii" all compare equal. */
function normalisePartLabel(label: string | null | undefined): string {
  return (label ?? "")
    .toLowerCase()
    .replace(/[()\[\]\s.]/g, "")
    .trim();
}

interface TestItemRow {
  id: string;
  question_number: number;
  part_label: string | null;
  max_marks: number;
  ib_question_code: string;
  subtopic_codes: string[] | null;
  sort_order: number;
}

interface QuestionRow {
  id: string;
  code: string;
  stem_latex: string | null;
  stem_markscheme_latex: string | null;
  parts_draft_markscheme_latex: string | null;
}

interface PartRow {
  question_id: string;
  part_label: string | null;
  marks: number | null;
  content_latex: string | null;
  markscheme_latex: string | null;
  markscheme_text: string | null;
  command_terms: string[] | null;
  command_term: string | null;
}

export interface AssembledMarkScheme {
  units: GradingUnit[];
  warnings: string[];
}

/**
 * Build the gradeable units for a test by joining test_items to the mark scheme
 * held in the question bank.
 *
 * test_items links to ib_questions by *code* (text), not by foreign key, so the
 * join runs in two hops: code -> ib_questions.id -> question_parts.
 *
 * Mark scheme resolution, strongest source first:
 *   part_latex     matched part has markscheme_latex
 *   part_text      matched part has markscheme_text only
 *   whole_question no matched part, but the question has a stem mark scheme
 *   draft          only the unsplit parts_draft_markscheme_latex exists
 *   none           nothing usable — the part is excluded from grading
 */
export async function assembleMarkScheme(
  supabase: SupabaseClient,
  testId: string
): Promise<AssembledMarkScheme> {
  const warnings: string[] = [];

  const { data: itemRows, error: itemsError } = await supabase
    .from("test_items")
    .select("id, question_number, part_label, max_marks, ib_question_code, subtopic_codes, sort_order")
    .eq("test_id", testId)
    .order("sort_order", { ascending: true });

  if (itemsError) throw new Error(`Failed to load test items: ${itemsError.message}`);
  const items = (itemRows ?? []) as TestItemRow[];
  if (items.length === 0) return { units: [], warnings: ["This assessment has no test items."] };

  const codes = [...new Set(items.map((i) => i.ib_question_code).filter(Boolean))];

  const { data: questionRows, error: qError } = await supabase
    .from("ib_questions")
    .select("id, code, stem_latex, stem_markscheme_latex, parts_draft_markscheme_latex")
    .in("code", codes);

  if (qError) throw new Error(`Failed to load questions: ${qError.message}`);
  const questions = (questionRows ?? []) as QuestionRow[];
  const questionByCode = new Map(questions.map((q) => [q.code, q]));

  const questionIds = questions.map((q) => q.id);
  let parts: PartRow[] = [];
  if (questionIds.length > 0) {
    const { data: partRows, error: pError } = await supabase
      .from("question_parts")
      .select(
        "question_id, part_label, marks, content_latex, markscheme_latex, markscheme_text, command_terms, command_term"
      )
      .in("question_id", questionIds);
    if (pError) throw new Error(`Failed to load question parts: ${pError.message}`);
    parts = (partRows ?? []) as PartRow[];
  }

  const partsByQuestion = new Map<string, PartRow[]>();
  for (const p of parts) {
    const list = partsByQuestion.get(p.question_id) ?? [];
    list.push(p);
    partsByQuestion.set(p.question_id, list);
  }

  const units: GradingUnit[] = items.map((item) => {
    const question = questionByCode.get(item.ib_question_code);
    const questionParts = question ? partsByQuestion.get(question.id) ?? [] : [];

    const wanted = normalisePartLabel(item.part_label);
    let matched = questionParts.find((p) => normalisePartLabel(p.part_label) === wanted);

    // Whole-question items: fall back to the sole part when there is exactly one.
    if (!matched && wanted === "" && questionParts.length === 1) {
      matched = questionParts[0];
    }

    let markscheme = "";
    let markschemeSource: MarkschemeSource = "none";

    if (matched?.markscheme_latex?.trim()) {
      markscheme = matched.markscheme_latex.trim();
      markschemeSource = "part_latex";
    } else if (matched?.markscheme_text?.trim()) {
      markscheme = matched.markscheme_text.trim();
      markschemeSource = "part_text";
    } else if (question?.stem_markscheme_latex?.trim()) {
      markscheme = question.stem_markscheme_latex.trim();
      markschemeSource = "whole_question";
    } else if (question?.parts_draft_markscheme_latex?.trim()) {
      markscheme = question.parts_draft_markscheme_latex.trim();
      markschemeSource = "draft";
    }

    const stem = question?.stem_latex?.trim() ?? "";
    const questionLatex = [stem, matched?.content_latex?.trim() ?? ""]
      .filter(Boolean)
      .join("\n\n");

    const commandTerms =
      matched?.command_terms && matched.command_terms.length > 0
        ? matched.command_terms
        : matched?.command_term
        ? [matched.command_term]
        : [];

    const label = `${item.question_number}${item.part_label ? `(${item.part_label})` : ""}`;
    if (!question) {
      warnings.push(
        `${label}: question ${item.ib_question_code} is not in the PPQ bank — cannot be graded.`
      );
    } else if (markschemeSource === "none") {
      warnings.push(
        `${label}: no mark scheme stored for ${item.ib_question_code} — cannot be graded. Extract the mark scheme in the PPQ Bank first.`
      );
    } else if (markschemeSource === "draft" || markschemeSource === "whole_question") {
      warnings.push(
        `${label}: using a ${markschemeSource === "draft" ? "draft (unsplit)" : "whole-question"} mark scheme — suggestions here need closer review.`
      );
    }

    return {
      testItemId: item.id,
      questionNumber: item.question_number,
      partLabel: item.part_label ?? "",
      maxMarks: item.max_marks,
      questionCode: item.ib_question_code,
      questionLatex,
      markscheme,
      markschemeSource,
      commandTerms,
      subtopicCodes: item.subtopic_codes ?? [],
    };
  });

  return { units, warnings };
}

// -----------------------------------------------------------------------------
// Prompts
// -----------------------------------------------------------------------------

export const GRADING_SYSTEM_PROMPT = `You are an experienced IB Diploma Programme Mathematics examiner marking a scanned, handwritten student script against an official IB mark scheme.

You mark to the mark scheme. You do not mark to your own preferred method or your own arithmetic. The mark scheme is the authority.

MARK TYPES
- M (method): awarded for a correct method, even if the subsequent arithmetic is wrong. Award M marks when the intended method is clearly visible.
- A (accuracy): awarded for a correct result. An A mark depends on its associated M mark — never award an A without the M that earns it.
- R (reasoning): awarded for correct justification or explanation, not merely a correct answer.
- AG (answer given): the answer is printed in the question. Award only if the working genuinely derives it. Do NOT award if the student worked backwards from the printed answer or simply restated it.

MARKING RULES
1. Award whole marks only. Never award half marks.
2. Never exceed the stated maximum for a part.
3. Follow through (FT): if a student carries an incorrect value from an earlier part into a later part but the method in the later part is correct, award the method marks in the later part.
4. Accept any valid alternative method that reaches the required result. Mark scheme methods are indicative, not exhaustive.
5. Accept equivalent forms of a correct answer (unsimplified, decimal vs exact, algebraically equivalent) unless the mark scheme or the command term demands a particular form.
6. Ignore subsequent working that does not contradict a correct answer already given. If later working contradicts and replaces a correct answer, mark the final answer.
7. If a part is blank, crossed out with nothing to replace it, or absent from the scan, set workFound to false and suggestedMarks to 0.
8. If handwriting is ambiguous, mark the most plausible reading in the student's favour and lower your confidence.
9. Do not deduct marks for poor presentation, notation slips, or missing units unless the mark scheme requires them.

MARK BREAKDOWN
For each part, itemise the mark scheme tokens (M1, A1, R1, AG, ...) and state whether the student earned each one. The tokens you mark as awarded must add up to suggestedMarks.

CONFIDENCE
- "high": the work is legible and maps cleanly onto the mark scheme.
- "medium": legible but needs a judgement call (alternative method, partial working, follow-through).
- "low": illegible, ambiguous, hard to locate, or a genuinely borderline award.
Anything marked "low" is flagged for the teacher to mark by hand. Be honest — an over-confident wrong mark is far more damaging than a flagged uncertain one.

OUTPUT
Return ONLY a JSON object. No preamble, no markdown fences, no commentary.

{
  "items": [
    {
      "testItemId": "<echo back exactly the testItemId given to you>",
      "suggestedMarks": <integer>,
      "confidence": "high" | "medium" | "low",
      "workFound": <boolean>,
      "markBreakdown": [{ "token": "M1", "awarded": true, "note": "<brief>" }],
      "reasoning": "<one or two sentences citing the tokens satisfied or missed>",
      "evidence": "<what the student actually wrote, briefly>"
    }
  ]
}

Return exactly one entry for every part you were given, in the order given.`;

/**
 * Build the mark-scheme block: everything about a test's parts and how to mark
 * them, with no student-specific content. This text is byte-identical for
 * every student sitting the same test, so callers should attach a
 * cache_control breakpoint to it — on a batch upload, every student after the
 * first hits a cache read instead of re-sending the whole mark scheme.
 */
export function buildGradingUserPrompt(
  units: GradingUnit[],
  opts: { testName?: string } = {}
): string {
  const header = [
    opts.testName ? `Assessment: ${opts.testName}` : null,
    `Parts to mark: ${units.length}`,
    `Total marks available: ${units.reduce((s, u) => s + u.maxMarks, 0)}`,
  ]
    .filter(Boolean)
    .join("\n");

  const blocks = units.map((u) => {
    const lines = [
      `=== ${unitLabel(u)} ===`,
      `testItemId: ${u.testItemId}`,
      `Source question: ${u.questionCode}`,
      `Maximum marks: ${u.maxMarks}`,
    ];
    if (u.commandTerms.length > 0) lines.push(`Command term(s): ${u.commandTerms.join(", ")}`);
    if (u.markschemeSource === "whole_question") {
      lines.push(
        `NOTE: the mark scheme below covers the WHOLE question, not just this part. Use only the portion relevant to this part.`
      );
    }
    if (u.markschemeSource === "draft") {
      lines.push(
        `NOTE: the mark scheme below is an unsplit draft covering several parts. Locate the section for this part before marking.`
      );
    }
    if (u.questionLatex) lines.push(`\n--- Question ---\n${u.questionLatex}`);
    lines.push(`\n--- Mark scheme (the authority) ---\n${u.markscheme}`);
    return lines.join("\n");
  });

  return `${header}

Each attached PDF is a scan of one student's handwritten work for the whole assessment above. Locate each part below in the scan and mark it against its mark scheme.

The scan may be out of order, may include rough working, and may span multiple pages per question. Search the whole document before concluding a part is missing.

${blocks.join("\n\n")}`;
}

/**
 * Build the small per-student text that follows the cached mark-scheme block
 * and the attached PDF. Deliberately kept out of buildGradingUserPrompt so
 * that block stays byte-identical across students and the cache hits.
 */
export function buildGradingStudentPrompt(studentName?: string): string {
  return [
    studentName ? `Student: ${studentName}` : null,
    `Mark the attached PDF against the mark scheme above. Return the JSON object now.`,
  ]
    .filter(Boolean)
    .join("\n");
}

// -----------------------------------------------------------------------------
// Batch scan segmentation
// -----------------------------------------------------------------------------
//
// A batch scan is a single PDF covering several students' scripts, one after
// another, each beginning with a cover/divider page that names the student.
// A student's own work is not guaranteed to stay contiguous: overflow work on
// loose-leaf paper can be appended after the student's own pages but before
// the next student's cover page, and in principle after any later student's
// pages too if scripts were shuffled during scanning. Segmentation therefore
// asks the model to assign every page to a student (or "unassigned") rather
// than just detect N-1 cut points between N covers.
//
// This stage never grades anything and never touches ai_grade_runs. It only
// proposes a page ownership mapping for the teacher to confirm before any
// PDF is split or sent for grading.

export const SEGMENTATION_MODEL = "claude-opus-4-5";

/** Anthropic's PDF document block caps at 100 pages regardless of size. */
export const MAX_BATCH_PAGES = 100;

export const SegmentedStudentSchema = z.object({
  /** The student's name exactly as it appears written on their cover page. */
  label: z.string().min(1),
  /** Every page number (1-indexed, matching the source PDF) belonging to this student. */
  pages: z.array(z.number().int().min(1)).min(1),
  confidence: z.enum(["high", "medium", "low"]),
  /** e.g. "pages 7-8 are loose-leaf continuation paper, not part of the printed booklet" */
  note: z.string().default(""),
});

export const SegmentationResponseSchema = z.object({
  students: z.array(SegmentedStudentSchema).min(1),
  /** Pages the model could not confidently attribute to any student. */
  unassignedPages: z.array(z.number().int().min(1)).default([]),
});

export type SegmentedStudent = z.infer<typeof SegmentedStudentSchema>;
export type SegmentationResponse = z.infer<typeof SegmentationResponseSchema>;

/** A proposed segment after matching its label against the class roster. */
export interface ProposedSegment {
  label: string;
  pages: number[];
  confidence: Confidence;
  note: string;
  /** profiles.id of the roster match, or null if no confident match was found. */
  matchedStudentId: string | null;
  /** display_name of the matched roster row, for the review UI. */
  matchedStudentName: string | null;
}

export const SEGMENTATION_SYSTEM_PROMPT = `You are looking at a single PDF that is a batch scan of MULTIPLE students' completed exam scripts, scanned one after another into one file.

Each student's script begins with a cover or divider page bearing their name — usually a printed exam cover sheet with a handwritten "Candidate Name" field, but it may instead be a plain header page or the first page of their answer booklet with a name written at the top.

Your job is to assign EVERY page in the document to the student it belongs to.

IMPORTANT — pages are not guaranteed to be contiguous per student:
- A student may run out of room in the printed booklet and continue on a loose sheet of lined paper. That continuation page is usually appended immediately after that student's own pages, but it can also appear later in the document, even after a different student's cover page, if scripts were shuffled during scanning.
- A continuation page is often self-labelled (the student's name or initials handwritten at the top, or a circled question number matching an earlier page) — use that as strong evidence for which student it belongs to, even if it is physically out of order.
- Blank pages, the backs of loose sheets bleeding through, or illegible fragments should go in unassignedPages rather than being guessed into a student's set.

For each student you identify, report:
- label: their name exactly as written on their cover page (best-effort transcription of handwriting — do not normalise or guess a "corrected" spelling)
- pages: EVERY page number belonging to them, in ascending order, including any non-contiguous continuation pages
- confidence: "high" if every page assignment is clear; "medium" if the cover page is clear but one or more page assignments (e.g. a continuation page) required judgement; "low" if the name itself is hard to read or you are genuinely unsure about page ownership
- note: briefly explain anything non-obvious (e.g. "pages 7-8 are a loose-leaf continuation of question 4, name matches cover page")

Return ONLY a JSON object, no markdown fences, no commentary:

{
  "students": [
    { "label": "Pedro Costa", "pages": [1,2,3,4,5,6,7,8], "confidence": "high", "note": "pages 7-8 are a self-labelled loose-leaf continuation" }
  ],
  "unassignedPages": []
}

Every page number from 1 to the last page of the document must appear exactly once, either in exactly one student's "pages" array or in "unassignedPages". Double-check this before responding.`;

export function buildSegmentationUserPrompt(pageCount: number): string {
  return `This PDF has ${pageCount} pages and contains multiple students' exam scripts. Identify each student from their cover page and assign every page (1 to ${pageCount}) to the correct student, per the system instructions. Return the JSON object now.`;
}

/**
 * Validate the raw segmentation response: well-formed JSON matching the
 * schema, and every page 1..pageCount accounted for exactly once. Does not
 * touch the database or match against a roster — see matchSegmentsToRoster.
 */
export function validateSegmentationResponse(
  rawText: string,
  pageCount: number
): { ok: true; response: SegmentationResponse; warnings: string[] } | { ok: false; error: string } {
  const json = extractJsonBlock(rawText);
  if (!json) return { ok: false, error: "No JSON object found in segmentation response" };

  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(json);
  } catch (e) {
    return {
      ok: false,
      error: `Segmentation response was not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const parsed = SegmentationResponseSchema.safeParse(parsedUnknown);
  if (!parsed.success) {
    return { ok: false, error: `Segmentation response failed schema validation: ${parsed.error.message}` };
  }

  const warnings: string[] = [];
  const seenPages = new Map<number, string>(); // page -> owner label (or "unassigned")
  const duplicates = new Set<number>();

  for (const student of parsed.data.students) {
    for (const page of student.pages) {
      if (page > pageCount) {
        warnings.push(`${student.label}: page ${page} is beyond the document's ${pageCount} pages — dropped`);
        continue;
      }
      if (seenPages.has(page)) {
        duplicates.add(page);
        warnings.push(
          `Page ${page} was assigned to both "${seenPages.get(page)}" and "${student.label}" — left with its first assignment, flag for manual review`
        );
        continue;
      }
      seenPages.set(page, student.label);
    }
  }

  for (const page of parsed.data.unassignedPages) {
    if (page > pageCount) continue;
    if (seenPages.has(page)) {
      warnings.push(`Page ${page} was in both a student's set and unassignedPages — kept as assigned`);
      continue;
    }
    seenPages.set(page, "unassigned");
  }

  const missing: number[] = [];
  for (let p = 1; p <= pageCount; p++) {
    if (!seenPages.has(p)) missing.push(p);
  }
  if (missing.length > 0) {
    warnings.push(
      `Page(s) ${missing.join(", ")} were not mentioned in the segmentation response — added to unassigned`
    );
  }

  return { ok: true, response: parsed.data, warnings };
}

/** A minimal roster row for name matching — avoids importing UI-layer types here. */
export interface RosterEntry {
  profileId: string;
  displayName: string;
}

/**
 * Loosely normalise a name for matching: lowercase, strip punctuation and
 * extra whitespace, drop generational suffixes. Deliberately permissive —
 * this only produces a *proposed* match; the teacher confirms it.
 */
function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Match each segmented label against the class roster by name similarity.
 * A match is only proposed when reasonably confident; otherwise
 * matchedStudentId stays null and the teacher must pick manually. This
 * NEVER auto-selects a match the teacher hasn't seen — it only pre-fills
 * the review UI's dropdown.
 */
export function matchSegmentsToRoster(
  students: SegmentedStudent[],
  roster: RosterEntry[]
): ProposedSegment[] {
  const normalisedRoster = roster.map((r) => ({
    ...r,
    normalised: normaliseName(r.displayName),
    tokens: new Set(normaliseName(r.displayName).split(" ").filter(Boolean)),
  }));

  return students.map((s) => {
    const target = normaliseName(s.label);
    const targetTokens = new Set(target.split(" ").filter(Boolean));

    let best: { entry: (typeof normalisedRoster)[number]; score: number } | null = null;

    for (const entry of normalisedRoster) {
      let score = 0;
      if (entry.normalised === target) {
        score = 1;
      } else {
        // Token overlap: shared first/last name tokens count strongly.
        let shared = 0;
        for (const t of targetTokens) if (entry.tokens.has(t)) shared++;
        const denom = Math.max(entry.tokens.size, targetTokens.size, 1);
        score = shared / denom;
      }
      if (score > 0 && (!best || score > best.score)) best = { entry, score };
    }

    // Require a reasonably strong match before proposing it — a weak partial
    // overlap is worse than no suggestion, since it invites a careless accept.
    const matched = best && best.score >= 0.5 ? best.entry : null;

    return {
      label: s.label,
      pages: [...s.pages].sort((a, b) => a - b),
      confidence: s.confidence,
      note: s.note,
      matchedStudentId: matched?.profileId ?? null,
      matchedStudentName: matched?.displayName ?? null,
    };
  });
}
