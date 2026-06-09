/**
 * document-orchestrator-nuanced.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * DocumentOrchestratorService for Nuanced Analysis.
 *
 * Responsibility: accept a NuancedDraft (the shape produced by the AI
 * generator and stored in the frontend state), merge it with a TemplateAst,
 * and return a fully-typed ActivityPayload ready for TypstRenderService.
 *
 * This service is the "Phase 5" orchestrator described in
 * 02_CleverPlatform_Document_Generation_Architecture.md, scoped to the
 * Nuanced Analysis document kind.
 *
 * Service boundary:
 *   Input  → NuancedDraft (lib/assignments.ts) + TemplateAst
 *   Output → ActivityPayload (lib/typst-render.service.ts)
 *
 * The orchestrator does NOT call the Typst renderer itself.
 * The caller is responsible for passing the returned payload to
 * TypstRenderService.render().
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { TemplateAst } from "./template-ast.schema";
import { DEFAULT_NUANCED_ANALYSIS_TEMPLATE } from "./template-ast-defaults";
import {
  computeEstimatedMinutes,
  type ActivityPayload,
  type ActivityContentAst,
  type ActivitySection,
  type ActivityQuestion,
  type AnswerBoxSpec,
} from "./typst-render.service";
import type {
  AssignmentDraft,
  AssignmentSection,
  AssignmentQuestion,
} from "./assignments";

// ── NuancedDraft shape (extended from AssignmentDraft) ────────────────────────
// We re-declare only the extra fields here to avoid a circular import.
// The main NuancedDraft interface lives in nuanced-analysis-preview.tsx.

interface NuancedDraftExtra {
  tokProvocations?: Array<{ id: string; body: string }>;
  internationalMindedness?: { body: string };
  compulsoryCore?: string;
  plantedErrorIntro?: string;
  reflectionQuestions?: string[];
}

type NuancedDraft = AssignmentDraft & NuancedDraftExtra;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Derive an AnswerBoxSpec for a single question.
 * Uses per-question answerBoxLines if present, else the template default.
 */
function buildAnswerBoxSpec(
  q: AssignmentQuestion,
  template: TemplateAst
): AnswerBoxSpec {
  const lines = q.answerBoxLines ?? 0;
  // Convert lines → mm: each line is lineSpacingMm, minimum defaultHeightMm.
  const heightFromLines =
    lines > 0
      ? lines * template.answerBoxes.lineSpacingMm
      : template.answerBoxes.defaultHeightMm;
  const heightMm = Math.max(
    heightFromLines,
    template.questionBlocks.minimumUsefulAnswerBoxHeightMm
  );

  return {
    kind: template.answerBoxes.defaultKind,
    heightMm,
    lineSpacingMm: template.answerBoxes.lineSpacingMm,
    continuation: {
      enabled: template.answerBoxes.continuationEnabled,
      label: template.answerBoxes.continuationLabel,
    },
  };
}

/**
 * Map a single AssignmentQuestion to an ActivityQuestion.
 * globalCounter is passed by reference (mutated) to track global numbering.
 */
function mapQuestion(
  q: AssignmentQuestion,
  globalCounter: { n: number },
  template: TemplateAst
): ActivityQuestion {
  globalCounter.n += 1;
  const marks = q.marks ?? 0;
  const estimatedMinutes = computeEstimatedMinutes(
    marks,
    template.questionBlocks.minutesPerMarkNumerator,
    template.questionBlocks.minutesPerMarkDenominator
  );

  const aq: ActivityQuestion = {
    id: `q${globalCounter.n}`,
    globalNumber: globalCounter.n,
    marks,
    estimatedMinutes,
    tier: (q.tier as 1 | 2 | 3) ?? 1,
    prompt: q.prompt,
    answerBox: buildAnswerBoxSpec(q, template),
    ...(q.hint ? { hint: q.hint } : {}),
    ...(q.answer ? { answer: q.answer } : {}),
  };

  // Recurse for sub-parts
  if (Array.isArray(q.subparts) && q.subparts.length > 0) {
    aq.subparts = q.subparts.map((sp) => {
      globalCounter.n += 1;
      return {
        id: `q${globalCounter.n}`,
        globalNumber: globalCounter.n,
        marks: sp.marks ?? 0,
        estimatedMinutes: computeEstimatedMinutes(
          sp.marks ?? 0,
          template.questionBlocks.minutesPerMarkNumerator,
          template.questionBlocks.minutesPerMarkDenominator
        ),
        tier: (sp.tier as 1 | 2 | 3) ?? 1,
        prompt: sp.prompt,
        answerBox: buildAnswerBoxSpec(
          { ...sp, answerBoxLines: undefined },
          template
        ),
        ...(sp.hint ? { hint: sp.hint } : {}),
      };
    });
  }

  return aq;
}

