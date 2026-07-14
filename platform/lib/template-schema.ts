/**
 * template-schema.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Zod runtime validation schemas for every CleverPlatform document template
 * object.  These are the single source of truth for what shape is accepted by
 * the DocumentOrchestratorService and by the Supabase template-save endpoint.
 *
 * Why Zod instead of AJV / JSON Forms:
 *  - Zod infers TypeScript types directly — no decorator boilerplate.
 *  - Tree-shakeable; the full Zod bundle is ~12 KB gzipped vs AJV's ~30 KB +
 *    ajv-ts-schema's additional weight.
 *  - Works on both Node.js (API routes) and the browser (client-side preview)
 *    without WASM or worker threads.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { z } from "zod";

// ── Primitives ────────────────────────────────────────────────────────────────

export const FormattingRequirementsSchema = z.object({
  schoolName: z.string().min(1, "School name required"),
  teacherName: z.string(),
  includeNameLine: z.boolean(),
  includeDateLine: z.boolean(),
  includeMarksColumn: z.boolean(),
  includeAnswerKey: z.boolean(),
  fontSize: z.union([z.literal(10), z.literal(11), z.literal(12)]),
  lineSpacing: z.enum(["compact", "normal", "relaxed"]),
  pageMarginsMm: z.union([z.literal(12), z.literal(16), z.literal(20)]),
  numberingStyle: z.enum(["numeric", "lettered"]),
  /** Optional: number of ruled writing lines per answer box (default 4) */
  answerBoxLines: z.number().int().min(1).max(20).optional(),
  /** Optional: height of each answer line in mm (default 12mm) */
  answerLineHeightMm: z.number().min(6).max(16).default(12),
  /** Optional: answer space style — bordered boxes, bare lines, or none */
  answerStyle: z.enum(["boxes", "lines", "none"]).optional(),
});

export type ValidatedFormattingRequirements = z.infer<typeof FormattingRequirementsSchema>;

// ── Question / Section hierarchy ─────────────────────────────────────────────

export const QuestionSubpartSchema = z.object({
  prompt: z.string().min(1),
  marks: z.number().int().min(0).max(20).optional(),
  hint: z.string().optional(),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
});

export const AssignmentQuestionSchema = z.object({
  prompt: z.string().min(1, "Question prompt cannot be empty"),
  marks: z.number().int().min(0).max(20).optional(),
  answer: z.string().optional(),
  ccss: z.array(z.string()).optional(),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  hint: z.string().optional(),
  subparts: z.array(QuestionSubpartSchema).optional(),
});

export const SpotlightBoxSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
});

export const PrerequisiteBoxSchema = z.object({
  items: z.array(z.string().min(1)).min(1).max(8),
});

export const TranslationTableSchema = z.object({
  caption: z.string().min(1),
  rows: z
    .array(
      z.object({
        informal: z.string().min(1),
        formal: z.string().min(1),
      })
    )
    .min(1),
});

export const GeometricReadingSchema = z.object({
  body: z.string().min(1),
});

export const AssignmentSectionSchema = z.object({
  heading: z.string().min(1, "Section heading cannot be empty"),
  questions: z
    .array(AssignmentQuestionSchema)
    .min(1, "Section must have at least one question"),
  prerequisiteBox: PrerequisiteBoxSchema.optional(),
  spotlight: SpotlightBoxSchema.optional(),
  translationTable: TranslationTableSchema.optional(),
  geometricReading: GeometricReadingSchema.optional(),
});

export const CommandTermEntrySchema = z.object({
  term: z.string().min(1),
  definition: z.string().min(1),
});

export const TokProvocationSchema = z.object({
  id: z.string().optional(),
  body: z.string().min(1),
});

export const InternationalMindednessBoxSchema = z.object({
  body: z.string().min(1),
});

// ── Top-level draft ───────────────────────────────────────────────────────────

export const AssignmentDraftSchema = z.object({
  title: z.string().min(1, "Title cannot be empty"),
  subtitle: z.string(),
  instructions: z
    .array(z.string().min(1))
    .min(1, "At least one instruction required"),
  sections: z
    .array(AssignmentSectionSchema)
    .min(1, "At least one section required"),
  // Optional Nuanced Analysis header fields
  course: z.string().optional(),
  syllabusTopics: z.string().optional(),
  prerequisites: z.string().optional(),
  materials: z.string().optional(),
  atl: z.string().optional(),
  compulsoryCore: z.string().optional(),
  commandTerms: z.array(CommandTermEntrySchema).optional(),
  tokProvocations: z.array(TokProvocationSchema).optional(),
  internationalMindedness: InternationalMindednessBoxSchema.optional(),
});

