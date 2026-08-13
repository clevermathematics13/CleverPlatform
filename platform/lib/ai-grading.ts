import { z } from "zod";

/**
 * AI-assisted grading of scanned student work against the PPQ bank's mark scheme.
 *
 * Layering (deliberate — validation first, then resolution, then prompting):
 *   1. Zod schemas   — every model response is parsed before it touches the DB.
 *   2. Resolver      — maps each test_item to the best available mark scheme,
 *                      recording WHICH source was used so the teacher can judge
 *                      how much to trust each suggestion.
 *   3. Prompt builder— turns resolved items into an IB-conventional marking brief.
 *
 * Nothing here writes to student_marks. Suggestions are always staged in
 * ai_grade_results for explicit teacher acceptance.
 */

// ─── 1. Validation layer ─────────────────────────────────────────────────────

/** IB mark codes: M = method, A = accuracy, R = reasoning, AG = answer given. */
export const MarkCodeSchema = z.enum(["M", "A", "R", "AG"]);

export const MarkBreakdownEntrySchema = z.object({
  /** e.g. "M1", "A1", "R1", "AG" — as written in the mark scheme. */
  code: z.string().min(1).max(8),
  kind: MarkCodeSchema,
  awarded: z.boolean(),
  /** Short justification tied to the student's visible work. */
  note: z.string().max(400).default(""),
});

export const AiGradeItemSchema = z.object({
  /** Must echo the test_item_id supplied in the prompt. */
  test_item_id: z.string().uuid(),
  /** false when no attempt at this question was found in the scan. */
  work_found: z.boolean(),
  suggested_marks: z.number().int().min(0),
  confidence: z.enum(["high", "medium", "low"]),
  /** Transcription/summary of what the student actually wrote. */
  evidence: z.string().max(2000).default(""),
  /** Why these marks, referenced to the mark scheme. */
  reasoning: z.string().max(2000).default(""),
  mark_breakdown: z.array(MarkBreakdownEntrySchema).max(30).default([]),
});

export const AiGradeResponseSchema = z.object({
  items: z.array(AiGradeItemSchema).min(1),
});

export type AiGradeItem = z.infer<typeof AiGradeItemSchema>;
export type AiGradeResponse = z.infer<typeof AiGradeResponseSchema>;
export type MarkBreakdownEntry = z.infer<typeof MarkBreakdownEntrySchema>;

/**
 * Extract the first balanced JSON object from a model response and validate it.
 * Tolerates ```json fences and incidental prose around the payload.
 */
export function parseAiGradeResponse(
  raw: string
): { ok: true; data: AiGradeResponse } | { ok: false; error: string } {
  const stripped = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = stripped.indexOf("{");
  if (start === -1) return { ok: false, error: "No JSON object found in response." };

  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;

  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  if (end === -1) return { ok: false, error: "Unterminated JSON object in response." };

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped.slice(start, end + 1));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "JSON parse failed." };
  }

  const result = AiGradeResponseSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      error: result.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    };
  }
  return { ok: true, data: result.data };
}

// ─── 2. Mark-scheme resolution layer ─────────────────────────────────────────

export type MarkSchemeSource =
  | "part_latex"
  | "part_text"
  | "whole_question"
  | "draft"
  | "none";

export interface ResolvedItem {
  test_item_id: string;
  question_number: number;
  part_label: string;
  max_marks: number;
  ib_question_code: string;
  subtopic_codes: string[];
  /** Question wording, for context when reading the student's work. */
  question_text: string;
  markscheme: string;
  markscheme_source: MarkSchemeSource;
  /**
   * True when the resolved mark scheme covers the WHOLE question rather than
   * this specific part — the model must isolate the relevant portion itself,
   * and confidence should be capped accordingly.
   */
  unsegmented: boolean;
}

export interface CoverageReport {
  total_items: number;
  resolved_items: number;
  unresolved_items: number;
  unsegmented_items: number;
  by_source: Record<MarkSchemeSource, number>;
  /** Human-readable warnings surfaced in the review UI before a run. */
  warnings: string[];
}

const norm = (v: string | null | undefined): string => (v ?? "").trim();
const nonEmpty = (v: string | null | undefined): boolean => norm(v).length > 0;

interface QuestionPartRow {
  question_id: string;
  part_label: string | null;
  content_latex: string | null;
  content_text: string | null;
  markscheme_latex: string | null;
  markscheme_text: string | null;
  sort_order: number | null;
}

