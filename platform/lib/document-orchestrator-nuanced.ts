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
 * Coerce a value to a trimmed, non-empty string, or null if it isn't one.
 * AI-generated JSON occasionally omits a nested field, sends null, or sends a
 * non-string — and the Typst template accesses these fields via direct
 * dictionary access (not the safer `.at(key, default:)` form) for readability.
 * A missing key on the Typst side is a HARD COMPILE FAILURE for the entire
 * document (confirmed empirically: "dictionary does not contain key ..."),
 * so every enrichment box below must be entirely PRESENT-AND-VALID or entirely
 * OMITTED — there is no safe way to partially include one.
 */
function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Sanitise a prerequisiteBox: only include if `.items` is a real array of
 * usable strings. A missing/empty/malformed `.items` would crash Typst's
 * `for item in section.prerequisiteBox.items` — so if nothing survives,
 * the whole box is omitted (matches how the Typst template already treats a
 * fully-absent prerequisiteBox: `if "prerequisiteBox" in section`).
 */
function sanitisePrerequisiteBox(
  box: AssignmentSection["prerequisiteBox"]
): AssignmentSection["prerequisiteBox"] | undefined {
  if (!box || !Array.isArray(box.items)) return undefined;
  const items = box.items
    .map((item) => nonEmptyString(item))
    .filter((item): item is string => item !== null);
  return items.length > 0 ? { items } : undefined;
}

/**
 * Sanitise a spotlight box: BOTH title and body must be present, since the
 * Typst callout-box label is built as `"...Spotlight: " + section.spotlight.title`
 * and the body is rendered separately — a spotlight missing either half isn't
 * meaningful, so it's safer to omit the whole box than guess a placeholder.
 */
function sanitiseSpotlight(
  spotlight: AssignmentSection["spotlight"]
): AssignmentSection["spotlight"] | undefined {
  if (!spotlight) return undefined;
  const title = nonEmptyString(spotlight.title);
  const body = nonEmptyString(spotlight.body);
  return title && body ? { title, body } : undefined;
}

/**
 * Sanitise a translation table: caption defaults to a sensible generic label
 * (rather than dropping a genuinely useful table over one missing label), and
 * each row is kept only if BOTH informal and formal sides are present —
 * partial rows are dropped individually instead of failing the whole table.
 * If no valid rows survive, the table is omitted entirely (an empty
 * `for row in ...rows` loop is harmless in Typst, but a table with zero rows
 * has no value to a teacher either).
 */
function sanitiseTranslationTable(
  table: AssignmentSection["translationTable"]
): AssignmentSection["translationTable"] | undefined {
  if (!table || !Array.isArray(table.rows)) return undefined;
  const rows = table.rows
    .map((row) => {
      const informal = nonEmptyString(row?.informal);
      const formal = nonEmptyString(row?.formal);
      return informal && formal ? { informal, formal } : null;
    })
    .filter((row): row is { informal: string; formal: string } => row !== null);
  if (rows.length === 0) return undefined;
  const caption = nonEmptyString(table.caption) ?? "Translating informal language into IB rigor";
  return { caption, rows };
}

/**
 * Sanitise a geometricReading box: only include if `.body` is usable.
 */
function sanitiseGeometricReading(
  reading: AssignmentSection["geometricReading"]
): AssignmentSection["geometricReading"] | undefined {
  if (!reading) return undefined;
  const body = nonEmptyString(reading.body);
  return body ? { body } : undefined;
}

/**
 * Sanitise commandTerms: keep only entries with both a term and a definition.
 * Typst accesses `ct.term` / `ct.definition` directly for every surviving
 * entry inside the table() call, so a partial entry would crash the compile.
 */
function sanitiseCommandTerms(
  terms: NuancedDraft["commandTerms"]
): NuancedDraft["commandTerms"] | undefined {
  if (!Array.isArray(terms)) return undefined;
  const cleaned = terms
    .map((ct) => {
      const term = nonEmptyString(ct?.term);
      const definition = nonEmptyString(ct?.definition);
      return term && definition ? { term, definition } : null;
    })
    .filter((ct): ct is { term: string; definition: string } => ct !== null);
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Sanitise tokProvocations: keep only entries with a usable body. Typst
 * accesses `tok.body` directly for every entry in the enumerate() loop.
 */
function sanitiseTokProvocations(
  toks: NuancedDraft["tokProvocations"]
): NuancedDraft["tokProvocations"] | undefined {
  if (!Array.isArray(toks)) return undefined;
  const cleaned = toks
    .map((tok, i) => {
      const body = nonEmptyString(tok?.body);
      return body ? { id: nonEmptyString(tok?.id) ?? `tok${i + 1}`, body } : null;
    })
    .filter((tok): tok is { id: string; body: string } => tok !== null);
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Sanitise internationalMindedness: only include if `.body` is usable.
 */
function sanitiseInternationalMindedness(
  im: NuancedDraft["internationalMindedness"]
): NuancedDraft["internationalMindedness"] | undefined {
  if (!im) return undefined;
  const body = nonEmptyString(im.body);
  return body ? { body } : undefined;
}

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

  const prerequisiteBox = sanitisePrerequisiteBox(s.prerequisiteBox);
  const spotlight = sanitiseSpotlight(s.spotlight);
  const translationTable = sanitiseTranslationTable(s.translationTable);
  const geometricReading = sanitiseGeometricReading(s.geometricReading);

  return {
    id: `part-${partNumber}`,
    heading: s.heading,
    partNumber,
    questions,
    ...(prerequisiteBox ? { prerequisiteBox } : {}),
    ...(spotlight ? { spotlight } : {}),
    ...(translationTable ? { translationTable } : {}),
    ...(geometricReading ? { geometricReading } : {}),
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

      const commandTerms = sanitiseCommandTerms(nd.commandTerms);
      const tokProvocations = sanitiseTokProvocations(nd.tokProvocations);
      const internationalMindedness = sanitiseInternationalMindedness(
        nd.internationalMindedness
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
        ...(commandTerms ? { commandTerms } : {}),
        ...(tokProvocations ? { tokProvocations } : {}),
        ...(internationalMindedness ? { internationalMindedness } : {}),
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