export type ValidatedAssignmentDraft = z.infer<typeof AssignmentDraftSchema>;

// ── Full PDF request (what the API route receives) ────────────────────────────
//
// NOTE: this schema previously only declared title/subtitle/instructions/
// sections(heading+questions)/formatting. Zod strips any key not declared
// here by default, so course/syllabusTopics/prerequisites/materials/atl/
// tokProvocations/internationalMindedness/commandTerms — and every per-section
// prerequisiteBox/spotlight/translationTable/geometricReading — were being
// silently dropped before buildHtml() in document-orchestrator.ts ever saw
// them, even though buildHtml() already has full rendering support for all of
// them. Declaring the fields here (reusing the schemas already defined above)
// is what actually turns that existing rendering code on.

export const AssignmentPdfRequestSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string(),
  instructions: z.array(z.string()),
  sections: z.array(
    z.object({
      heading: z.string().min(1),
      questions: z.array(
        z.object({
          prompt: z.string().min(1),
          marks: z.number().int().min(0).max(20).optional(),
          answer: z.string().optional(),
          tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
          hint: z.string().optional(),
          answerBoxLines: z.number().int().min(1).max(20).optional(),
          subparts: z.array(z.object({
            prompt: z.string().min(1),
            marks: z.number().int().min(0).max(20).optional(),
            hint: z.string().optional(),
            tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
          })).optional(),
        })
      ).min(1),
      prerequisiteBox: PrerequisiteBoxSchema.optional(),
      spotlight: SpotlightBoxSchema.optional(),
      translationTable: TranslationTableSchema.optional(),
      geometricReading: GeometricReadingSchema.optional(),
    })
  ),
  formatting: FormattingRequirementsSchema,
  // Nuanced Analysis header fields — see note above.
  course: z.string().optional(),
  syllabusTopics: z.string().optional(),
  prerequisites: z.string().optional(),
  materials: z.string().optional(),
  atl: z.string().optional(),
  compulsoryCore: z.string().optional(),
  commandTerms: z.array(CommandTermEntrySchema).optional(),
  tokProvocations: z.array(TokProvocationSchema).optional(),
  internationalMindedness: InternationalMindednessBoxSchema.optional(),
});

export type ValidatedAssignmentPdfRequest = z.infer<typeof AssignmentPdfRequestSchema>;

// ── Template save payload (Supabase insert) ───────────────────────────────────

export const AssignmentInputSchema = z.object({
  gradeLevel: z.enum(["Grade 9", "Grade 10", "Grade 11", "Grade 12"]),
  documentKind: z.enum(["activity-sheet", "practice-set", "investigation"]),
  title: z.string().min(1),
  topic: z.string().min(1),
  learningGoals: z.string(),
  contextNotes: z.string(),
  questionCount: z.number().int().min(1).max(50),
  challengeMix: z.enum(["foundational", "balanced", "challenge-forward"]),
  includeRealWorldContext: z.boolean(),
  tone: z.enum(["clear", "exam-style", "discovery"]),
});

export const TemplateSavePayloadSchema = z.object({
  templateName: z.string().min(1).max(120),
  gradeLevel: z.enum(["Grade 9", "Grade 10", "Grade 11", "Grade 12"]),
  documentKind: z.enum(["activity-sheet", "practice-set", "investigation"]),
  formattingRequirements: FormattingRequirementsSchema,
  assignmentInput: AssignmentInputSchema,
});

export type ValidatedTemplateSavePayload = z.infer<typeof TemplateSavePayloadSchema>;

// ── Validation helpers ────────────────────────────────────────────────────────

/**
 * Validates a PDF request body coming in from the API route.
 * Returns { success: true, data } or { success: false, error: string }.
 */
export function validatePdfRequest(
  raw: unknown
): { success: true; data: ValidatedAssignmentPdfRequest } | { success: false; error: string } {
  const result = AssignmentPdfRequestSchema.safeParse(raw);
  if (result.success) return { success: true, data: result.data };
  const issues = result.error.issues
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join("; ");
  return { success: false, error: `Template validation failed — ${issues}` };
}

/**
 * Validates a template save payload before writing to Supabase.
 */
export function validateTemplateSavePayload(
  raw: unknown
): { success: true; data: ValidatedTemplateSavePayload } | { success: false; error: string } {
  const result = TemplateSavePayloadSchema.safeParse(raw);
  if (result.success) return { success: true, data: result.data };
  const issues = result.error.issues
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join("; ");
  return { success: false, error: `Template payload invalid — ${issues}` };
}
