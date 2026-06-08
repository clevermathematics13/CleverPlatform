/**
 * template-ast.schema.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Zod schemas for the CleverPlatform Nuanced Analysis TemplateAst.
 *
 * These schemas are the single source of truth for:
 *   1. TypeScript types (inferred by Zod).
 *   2. Runtime validation before any template is saved to Supabase.
 *   3. The JSON payload that DocumentOrchestratorService accepts.
 *   4. The JSON payload the Typst render service accepts.
 *
 * Architecture:
 *   - All 13 settings blocks from the project spec are represented.
 *   - additionalProperties: false is enforced by Zod's .strict() on each object.
 *   - Schema version is embedded so future migrations can be tracked.
 *
 * Usage:
 *   import { TemplateAstSchema, validateTemplateAst } from "@/lib/template-ast.schema";
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { z } from "zod";

// ── Hex colour validator ──────────────────────────────────────────────────────

const hexColor = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, "Must be a 6-digit hex colour (e.g. #1a7a4a)");

// ── 1. Document settings ──────────────────────────────────────────────────────

export const DocumentSettingsSchema = z
  .object({
    pageSize: z.enum(["letter", "a4"]),
    orientation: z.enum(["portrait", "landscape"]),
    marginTopMm: z.number().min(5).max(40),
    marginRightMm: z.number().min(5).max(40),
    marginBottomMm: z.number().min(5).max(40),
    marginLeftMm: z.number().min(5).max(40),
  })
  .strict();

export type DocumentSettings = z.infer<typeof DocumentSettingsSchema>;

// ── 2. Typography settings ────────────────────────────────────────────────────

export const TypographySettingsSchema = z
  .object({
    /** e.g. "Georgia" or "TeX Gyre Pagella" */
    bodyFont: z.string().min(1).max(80),
    headingFont: z.string().min(1).max(80),
    bodySizePt: z.number().min(8).max(14),
    smallSizePt: z.number().min(6).max(12),
    headingScale: z.number().min(1).max(2.5),
    lineHeight: z.number().min(1).max(2),
  })
  .strict();

export type TypographySettings = z.infer<typeof TypographySettingsSchema>;

// ── 3. Colour settings ────────────────────────────────────────────────────────

export const ColorSettingsSchema = z
  .object({
    primary: hexColor,
    secondary: hexColor,
    accent: hexColor,
    muted: hexColor,
    text: hexColor,
    border: hexColor,
    commandTermStrip: hexColor,
    tokBox: hexColor,
    imBox: hexColor,
  })
  .strict();

export type ColorSettings = z.infer<typeof ColorSettingsSchema>;

// ── 4. Spacing settings ───────────────────────────────────────────────────────

export const SpacingSettingsSchema = z
  .object({
    sectionGapMm: z.number().min(2).max(30),
    questionGapMm: z.number().min(1).max(20),
    promptToAnswerGapMm: z.number().min(1).max(15),
    paragraphGapMm: z.number().min(1).max(12),
  })
  .strict();

export type SpacingSettings = z.infer<typeof SpacingSettingsSchema>;

// ── 5. Header settings ────────────────────────────────────────────────────────

export const HeaderSettingsSchema = z
  .object({
    enabled: z.boolean(),
    leftTextMode: z.enum(["documentTitle", "courseName", "custom"]),
    customLeftText: z.string().max(120).optional(),
    centerText: z.string().max(120).optional(),
    rightTextMode: z.enum(["pageNumber", "nameBox", "none"]),
  })
  .strict();

export type HeaderSettings = z.infer<typeof HeaderSettingsSchema>;

// ── 6. Footer settings ────────────────────────────────────────────────────────

export const FooterSettingsSchema = z
  .object({
    enabled: z.boolean(),
    showPageNumber: z.boolean(),
    showTemplateVersion: z.boolean(),
  })
  .strict();

export type FooterSettings = z.infer<typeof FooterSettingsSchema>;

// ── 7. Question block cohesion settings ──────────────────────────────────────

export const QuestionBlockSettingsSchema = z
  .object({
    keepPromptWithAnswerBox: z.boolean(),
    keepStemWithFirstSubQuestion: z.boolean(),
    allowAnswerContinuation: z.boolean(),
    minimumUsefulAnswerBoxHeightMm: z.number().min(10).max(120),
    preferMoveWholeBlockOverTinyContinuation: z.boolean(),
    showMarks: z.boolean(),
    showEstimatedMinutes: z.boolean(),
    /**
     * Pacing formula: estimated minutes = round(marks * numerator / denominator).
     * Default: 12/11 (IB convention).
     */
    minutesPerMarkNumerator: z.number().int().min(1).max(60),
    minutesPerMarkDenominator: z.number().int().min(1).max(60),
  })
  .strict();

export type QuestionBlockSettings = z.infer<typeof QuestionBlockSettingsSchema>;

// ── 8. Answer box settings ────────────────────────────────────────────────────