interface QuestionRow {
  id: string;
  code: string;
  stem_latex: string | null;
  stem_markscheme_latex: string | null;
  parts_draft_latex: string | null;
  parts_draft_markscheme_latex: string | null;
}

interface TestItemRow {
  id: string;
  question_number: number;
  part_label: string | null;
  max_marks: number;
  ib_question_code: string | null;
  subtopic_codes: string[] | null;
  sort_order: number | null;
}

/**
 * Minimal structural view of the Supabase client — just the query shapes this
 * resolver uses. Deliberately narrow: matching the full generated client type
 * here makes TypeScript blow its instantiation depth budget (TS2589), so
 * callers pass the client through `asMarkSchemeDb` below.
 */
type QueryResult = { data: unknown[] | null };

export interface MarkSchemeDb {
  from(table: string): {
    select(cols: string): {
      eq(
        col: string,
        val: string
      ): {
        order(col: string, opts: { ascending: boolean }): PromiseLike<QueryResult>;
      };
      in(col: string, vals: string[]): PromiseLike<QueryResult>;
    };
  };
}

/** Narrow a Supabase client to the query surface the resolver needs. */
export function asMarkSchemeDb(client: unknown): MarkSchemeDb {
  return client as MarkSchemeDb;
}

/**
 * Build the mark scheme for every item in a test, using a fallback cascade:
 *
 *   1. question_parts.markscheme_latex   for the exact part   → "part_latex"
 *   2. question_parts.markscheme_text    for the exact part   → "part_text"
 *   3. the question's whole-question (blank-label) part       → "whole_question"
 *   4. ib_questions draft/stem mark scheme LaTeX              → "draft"
 *   5. nothing available                                       → "none"
 *
 * Steps 3 and 4 set `unsegmented`, which matters when a test splits a bank
 * question into parts that the bank itself stores whole (see migration 051).
 */
