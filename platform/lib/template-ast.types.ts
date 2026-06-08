/**
 * template-ast.types.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * TypeScript types for the CleverPlatform Nuanced Analysis TemplateAst.
 *
 * These types are inferred from the Zod schemas in template-ast.schema.ts.
 * Do not write them by hand — import from there.
 *
 * They are re-exported here as a convenience barrel so consumers
 * can import from one file without importing the full Zod runtime.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type {
  TemplateAst,
  DocumentSettings,
  TypographySettings,
  ColorSettings,
  SpacingSettings,
  HeaderSettings,
  FooterSettings,
  QuestionBlockSettings,
  AnswerBoxSettings,
  MathSettings,
  GraphSettings,
  ConnectionSettings,
  CohesionSettings,
  ProgressTrackerSettings,
} from "./template-ast.schema";