export const AnswerBoxSettingsSchema = z
  .object({
    defaultKind: z.enum(["blank", "lined", "grid", "structured"]),
    defaultHeightMm: z.number().min(10).max(200),
    lineSpacingMm: z.number().min(4).max(20),
    borderWidthPt: z.number().min(0).max(4),
    continuationEnabled: z.boolean(),
    continuationLabel: z.string().min(1).max(80),
    continuationBoxMinHeightMm: z.number().min(10).max(120),
  })
  .strict();

export type AnswerBoxSettings = z.infer<typeof AnswerBoxSettingsSchema>;

// ── 9. Math settings ─────────────────────────────────────────────────────────

export const MathSettingsSchema = z
  .object({
    /** The target rendering engine. Currently only Typst is supported. */
    engine: z.literal("typst"),
    displayMathSpacingMm: z.number().min(1).max(10),
    inlineMathScale: z.number().min(0.7).max(1.3),
    displayMathScale: z.number().min(0.7).max(1.3),
    measureBeforePlacement: z.boolean(),
  })
  .strict();

export type MathSettings = z.infer<typeof MathSettingsSchema>;

// ── 10. Graph settings ────────────────────────────────────────────────────────

export const GraphSettingsSchema = z
  .object({
    defaultWidthMm: z.number().min(30).max(180),
    defaultHeightMm: z.number().min(30).max(180),
    keepGraphWithPrompt: z.boolean(),
    allowSideBySideComparison: z.boolean(),
  })
  .strict();

export type GraphSettings = z.infer<typeof GraphSettingsSchema>;

// ── 11. TOK / Interdisciplinary connection settings ───────────────────────────

export const ConnectionSettingsSchema = z
  .object({
    enabled: z.boolean(),
    allowedTypes: z
      .array(z.enum(["tok", "interdisciplinary", "realWorld", "technology"]))
      .min(1),
    defaultLabel: z.string().min(1).max(80),
    maxWords: z.number().int().min(10).max(500),
  })
  .strict();

export type ConnectionSettings = z.infer<typeof ConnectionSettingsSchema>;

// ── 12. Spatial cohesion settings ─────────────────────────────────────────────
//
// Mirrors 03_Spatial_Cohesion_and_Pagination_Rules.md exactly.
// These settings are passed into the Typst renderer as layout constraints.

export const CohesionSettingsSchema = z
  .object({
    /**
     * Rule 1: move whole block to next page when it fits exactly.
     * Rule 2: move whole block when minimum answer space would not fit.
     * Rule 3: partial answer box + continuation box when enough space remains.
     */
    continuationThresholdMm: z.number().min(10).max(100),
    /**
     * Minimum height of a continuation answer box.
     * Boxes shorter than this are considered useless (Rule 4).
     */
    continuationBoxMinHeightMm: z.number().min(10).max(120),
    /**
     * If true, never orphan a section heading at the bottom of a page.
     */
    keepSectionHeadingWithFirstQuestion: z.boolean(),
  })
  .strict();

export type CohesionSettings = z.infer<typeof CohesionSettingsSchema>;

// ── 13. Progress tracker settings ────────────────────────────────────────────

export const ProgressTrackerSettingsSchema = z
  .object({
    enabled: z.boolean(),
    label: z.string().min(1).max(80),
  })
  .strict();

export type ProgressTrackerSettings = z.infer<typeof ProgressTrackerSettingsSchema>;

// ── Root TemplateAst ──────────────────────────────────────────────────────────

export const TemplateAstSchema = z
  .object({
    /**
     * Schema version string.
     * Increment when a breaking change is made to any settings block.
     * Format: "YYYY-MM-DD.N" e.g. "2025-06-01.1".
     */
    schemaVersion: z.string().min(1),
    templateId: z.string().min(1),
    templateName: z.string().min(1).max(120),
    document: DocumentSettingsSchema,
    typography: TypographySettingsSchema,
    colors: ColorSettingsSchema,
    spacing: SpacingSettingsSchema,
    header: HeaderSettingsSchema,
    footer: FooterSettingsSchema,
    questionBlocks: QuestionBlockSettingsSchema,
    answerBoxes: AnswerBoxSettingsSchema,
    math: MathSettingsSchema,
    graphs: GraphSettingsSchema,
    connections: ConnectionSettingsSchema,
    cohesion: CohesionSettingsSchema,
    progressTracker: ProgressTrackerSettingsSchema,
  })
  .strict();

export type TemplateAst = z.infer<typeof TemplateAstSchema>;

// ── Validation helpers ────────────────────────────────────────────────────────

export type TemplateAstValidationResult =
  | { success: true; data: TemplateAst }
  | { success: false; error: string; fieldErrors: Record<string, string> };

/**
 * Validates a raw unknown value against the full TemplateAst schema.
 *
 * Returns either:
 *   { success: true, data: TemplateAst }
 *   { success: false, error: string (human-readable), fieldErrors: Record<string,string> }
 */
export function validateTemplateAst(raw: unknown): TemplateAstValidationResult {
  const result = TemplateAstSchema.safeParse(raw);
  if (result.success) return { success: true, data: result.data };

  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join(".") || "root";
    fieldErrors[path] = issue.message;
  }

  const summary = result.error.issues
    .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
    .join("; ");

  return {
    success: false,
    error: `TemplateAst validation failed — ${summary}`,
    fieldErrors,
  };
}