/**
 * Map a single AssignmentSection to an ActivitySection.
 */
function mapSection(
  s: AssignmentSection,
  partNumber: number,
  globalCounter: { n: number },
  template: TemplateAst
): ActivitySection {
  const questions = s.questions.map((q) =>
    mapQuestion(q, globalCounter, template)
  );

  return {
    id: `part-${partNumber}`,
    heading: s.heading,
    partNumber,
    questions,
    ...(s.prerequisiteBox ? { prerequisiteBox: s.prerequisiteBox } : {}),
    ...(s.spotlight
      ? { spotlight: { title: s.spotlight.title, body: s.spotlight.body } }
      : {}),
    ...(s.translationTable
      ? {
          translationTable: {
            caption: s.translationTable.caption,
            rows: s.translationTable.rows.map((r) => ({
              informal: r.informal,
              formal: r.formal,
            })),
          },
        }
      : {}),
    ...(s.geometricReading
      ? { geometricReading: { body: s.geometricReading.body } }
      : {}),
  };
}

// ── DocumentOrchestratorService ───────────────────────────────────────────────

export type OrchestratorResult =
  | { success: true; payload: ActivityPayload }
  | { success: false; error: string };

export const DocumentOrchestratorService = {
  /**
   * Build an ActivityPayload from a NuancedDraft.
   *
   * Steps:
   *   1. Accept a NuancedDraft and an optional TemplateAst override.
   *      Falls back to DEFAULT_NUANCED_ANALYSIS_TEMPLATE if none supplied.
   *   2. Map every section and question, tracking global question numbers.
   *   3. Populate TOK, IM, commandTerms, and other header fields.
   *   4. Return the merged ActivityPayload.
   */
  build(
    draft: AssignmentDraft,
    templateOverride?: TemplateAst,
    renderOptions?: ActivityPayload["renderOptions"]
  ): OrchestratorResult {
    try {
      const nd = draft as NuancedDraft;
      const template = templateOverride ?? DEFAULT_NUANCED_ANALYSIS_TEMPLATE;

      const globalCounter = { n: 0 };

      const sections: ActivitySection[] = nd.sections.map((s, i) =>
        mapSection(s, i, globalCounter, template)
      );

      const content: ActivityContentAst = {
        title: nd.title || "Nuanced Analysis",
        subtitle:
          nd.subtitle ||
          "IBDP Mathematics — Analysis & Approaches HL · Nuanced Analysis",
        course: nd.course,
        syllabusTopics: nd.syllabusTopics,
        prerequisites: nd.prerequisites,
        materials: nd.materials,
        compulsoryCore: nd.compulsoryCore,
        sections,
        ...(Array.isArray(nd.commandTerms) && nd.commandTerms.length > 0
          ? { commandTerms: nd.commandTerms }
          : {}),
        ...(Array.isArray(nd.tokProvocations) && nd.tokProvocations.length > 0
          ? { tokProvocations: nd.tokProvocations }
          : {}),
        ...(nd.internationalMindedness
          ? { internationalMindedness: nd.internationalMindedness }
          : {}),
      };

      const payload: ActivityPayload = {
        template,
        content,
        renderOptions: renderOptions ?? {
          includeTeacherCompanion: false,
          includeAnswerKey: false,
        },
        metadata: {
          generatedAt: new Date().toISOString(),
          generatedBy: "CleverPlatform",
          platformVersion: "1.0.0",
        },
      };

      return { success: true, payload };
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : "DocumentOrchestratorService failed.",
      };
    }
  },
};