export async function resolveTestMarkSchemes(
  supabase: MarkSchemeDb,
  testId: string
): Promise<{ items: ResolvedItem[]; coverage: CoverageReport }> {
  const { data: rawItems } = await supabase
    .from("test_items")
    .select(
      "id, question_number, part_label, max_marks, ib_question_code, subtopic_codes, sort_order"
    )
    .eq("test_id", testId)
    .order("sort_order", { ascending: true });

  const testItems = (rawItems ?? []) as TestItemRow[];

  if (testItems.length === 0) {
    return {
      items: [],
      coverage: {
        total_items: 0,
        resolved_items: 0,
        unresolved_items: 0,
        unsegmented_items: 0,
        by_source: { part_latex: 0, part_text: 0, whole_question: 0, draft: 0, none: 0 },
        warnings: ["This test has no questions defined."],
      },
    };
  }

  const codes = [
    ...new Set(testItems.map((i) => norm(i.ib_question_code)).filter(Boolean)),
  ];

  const { data: rawQuestions } = codes.length
    ? await supabase
        .from("ib_questions")
        .select(
          "id, code, stem_latex, stem_markscheme_latex, parts_draft_latex, parts_draft_markscheme_latex"
        )
        .in("code", codes)
    : { data: [] };

  const questions = (rawQuestions ?? []) as QuestionRow[];
  const questionByCode = new Map(questions.map((q) => [q.code, q]));

  const { data: rawParts } = questions.length
    ? await supabase
        .from("question_parts")
        .select(
          "question_id, part_label, content_latex, content_text, markscheme_latex, markscheme_text, sort_order"
        )
        .in(
          "question_id",
          questions.map((q) => q.id)
        )
    : { data: [] };

  const parts = (rawParts ?? []) as QuestionPartRow[];
  const partsByQuestion = new Map<string, QuestionPartRow[]>();
  for (const p of parts) {
    const list = partsByQuestion.get(p.question_id) ?? [];
    list.push(p);
    partsByQuestion.set(p.question_id, list);
  }

  const by_source: Record<MarkSchemeSource, number> = {
    part_latex: 0,
    part_text: 0,
    whole_question: 0,
    draft: 0,
    none: 0,
  };
  const warnings: string[] = [];
  const resolved: ResolvedItem[] = [];

  for (const item of testItems) {
    const code = norm(item.ib_question_code);
    const question = code ? questionByCode.get(code) : undefined;
    const qParts = question ? partsByQuestion.get(question.id) ?? [] : [];
    const wantLabel = norm(item.part_label);

    const exact = qParts.find((p) => norm(p.part_label) === wantLabel);
    const wholeQuestionPart =
      qParts.length === 1 && norm(qParts[0].part_label) === "" ? qParts[0] : undefined;

    let markscheme = "";
    let markscheme_source: MarkSchemeSource = "none";
    let unsegmented = false;

    if (exact && nonEmpty(exact.markscheme_latex)) {
      markscheme = norm(exact.markscheme_latex);
      markscheme_source = "part_latex";
    } else if (exact && nonEmpty(exact.markscheme_text)) {
      markscheme = norm(exact.markscheme_text);
      markscheme_source = "part_text";
    } else if (
      wholeQuestionPart &&
      (nonEmpty(wholeQuestionPart.markscheme_latex) ||
        nonEmpty(wholeQuestionPart.markscheme_text))
    ) {
      markscheme = nonEmpty(wholeQuestionPart.markscheme_latex)
        ? norm(wholeQuestionPart.markscheme_latex)
        : norm(wholeQuestionPart.markscheme_text);
      markscheme_source = "whole_question";
      unsegmented = wantLabel !== "";
    } else if (
      question &&
      (nonEmpty(question.parts_draft_markscheme_latex) ||
        nonEmpty(question.stem_markscheme_latex))
    ) {
      markscheme = [
        norm(question.stem_markscheme_latex),
        norm(question.parts_draft_markscheme_latex),
      ]
        .filter(Boolean)
        .join("\n\n");
      markscheme_source = "draft";
      unsegmented = true;
    }

    // Question wording, same cascade logic but for the prompt's context section.
    let question_text = "";
    if (exact && nonEmpty(exact.content_latex)) question_text = norm(exact.content_latex);
    else if (exact && nonEmpty(exact.content_text)) question_text = norm(exact.content_text);
    else if (wholeQuestionPart && nonEmpty(wholeQuestionPart.content_latex))
      question_text = norm(wholeQuestionPart.content_latex);
    else if (wholeQuestionPart && nonEmpty(wholeQuestionPart.content_text))
      question_text = norm(wholeQuestionPart.content_text);
    else if (question)
      question_text = [norm(question.stem_latex), norm(question.parts_draft_latex)]
        .filter(Boolean)
        .join("\n\n");

    by_source[markscheme_source] += 1;

    const label = `Q${item.question_number}${wantLabel ? `(${wantLabel})` : ""}`;
    if (markscheme_source === "none") {
      warnings.push(
        `${label} (${code || "no question code"}) has no mark scheme in the bank — it will be skipped.`
      );
    } else if (unsegmented) {
      warnings.push(
        `${label} falls back to the whole-question mark scheme; per-part marks are inferred and flagged lower confidence.`
      );
    }

    resolved.push({
      test_item_id: item.id,
      question_number: item.question_number,
      part_label: wantLabel,
      max_marks: item.max_marks,
      ib_question_code: code,
      subtopic_codes: item.subtopic_codes ?? [],
      question_text,
      markscheme,
      markscheme_source,
      unsegmented,
    });
  }

  const unresolved_items = by_source.none;
  const coverage: CoverageReport = {
    total_items: resolved.length,
    resolved_items: resolved.length - unresolved_items,
    unresolved_items,
    unsegmented_items: resolved.filter((r) => r.unsegmented).length,
    by_source,
    warnings,
  };

  return { items: resolved, coverage };
}

// ─── 3. Prompt layer ─────────────────────────────────────────────────────────

export const AI_GRADING_MODEL = "claude-sonnet-4-6";

