import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import { classifyUnderPrecision, matchesRequiredPrecision } from "./numerical-accuracy";

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

/**
 * Anthropic caps a Messages API request at 32MB total, independent of the
 * 100-page PDF limit — a batch scan can be well under 100 pages and still
 * exceed this on byte size alone at real scan resolution. Stay under with
 * margin for the request's JSON overhead.
 */
export const MAX_SCAN_BYTES = 30 * 1024 * 1024;

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
  /** From the source ib_question: e.g. ["AA"], ["AI"] — which IB course(s) this question is filed under. */
  curriculum: string[];
  /** From the source ib_question: e.g. "AHL", "SL" — IB's own level label, not necessarily human-friendly. */
  level: string | null;
  /** From the source ib_question: 1, 2, or 3. */
  paper: number | null;
}

/**
 * Whether a unit is IBDP Mathematics: Analysis and Approaches HL Paper 2 —
 * the scope of grading_policies/ibdp_math_aa_hl_paper_2_numerical_accuracy.md.
 * "AHL" is the PPQ bank's own level label for AA HL questions (see
 * ib_questions.level); it is not a typo for "SL".
 */
export function isAaHlPaper2(u: Pick<GradingUnit, "curriculum" | "level" | "paper">): boolean {
  return u.curriculum.includes("AA") && u.level === "AHL" && u.paper === 2;
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

/**
 * For a markBreakdown token that is a final numeric Answer/Accuracy mark,
 * the model's own report of what it read, what's correct, and at what
 * precision -- see grading_policies/ibdp_math_aa_hl_paper_2_numerical_accuracy.md
 * section 12. Checked deterministically in validateGradeResponse via
 * lib/numerical-accuracy.ts rather than trusted outright: this is what lets
 * the grader catch the model's own rounding judgement being wrong, not just
 * ask it not to be.
 */
export const NumericCheckSchema = z.object({
  reportedValue: z.string().min(1),
  referenceValue: z.string().min(1),
  /** Other mark-scheme-accepted final values from different valid rounding paths -- see NumericCheck in lib/numerical-accuracy.ts. */
  alternativeReferenceValues: z.array(z.string().min(1)).optional(),
  precisionType: z.enum(["exact", "sf", "dp"]),
  precisionDigits: z.number().int().min(0).optional(),
});

/** A single mark scheme token and whether the student earned it. */
export const MarkBreakdownEntrySchema = z.object({
  token: z.string().min(1),
  awarded: z.boolean(),
  note: z.string().default(""),
  /** Only present for a final numeric accuracy mark; see NumericCheckSchema. */
  numericCheck: NumericCheckSchema.nullable().optional(),
  /**
   * Only present on a Method mark awarded because the student's final
   * numeric answer -- though not precise enough to earn its own accuracy
   * mark -- is itself evidence the correct method was used (see the
   * "implied method evidence" rule in GRADING_SYSTEM_PROMPT). Same shape as
   * NumericCheckSchema, reused for the same reason: it's the same
   * reported-value-vs-reference-value comparison, just checked for a
   * different purpose (was this under-precise, not was it correct).
   */
  impliedMethodEvidence: NumericCheckSchema.nullable().optional(),
  /**
   * Only present on an INTERMEDIATE accuracy mark whose mark scheme value
   * is a reference (calculator) figure rather than an explicit precision
   * requirement (see rule 15 in GRADING_SYSTEM_PROMPT) -- e.g. the mark
   * scheme prints "2.65708" for an (A1) but never says the student must
   * reproduce 5 decimal places. Same shape as NumericCheckSchema: the
   * reported value earns the mark when it's an exact rounding of the
   * reference at the reported value's own digit count, not merely close to
   * it. Distinct from numericCheck (a real precision requirement, checked
   * strictly) and from impliedMethodEvidence (a Method mark, not an
   * Accuracy mark) -- these are three different grading mechanisms and
   * are not interchangeable.
   */
  intermediateValueCheck: NumericCheckSchema.nullable().optional(),
});

/**
 * Where the model saw a part's handwritten work, as a fraction of the full
 * page (0 = left/top edge, 1 = right/bottom edge) rather than absolute
 * points — the model is never told each page's point dimensions, so a
 * fraction is the only coordinate space it can report reliably. The
 * grading route converts this to PDF points (using the real page size from
 * the uploaded scan) before asking the CV service to render the crop.
 */
export const EvidenceBoxSchema = z.object({
  /** 1-indexed page number within the uploaded scan. */
  page: z.number().int().min(1),
  x0: z.number(),
  y0: z.number(),
  x1: z.number(),
  y1: z.number(),
});

/**
 * Shape the model is instructed to return. Deliberately strict: anything
 * outside this shape is rejected rather than coerced into a mark.
 */
// Field order mirrors GRADING_SYSTEM_PROMPT's WORKING ORDER / OUTPUT sections:
// each later field is meant to be derived from the ones before it (most
// importantly, suggestedMarks from markBreakdown), so the schema is ordered
// the same way the model is instructed to generate them.
export const AiGradeItemSchema = z.object({
  /** Must echo back the testItemId supplied in the prompt. */
  testItemId: z.string().min(1),
  /** False when the part could not be located in the scan. */
  workFound: z.boolean(),
  evidence: z.string().default(""),
  /** Null when the model couldn't confidently localise the work on the page. */
  evidenceBox: EvidenceBoxSchema.nullable().default(null),
  markBreakdown: z.array(MarkBreakdownEntrySchema).default([]),
  reasoning: z.string().default(""),
  suggestedMarks: z.number().int().min(0),
  confidence: z.enum(["high", "medium", "low"]),
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
 * Whether a graded part belongs in a run's `needsReview` list. Anything short
 * of "high" confidence -- "medium" included, not just "low" -- surfaces here,
 * since a teacher shouldn't have to open every part to notice one the model
 * itself wasn't fully sure about.
 */
export function gradeNeedsReview(g: Pick<ValidatedGrade, "confidence"> & { item: Pick<AiGradeItem, "workFound"> }): boolean {
  return g.confidence !== "high" || !g.item.workFound;
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

    // Deterministically re-check any final numeric accuracy mark the model
    // itself flagged for verification (NumericCheckSchema; see the AA HL
    // Paper 2 numerical-accuracy policy). This is a real correction, not a
    // second opinion: production evidence showed the model repeatedly
    // rationalizing a genuine precision mismatch as "acceptable rounding"
    // even when explicitly instructed not to (the same test, graded five
    // separate times, always awarding a=0.81 against a required a=0.805).
    // A prompt instruction alone was not sufficient enforcement, so an
    // award the model reports as correct is corrected here whenever the
    // deterministic check disagrees. This only ever removes an award the
    // model gave itself -- never grants one it withheld -- since the
    // checker can only disprove a claimed precision match, not evaluate
    // every other reason a mark might legitimately be withheld.
    for (const entry of item.markBreakdown) {
      if (!entry.numericCheck) continue;
      const result = matchesRequiredPrecision(entry.numericCheck);
      if (entry.awarded && !result.ok) {
        entry.awarded = false;
        entry.note = entry.note ? `${entry.note} (corrected: ${result.reason})` : `Corrected: ${result.reason}`;
        warnings.push(
          `${unitLabel(unit)}: ${entry.token} withheld on deterministic accuracy re-check — ${result.reason}`
        );
      }
    }

    // Same idea, for a Method mark the model claims is evidenced by an
    // under-precise-but-correct final answer (see GRADING_SYSTEM_PROMPT's
    // implied-method-evidence rule and impliedMethodEvidence on the schema).
    // The model decides WHETHER this kind of inference applies to a given
    // mark (that depends on the mark scheme's own wording, which this
    // function never re-reads) -- this only re-checks the numeric CLAIM
    // once the model has made it: is the reported value actually an exact
    // rounding of the reference value, or merely a different, coincidentally
    // nearby number? Only a definite "numerically_incorrect" result
    // withdraws the mark; "cannot_determine" defers to the model, same as
    // the accuracy check above.
    for (const entry of item.markBreakdown) {
      if (!entry.impliedMethodEvidence) continue;
      const result = classifyUnderPrecision(entry.impliedMethodEvidence);
      if (entry.awarded && result.classification === "numerically_incorrect") {
        entry.awarded = false;
        entry.note = entry.note ? `${entry.note} (corrected: ${result.reason})` : `Corrected: ${result.reason}`;
        warnings.push(
          `${unitLabel(unit)}: ${entry.token} withheld — claimed implied-method evidence does not hold: ${result.reason}`
        );
      }
    }

    // Same idea again, for an intermediate accuracy mark whose value the
    // model treated as a reference figure rather than a required precision
    // (see rule 15 and intermediateValueCheck on the schema). Unlike the
    // final-answer numericCheck above, an intermediate value earns its mark
    // for ANY exact rounding of the reference -- correct_at_required_precision
    // and correct_but_under_precise both stand; only numerically_incorrect
    // withdraws it. This never decides WHICH written number belongs to this
    // token (that transcription judgement stays with the model) -- it only
    // re-checks the numeric claim once the model has made it.
    for (const entry of item.markBreakdown) {
      if (!entry.intermediateValueCheck) continue;
      const result = classifyUnderPrecision(entry.intermediateValueCheck);
      if (entry.awarded && result.classification === "numerically_incorrect") {
        entry.awarded = false;
        entry.note = entry.note ? `${entry.note} (corrected: ${result.reason})` : `Corrected: ${result.reason}`;
        warnings.push(
          `${unitLabel(unit)}: ${entry.token} withheld — claimed intermediate value is not a valid rounding of the reference: ${result.reason}`
        );
      }
    }

    // The model is instructed that awarded mark_breakdown tokens must sum to
    // suggestedMarks (every token here is a single mark — M1/A1/R1/AG, never
    // M2/A2), but it doesn't always follow its own arithmetic. When it
    // disagrees with itself, the itemised breakdown is the more trustworthy
    // number (it's auditable per-token against the mark scheme, where a bare
    // suggestedMarks is not), so that's what gets kept — always flagged low
    // confidence, since an internal inconsistency means something about the
    // grading went wrong regardless of which number was "right".
    if (item.markBreakdown.length > 0) {
      const awardedCount = item.markBreakdown.filter((b) => b.awarded).length;
      if (awardedCount !== clampedMarks) {
        warnings.push(
          `${unitLabel(unit)}: model reported ${clampedMarks} mark(s) but its own breakdown only awards ${awardedCount} token(s); corrected to ${awardedCount} and flagged low confidence`
        );
        clampedMarks = Math.min(awardedCount, unit.maxMarks);
        confidence = "low";
      }
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
export function normalisePartLabel(label: string | null | undefined): string {
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
  curriculum: string[] | null;
  level: string | null;
  paper: number | null;
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
    .select("id, code, stem_latex, stem_markscheme_latex, parts_draft_markscheme_latex, curriculum, level, paper")
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
      curriculum: question?.curriculum ?? [],
      level: question?.level ?? null,
      paper: question?.paper ?? null,
    };
  });

  return { units, warnings };
}

export interface MarkschemeImageRef {
  testItemId: string;
  storagePath: string;
}

/**
 * Find the PPQ bank's source image(s) of a given type ("question" or
 * "markscheme") for each test item, so the grading review UI can show the
 * teacher what the AI's question/mark-scheme text was actually transcribed
 * from.
 *
 * Mirrors assembleMarkScheme's test_items -> ib_questions -> question_parts
 * join (by code, then by normalised part label) but only needs question_images.
 * A part-specific image (question_images.part_id set) takes priority; when
 * none exists, falls back to the question's shared (part_id null) images,
 * since many scans have one image per question rather than per part.
 */
async function assembleQuestionBankImages(
  supabase: SupabaseClient,
  testId: string,
  imageType: "question" | "markscheme"
): Promise<MarkschemeImageRef[]> {
  const { data: itemRows, error: itemsError } = await supabase
    .from("test_items")
    .select("id, part_label, ib_question_code")
    .eq("test_id", testId);
  if (itemsError) throw new Error(`Failed to load test items: ${itemsError.message}`);

  const items = (itemRows ?? []) as { id: string; part_label: string | null; ib_question_code: string }[];
  if (items.length === 0) return [];

  const codes = [...new Set(items.map((i) => i.ib_question_code).filter(Boolean))];

  const { data: questionRows, error: qError } = await supabase
    .from("ib_questions")
    .select("id, code")
    .in("code", codes);
  if (qError) throw new Error(`Failed to load questions: ${qError.message}`);

  const questions = (questionRows ?? []) as { id: string; code: string }[];
  const questionByCode = new Map(questions.map((q) => [q.code, q]));
  const questionIds = questions.map((q) => q.id);
  if (questionIds.length === 0) return [];

  const { data: partRows, error: pError } = await supabase
    .from("question_parts")
    .select("id, question_id, part_label")
    .in("question_id", questionIds);
  if (pError) throw new Error(`Failed to load question parts: ${pError.message}`);

  const parts = (partRows ?? []) as { id: string; question_id: string; part_label: string | null }[];
  const partsByQuestion = new Map<string, typeof parts>();
  for (const p of parts) {
    const list = partsByQuestion.get(p.question_id) ?? [];
    list.push(p);
    partsByQuestion.set(p.question_id, list);
  }

  const { data: imageRows, error: imgError } = await supabase
    .from("question_images")
    .select("question_id, part_id, storage_path, sort_order")
    .eq("image_type", imageType)
    .in("question_id", questionIds)
    .order("sort_order", { ascending: true });
  if (imgError) throw new Error(`Failed to load ${imageType} images: ${imgError.message}`);

  const images = (imageRows ?? []) as {
    question_id: string;
    part_id: string | null;
    storage_path: string;
  }[];
  const imagesByQuestion = new Map<string, typeof images>();
  for (const img of images) {
    const list = imagesByQuestion.get(img.question_id) ?? [];
    list.push(img);
    imagesByQuestion.set(img.question_id, list);
  }

  const result: MarkschemeImageRef[] = [];
  for (const item of items) {
    const question = questionByCode.get(item.ib_question_code);
    if (!question) continue;
    const questionImages = imagesByQuestion.get(question.id) ?? [];
    if (questionImages.length === 0) continue;

    const questionParts = partsByQuestion.get(question.id) ?? [];
    const wanted = normalisePartLabel(item.part_label);
    let matched = questionParts.find((p) => normalisePartLabel(p.part_label) === wanted);
    if (!matched && wanted === "" && questionParts.length === 1) matched = questionParts[0];

    const forPart = matched ? questionImages.filter((img) => img.part_id === matched!.id) : [];
    const shared = questionImages.filter((img) => img.part_id === null);
    const chosen = forPart.length > 0 ? forPart : shared;

    for (const img of chosen) {
      result.push({ testItemId: item.id, storagePath: img.storage_path });
    }
  }

  return result;
}

export function assembleMarkschemeImages(
  supabase: SupabaseClient,
  testId: string
): Promise<MarkschemeImageRef[]> {
  return assembleQuestionBankImages(supabase, testId, "markscheme");
}

export function assembleQuestionImages(
  supabase: SupabaseClient,
  testId: string
): Promise<MarkschemeImageRef[]> {
  return assembleQuestionBankImages(supabase, testId, "question");
}

// -----------------------------------------------------------------------------
// Prompts
// -----------------------------------------------------------------------------

export const GRADING_SYSTEM_PROMPT = `You are an experienced IB Diploma Programme Mathematics examiner marking a scanned, handwritten student script against an official IB mark scheme.

You mark to the mark scheme. You do not mark to your own preferred method or your own arithmetic. The mark scheme is the authority.

MARK TYPES
- M (method): awarded for a correct method, even if the subsequent arithmetic is wrong. Award M marks when the intended method is clearly visible. "Visible" includes a final numeric answer that is itself only explainable by the correct method — see rule 14 for when an under-precise final answer still evidences the method that produced it.
- A (accuracy): awarded for a correct result. An A mark depends on its associated M mark — never award an A without the M that earns it.
- R (reasoning): awarded for correct justification or explanation, not merely a correct answer.
- AG (answer given): the answer is printed in the question. Award only if the working genuinely derives it. Do NOT award if the student worked backwards from the printed answer or simply restated it.

MARKING RULES
1. Award whole marks only. Never award half marks.
2. Never exceed the stated maximum for a part.
3. Follow through (FT): if a student carries an incorrect value from an earlier part into a later part but the method in the later part is correct, award the method marks in the later part.
4. Accept any valid alternative method that reaches the required result. Mark scheme methods are indicative, not exhaustive.
5. Accept equivalent forms of a correct answer (unsimplified, decimal vs exact, algebraically equivalent) unless the mark scheme or the command term demands a particular form.
6. For an A mark tied to a specific numerical value where the mark scheme or question states a precision requirement — a final answer, or any step the mark scheme explicitly says must be "correct to N significant figures / decimal places", "given to...", or similar — the student's value must match that required precision exactly. A value that differs — even slightly — is wrong and does not earn the mark, unless the mark scheme itself gives an explicit tolerance or alternative (e.g. "accept 0.946 to 0.948", "465 (or 464 from 3sf)", "or equivalent"). Do not invent your own tolerance for "rounding," "calculator precision," "acceptable rounding," or "close enough" that the mark scheme doesn't state — if the mark scheme is silent on tolerance, there is none. This is separate from rule 5: rule 5 is about the *form* of a correct value (0.5 vs 1/2), this rule is about whether the value itself is the *correct* one. This rule governs a mark with an actual (explicit or default-final-answer) precision requirement; for an INTERMEDIATE working value that the mark scheme merely displays as a reference figure with no such requirement, see rule 15 — do not apply this rule's exactness to every number a mark scheme happens to print.
   Reporting a value to FEWER significant figures than the mark scheme states is never a match, even when the mark scheme's value would itself round to the student's coarser value at that coarser precision — fewer digits means you cannot tell whether the underlying value was actually correct. Concretely: if the mark scheme states "a = 0.805" (3 s.f.) and the student writes "a = 0.81" (2 s.f.), that is wrong and does not earn the A mark. "0.81 is what 0.805 rounds to at 2 s.f." is exactly the kind of self-invented tolerance this rule forbids, not a reason to award it. Reporting a value to MORE decimal places than the mark scheme's stated answer is different and is fine, PROVIDED it rounds to exactly the mark scheme's value at the mark scheme's own precision (e.g. mark scheme wants a final answer of "8.52"; a student's more-precise "8.515" rounds to 8.52 and earns the mark) — extra genuine precision that still resolves to the correct answer is not the same failure as insufficient precision that hides whether it does. If the extra-precision value does NOT round to the mark scheme's value, it is wrong, and being the result of an otherwise-correct method does not change that: a correct method carried into a later part earns that part's method marks per rule 3, but its accuracy marks still require the mark scheme's own value, not a "close" or "explicable" one.
7. Ignore subsequent working that does not contradict a correct answer already given. If later working contradicts and replaces a correct answer, mark the final answer.
8. If a part is blank, crossed out with nothing to replace it, or absent from the scan, set workFound to false and suggestedMarks to 0.
9. If handwriting is ambiguous, mark the most plausible reading in the student's favour and lower your confidence.
10. Do not deduct marks for poor presentation, notation slips, or missing units unless the mark scheme requires them.
11. For an R mark that asks the student to interpret a value "in context" (e.g. what a regression coefficient represents), judge the student's own wording on whether it conveys the same meaning as the mark scheme's model answer, not on whether it uses the same words. In particular, "for every increase of 1 in X, Y increases/decreases by k" is an equivalent way of stating "Y represents the (average) increase/decrease in ... per unit increase in X" — award it even though it doesn't use the word "average" or the mark scheme's exact phrasing. Withhold the mark only when the explanation is wrong or incomplete in substance: wrong direction, wrong variable, missing context the mark scheme specifically requires, or vague enough that it could describe an unrelated relationship. A different sentence structure that says the same thing is not a reason to withhold the mark. This rule governs wording of a correct interpretation only — it does not relax rule 6's exactness requirement for the numerical value the interpretation refers to.
12. Before concluding that a transcribed numerical value is wrong under rule 6, consider whether you may have misread the handwriting rather than the student having made an error. A transcribed value that differs from the mark scheme's value by what looks like a single confused digit (common confusions: 4/9, 1/7, 5/6, 0/6, 3/8, or a missing/extra decimal place) is exactly the pattern of a transcription misread, not necessarily a wrong answer. In that situation, look again at the actual handwriting before finalizing your reading. If you cannot become confident which digit is actually written, transcribe your best reading in the evidence field but do not report "high" confidence for that item — this is exactly the kind of uncertainty confidence exists to flag for teacher review, and it does not change how rule 6 is applied to whichever value you finally transcribe.
13. A mark scheme token written in parentheses, e.g. "(M1)" or "(A1)", is an IMPLIED mark: award it whenever a correct later result or final answer makes it clear that step must have been performed, even if the student never wrote that specific step down explicitly. Do not withhold a bracketed mark merely because its own intermediate line is missing from the working — that is exactly what the parentheses signal is acceptable. A token written WITHOUT parentheses, e.g. "M1" or "A1", is the ordinary case and still requires that step's own evidence to be visibly present in the working (or, per rule 3, validly implied by follow-through from an earlier part) — do not extend the "no explicit line needed" leniency of a bracketed mark to an unbracketed one. When you itemise markBreakdown, echo the token exactly as it appears in the mark scheme, parentheses included, so this distinction stays visible in the record.
14. METHOD and ACCURACY are independent criteria — grade them separately, never as one all-or-nothing correctness test. A final numeric answer failing rule 6's precision requirement is an ACCURACY failure; it is not automatically a METHOD failure too. Some real IB mark schemes say this outright, e.g. "If no working shown, award (M1)A0 for 5.7 (2sf)" — a final answer alone, at reduced precision, is treated as sufficient evidence of the method for that mark.
    Apply this specifically when the student's reported value is the correct underlying result rounded to FEWER significant figures or decimal places than required — not merely a nearby or plausible-looking number. "0.95" is the correct 0.946591... rounded to 2 s.f., so it is exact evidence of that method; "0.96" is not a rounding of 0.946591... at any precision, so it is not evidence of anything and must not be treated as if it were. Being "close" is never sufficient — only an exact rounding relationship counts. Use this decision order for a method mark tied to a numeric result:
    a. The reported value is correct at the precision the mark scheme requires -> award the method mark and the accuracy mark (ordinary case).
    b. The reported value is that same correct result rounded to fewer digits, with nothing in the student's own working that contradicts the correct method -> award the method mark, withhold the accuracy mark (insufficient precision, not a wrong method). Say so in your reasoning using "insufficient precision" or "fewer significant figures than required" — never "incorrectly rounded" for a value that is itself a correct rounding, and never "rounding error" or "close enough".
    c. The reported value does not match the correct result at any rounding (a genuinely different number, e.g. an arithmetic slip) -> judge the method mark from whatever working is actually shown, the same as any other method mark; do not award it from the wrong final number alone.
    d. The student's own working explicitly shows an incorrect procedure -> grade the method mark from that working. A final answer that happens to look right, or right-but-under-precise, never overrides explicit incorrect working — do not infer a correct method the student's own steps contradict.
    Whether a given M mark is even the kind of thing that CAN be inferred from a final answer this way is your judgement to make from the mark scheme's own wording for that specific mark (a mark for "recognizes conditional probability" or for an algebraic derivation usually is not — that kind of reasoning generally needs to be shown, not inferred from a number). Do not turn this into a blanket rule that any 2-significant-figure or any nearby answer earns M1 regardless of what the mark scheme's method mark actually represents.
    When you award a mark this way, attach impliedMethodEvidence to that mark's own markBreakdown entry (same shape as numericCheck: reportedValue, referenceValue, optionally alternativeReferenceValues, precisionType, precisionDigits) so the reported-vs-reference rounding relationship you're relying on is auditable, e.g.:
    { "token": "(M1)", "awarded": true, "note": "0.95 is 0.946591... to 2 s.f.: sufficient evidence of the correct method; insufficient precision for the A mark", "impliedMethodEvidence": { "reportedValue": "0.95", "referenceValue": "0.946591", "precisionType": "sf", "precisionDigits": 3 } }
    Omit impliedMethodEvidence entirely for a method mark awarded the ordinary way (explicit working shown) — it exists only to record this specific numeric inference, not as a general-purpose field on every M mark.
15. A mark scheme's own numerical value is not always a required text string. Distinguish two different things a mark scheme number can be:
    - a stated precision REQUIREMENT — the value IS the final answer, or the mark scheme/question explicitly says this specific value must be "correct to N significant figures / decimal places", "given to...", "accept...", or similar. Rule 6 applies: match it exactly at that precision.
    - a reference VALUE for an intermediate step, with no such explicit language — the number shown (e.g. "2.65708" next to an intermediate (A1) or A1) is the calculator/full-precision figure supplied to examiners, not a instruction that the student must reproduce all of its displayed digits. A student's own appropriately rounded representation of that same value earns the mark. Do NOT reason "the student's 2.657 does not equal the mark scheme's 2.65708, so A0" — that misreads what the mark scheme number means. Instead: is 2.657 an exact rounding of 2.65708...? Yes (round 2.65708 to 3 d.p. is 2.657) — award it.
    The default is the second case: only apply rule 6's exactness to an intermediate value when the mark scheme or question uses actual precision language for THAT step. The mere number of digits a mark scheme happens to print is never by itself a precision requirement.
    An intermediate value earns its mark when it is an exact rounding of the reference value at the digit count the student actually wrote (same rounding relationship as rule 14 — "close" or "nearby" is never sufficient, only an exact rounding counts) and nothing in the student's own subsequent working contradicts the method that produced it. This is independent of whether the FINAL answer later in the same part meets ITS required precision — grade the intermediate mark and the final mark on their own criteria; a final-answer precision miss does not retroactively erase an already-earned intermediate mark, and an accepted intermediate value never excuses a final answer that is itself wrong or under-precise.
    When you award an intermediate mark this way, attach intermediateValueCheck to that mark's own markBreakdown entry (same shape as numericCheck), using the value actually written for THIS step, not a later final-answer figure, e.g.:
    { "token": "(A1)", "awarded": true, "note": "2.657 is 2.65708... to 3 d.p.: an acceptable intermediate value, not a required digit-for-digit match", "intermediateValueCheck": { "reportedValue": "2.657", "referenceValue": "2.65708", "precisionType": "dp", "precisionDigits": 5 } }
    Omit intermediateValueCheck for a final-answer mark (use numericCheck there) and for an intermediate mark whose value you did not need to round-check (e.g. an exact or symbolic intermediate result).

WORKING ORDER — follow these steps in sequence for each part, because the later
fields in OUTPUT below are DERIVED from the earlier ones, not independent
judgement calls made in parallel:

1. EVIDENCE: transcribe what the student actually wrote for this part.
2. EVIDENCE LOCATION: report evidenceBox — the page and a bounding box, as a
   fraction of that page's full width/height (0 = left/top edge, 1 =
   right/bottom edge), that tightly bounds the student's handwritten working
   for THIS part, e.g. {"page": 3, "x0": 0.08, "y0": 0.42, "x1": 0.95, "y1":
   0.61}. This is used to show the teacher the exact scan region your
   evidence came from, so it must actually contain the work, not just be
   somewhere on the right page. The box must bound the student's
   HANDWRITING, never the printed question text: when the printed question
   and the student's handwritten answer share the same page (a common
   layout), do not stop the box at the bottom of the printed text — extend
   y1 down far enough to include the handwritten working and final answer
   that follows it, even if that pushes the box well below where the
   printed question ends. If you cannot localise it confidently, set
   evidenceBox to null rather than guessing — a missing crop is fine, a
   wrong one (including one that shows only printed text with no
   handwriting) is not. Omit entirely (null) when workFound is false.
   When a student writes several sub-part answers together as a stacked,
   explicitly lettered list (e.g. "a) ...", "b) ...", "c) ..." one after
   another, separate from where the sub-parts were printed), find THIS
   part's own lettered line by its label, not by proximity to that part's
   printed question stem — the printed stems for several sub-parts are
   often grouped together above the list, so the nearest handwriting to a
   given stem is frequently a different, adjacent letter's answer, not
   this one. Read the label the student actually wrote ("b)", "(b)", "ii)",
   etc.) and box that specific line and whatever working continues from
   it, not the line before or after it. A box that stops right where the
   correct letter's line begins is exactly as wrong as one that never
   reaches it — verify the label inside your box matches the part you are
   grading before finalising evidenceBox.
3. MARK BREAKDOWN: itemise every mark scheme token (M1, A1, R1, AG, ...) for
   this part and decide, one token at a time, whether the transcribed
   evidence earns it. Decide each M and A token on its own criterion (see
   rule 14) — a wrong or under-precise final answer does not by itself
   decide the M mark tied to it. An intermediate A mark's own value is
   usually a reference figure, not a required digit-for-digit match (see
   rule 15) — decide it on its own rounding relationship to that
   reference, separately from whether the final answer later in the same
   part meets its own precision requirement.
4. REASONING: briefly explain the itemisation above.
5. SUGGESTED MARKS: suggestedMarks is NOT a separate judgement call — it is
   the count of tokens you just marked awarded in step 3 (every token here
   is worth exactly one mark; there is no M2 or A2). Compute it by counting,
   don't estimate it separately from a general impression of the work. If a
   number you were about to write down doesn't match that count, the count
   is right and the number is wrong — go back and recheck the breakdown
   against the mark scheme rather than reporting a total that disagrees
   with your own itemisation.
6. CONFIDENCE: assessed last, since it depends on everything above.
   - "high": the work is legible and maps cleanly onto the mark scheme.
   - "medium": legible but needs a judgement call (alternative method, partial working, follow-through).
   - "low": illegible, ambiguous, hard to locate, or a genuinely borderline award.
   Anything marked "low" is flagged for the teacher to mark by hand. Be honest — an over-confident wrong mark is far more damaging than a flagged uncertain one.

OUTPUT
Return ONLY a JSON object. No preamble, no markdown fences, no commentary.
Fields are listed in the order you should decide them (see WORKING ORDER above) —
generate the JSON in this order too, since suggestedMarks depends on markBreakdown.

{
  "items": [
    {
      "testItemId": "<echo back exactly the testItemId given to you>",
      "workFound": <boolean>,
      "evidence": "<what the student actually wrote, briefly>",
      "evidenceBox": { "page": 3, "x0": 0.08, "y0": 0.42, "x1": 0.95, "y1": 0.61 } | null,
      "markBreakdown": [{ "token": "M1", "awarded": true, "note": "<brief>" }],
      "reasoning": "<one or two sentences citing the tokens satisfied or missed>",
      "suggestedMarks": <the count of markBreakdown entries above with awarded: true>,
      "confidence": "high" | "medium" | "low"
    }
  ]
}

Return exactly one entry for every part you were given, in the order given.`;

/**
 * Loaded once at module init, not per-request: the file is small and static,
 * and every grading call for an AA HL Paper 2 test needs it. Read failures
 * are fatal at load time rather than silently downgrading to no policy --
 * a numerical-accuracy policy that can silently vanish because of a moved
 * file is worse than one that fails loudly.
 */
const AA_HL_PAPER_2_POLICY_PATH = path.join(
  process.cwd(),
  "grading_policies",
  "ibdp_math_aa_hl_paper_2_numerical_accuracy.md"
);

function loadAaHlPaper2Policy(): string {
  try {
    return fs.readFileSync(AA_HL_PAPER_2_POLICY_PATH, "utf8");
  } catch (e) {
    throw new Error(
      `Could not load the AA HL Paper 2 numerical-accuracy policy from ${AA_HL_PAPER_2_POLICY_PATH}: ${
        e instanceof Error ? e.message : String(e)
      }`
    );
  }
}

export const AA_HL_PAPER_2_NUMERICAL_ACCURACY_POLICY = loadAaHlPaper2Policy();

/**
 * The system prompt for a specific grading call: the universal marking
 * rules, plus grading_policies/ibdp_math_aa_hl_paper_2_numerical_accuracy.md
 * appended whenever at least one unit being graded is IBDP Mathematics: AA
 * HL Paper 2 (see isAaHlPaper2). Every route that calls the grading model
 * builds its system prompt through this function rather than using
 * GRADING_SYSTEM_PROMPT directly, so the policy can't be wired into one
 * grading path and silently missed by another.
 */
export function buildGradingSystemPrompt(units: GradingUnit[]): string {
  if (!units.some(isAaHlPaper2)) return GRADING_SYSTEM_PROMPT;
  return `${GRADING_SYSTEM_PROMPT}

===============================================================================
ADDITIONAL POLICY -- IBDP Mathematics: Analysis and Approaches HL Paper 2
Numerical Accuracy (applies to this assessment)
===============================================================================

${AA_HL_PAPER_2_NUMERICAL_ACCURACY_POLICY}`;
}

/**
 * Build the mark-scheme block: everything about a test's parts and how to mark
 * them, with no student-specific content. This text is byte-identical for
 * every student sitting the same test, so callers should attach a
 * cache_control breakpoint to it — on a batch upload, every student after the
 * first hits a cache read instead of re-sending the whole mark scheme.
 */
/** Build one unit's mark-scheme block: question/context text shared by the batch and single-item prompts. */
function buildUnitBlock(u: GradingUnit): string {
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
}

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

  const blocks = units.map(buildUnitBlock);

  return `${header}

Each attached PDF is a scan of one student's handwritten work for the whole assessment above. Locate each part below in the scan and mark it against its mark scheme.

The scan may be out of order, may include rough working, and may span multiple pages per question. Search the whole document before concluding a part is missing.

${blocks.join("\n\n")}`;
}

/**
 * Build the prompt for re-marking a single part from a teacher-supplied
 * transcription, rather than the model reading a scan itself. Used when a
 * teacher corrects a misread `evidence` field in the review UI: there is no
 * PDF or image here, just the corrected text and the part's mark scheme, so
 * evidenceBox is meaningless and workFound is already known to be true (a
 * teacher wouldn't be correcting the transcription of work that doesn't
 * exist).
 */
export function buildRegradeItemPrompt(unit: GradingUnit, correctedEvidence: string): string {
  return `A teacher has reviewed the scan directly and corrected the transcription of the student's work for this part, because the original automated transcription was wrong (e.g. a misread digit). Mark this corrected transcription against the mark scheme below -- there is no scan attached this time, so base your marking only on the text given.

${buildUnitBlock(unit)}

--- Teacher-corrected transcription of the student's work for this part ---
${correctedEvidence}

Return the JSON object now, for this one part only. Set workFound to true and evidenceBox to null (there is no scan region to locate here). Set the "evidence" field to the corrected transcription given above.`;
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

/** Standard Levenshtein edit distance between two strings. */
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Two name tokens count as the same word if they're identical, or close
 * enough that a coincidental match is unlikely — a single edit for short
 * tokens, proportionally more for longer ones (two edits in a 6-letter
 * word is still clearly the same name; the same two edits in a 4-letter
 * word usually isn't). Catches common handwriting-OCR misreads ("Felloh"
 * or "Kelloh" for "Fellah", "Seungjin" for "Seungjun") without conflating
 * genuinely different short names (kept exact-only below 4 characters).
 */
function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  const dist = levenshteinDistance(a, b);
  const maxLen = Math.max(a.length, b.length);
  const allowed = maxLen < 6 ? 1 : Math.floor(maxLen * 0.34);
  return dist <= allowed;
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
    tokens: [...new Set(normaliseName(r.displayName).split(" ").filter(Boolean))],
  }));

  return students.map((s) => {
    const target = normaliseName(s.label);
    const targetTokens = [...new Set(target.split(" ").filter(Boolean))];

    const scored: { entry: (typeof normalisedRoster)[number]; score: number }[] = [];
    for (const entry of normalisedRoster) {
      let score = 0;
      if (entry.normalised === target) {
        score = 1;
      } else if (targetTokens.length > 0 && entry.tokens.length > 0) {
        // Token overlap, fuzzy per word. Scored against whichever side has
        // FEWER tokens, so a nickname-only roster entry ("Luciana") isn't
        // penalised for matching only part of a longer OCR-read cover-page
        // name ("Luciana Rojas More"), and a sparse cover-page read isn't
        // penalised against a longer roster name either.
        let shared = 0;
        for (const t of targetTokens) {
          if (entry.tokens.some((et) => tokensMatch(t, et))) shared++;
        }
        score = shared / Math.min(targetTokens.length, entry.tokens.length);
      }
      if (score > 0) scored.push({ entry, score });
    }
    scored.sort((a, b) => b.score - a.score);

    // Require a reasonably strong match before proposing it — a weak partial
    // overlap is worse than no suggestion, since it invites a careless
    // accept. Also require it not be a near-tie with the next-best roster
    // entry (e.g. two students who share a first name) — an ambiguous
    // match is exactly the case where the teacher must pick manually.
    const [best, second] = scored;
    const matched =
      best && best.score >= 0.5 && (!second || best.score - second.score >= 0.15)
        ? best.entry
        : null;

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