export const AI_GRADING_SYSTEM_PROMPT = `You are an experienced IB Diploma Programme Mathematics examiner marking a scanned, handwritten student script against an official IB mark scheme.

MARKING CONVENTIONS
- IB mark codes: M = method, A = accuracy, R = reasoning, AG = answer given.
- Award each mark independently, exactly as the mark scheme specifies. Do not invent marks the scheme does not list.
- M marks are for a correct method, even when the subsequent arithmetic is wrong.
- A marks require the correct value or form. An A mark that depends on an unearned M mark is normally not awarded unless the scheme allows follow-through.
- Apply follow-through generously where the scheme permits it: a correct method applied to an earlier incorrect answer still earns method marks.
- AG (answer given) means the result is printed in the question. Award only if the working genuinely establishes it; do not reward reverse-engineering from the printed answer.
- Accept mathematically equivalent forms, alternative valid methods, and unsimplified but correct answers unless the scheme explicitly requires a particular form.
- Do not deduct marks for untidy presentation, crossed-out work that was replaced, or notation slips that do not obscure the mathematics.
- Never award more than the stated maximum for an item.

READING THE SCRIPT
- The script is a scan of handwritten work and may be rotated, faint, or out of order. Match work to questions using the question numbers and part labels the student wrote, and by matching the mathematics itself to the question.
- If you cannot find any attempt at an item, set "work_found": false, "suggested_marks": 0 and "confidence": "low". Do not guess.
- If handwriting is genuinely ambiguous at a point that decides a mark, award the mark only if the reading that earns it is the more plausible one, and set confidence to "low" with the ambiguity named in "reasoning".

CONFIDENCE
- "high": the work is legible, clearly matched to the item, and the scheme maps onto it cleanly.
- "medium": legible and matched, but requires examiner judgement (equivalent method, partial follow-through, minor ambiguity).
- "low": faint/ambiguous handwriting, uncertain matching, no attempt found, or the mark scheme supplied covers the whole question rather than this part.
- Any item flagged UNSEGMENTED in the brief must be capped at "medium" confidence at best.

OUTPUT
Return ONLY a single JSON object, with no preamble, commentary, or markdown fences:

{
  "items": [
    {
      "test_item_id": "<echo exactly from the brief>",
      "work_found": true,
      "suggested_marks": 3,
      "confidence": "high",
      "evidence": "<what the student actually wrote, transcribed or closely summarised>",
      "reasoning": "<which scheme marks were earned or lost, and why>",
      "mark_breakdown": [
        { "code": "M1", "kind": "M", "awarded": true, "note": "sets up the derivative correctly" },
        { "code": "A1", "kind": "A", "awarded": false, "note": "sign error in the final value" }
      ]
    }
  ]
}

Include one entry for every item listed in the brief, in the same order. "suggested_marks" must equal the number of awarded entries' mark values and must never exceed that item's maximum.`;

/** Render the resolved items into the marking brief sent alongside the scan. */
export function buildGradingBrief(items: ResolvedItem[]): string {
  const gradable = items.filter((i) => i.markscheme_source !== "none");

  const blocks = gradable.map((item) => {
    const label = `Q${item.question_number}${item.part_label ? `(${item.part_label})` : ""}`;
    const lines = [
      `=== ITEM ${label} ===`,
      `test_item_id: ${item.test_item_id}`,
      `maximum marks: ${item.max_marks}`,
      item.ib_question_code ? `IB question code: ${item.ib_question_code}` : "",
      item.unsegmented
        ? `UNSEGMENTED: the mark scheme below covers the whole of Q${item.question_number}, not just part (${item.part_label}). Isolate only the portion that answers this part, and cap confidence at "medium".`
        : "",
      "",
      item.question_text ? `--- Question ---\n${item.question_text}` : "",
      "",
      `--- Mark scheme ---\n${item.markscheme}`,
    ];
    return lines.filter((l) => l !== "").join("\n");
  });

  return [
    `Mark the attached scanned script against the ${gradable.length} item(s) below.`,
    `Return one JSON entry per item, echoing each test_item_id exactly.`,
    "",
    blocks.join("\n\n"),
  ].join("\n");
}

/** Clamp and sanitise a validated model item before it is persisted. */
export function reconcileItem(
  modelItem: AiGradeItem,
  resolved: ResolvedItem
): {
  suggested_marks: number;
  confidence: "high" | "medium" | "low";
  adjusted: boolean;
} {
  let adjusted = false;
  let marks = Math.round(modelItem.suggested_marks);

  if (marks > resolved.max_marks) {
    marks = resolved.max_marks;
    adjusted = true;
  }
  if (marks < 0) {
    marks = 0;
    adjusted = true;
  }

  let confidence = modelItem.confidence;
  // Whole-question fallbacks can never be high-confidence per-part judgements.
  if (resolved.unsegmented && confidence === "high") {
    confidence = "medium";
    adjusted = true;
  }
  if (!modelItem.work_found) {
    confidence = "low";
    marks = 0;
  }

  return { suggested_marks: marks, confidence, adjusted };
}
