/**
 * typst-payload.ts
 * -----------------------------------------------------------------------------
 * The shapes the Typst template consumes, and the two pure functions that
 * build them. No compiler, no native addon, no Node built-ins.
 *
 * WHY THIS IS SEPARATE FROM typst-render.service.ts: the sandbox builds a
 * payload in the browser and POSTs it to /api/typst-render, so a client
 * component transitively imports this code:
 *
 *   app/dashboard/assignments/assignments-client.tsx
 *     -> nuanced-analysis-sandbox.tsx
 *       -> document-orchestrator-nuanced.ts
 *         -> (here)
 *
 * While these declarations lived in typst-render.service.ts, that chain also
 * reached @myriaddreamin/typst-ts-node-compiler -- a native napi addon -- and
 * webpack refused it with "Node.js binary module ... is not supported in the
 * browser", blanking /dashboard/assignments in `npm run dev` entirely. One
 * value import was enough to do it (computeEstimatedMinutes); the rest of what
 * the chain needed was types, which erase.
 *
 * next.config.ts's serverExternalPackages only governs the SERVER bundle, so
 * it could not help here, and `next build` tree-shook the import away, so
 * production and CI stayed green while dev stayed broken.
 *
 * Keep this module free of anything that cannot run in a browser. Whatever
 * needs the compiler belongs in typst-render.service.ts, which re-exports
 * everything here so existing server-side importers are unaffected.
 * -----------------------------------------------------------------------------
 */

// Pure string work, no Node built-ins -- safe on the browser side of the
// chain described above. (Its TEST file imports the native compiler; the
// module itself deliberately does not.)
import { typesetDraftMath, mapDraftProse, spanIsForLatexConversion } from "./math-typesetting";
import { convertLatexSegmentsToTypst } from "./latex-to-typst";

import type { TemplateAst } from "./template-ast.schema";
import type { TeacherCompanion } from "./assignments";
// -- Activity content AST ------------------------------------------------------

/**
 * A MathNode carries a single mathematical expression in Typst native syntax.
 *
 * Example:
 *   { type: "math", display: true, content: "f(x) = x^2 - 4x + 3" }
 *
 * Typst syntax here, and LaTeX everywhere a human or a generator writes: this
 * node is a rendering detail of the payload, not a field of the draft, so it
 * is already past the crossing. Packets are authored in LaTeX inside $...$
 * (the preview renders it with KaTeX) and buildTypstPayload converts those
 * spans on the way out -- see lib/latex-to-typst.ts.
 */
export interface MathNode {
  type: "math";
  display: boolean;
  content: string;
}

/**
 * A labelled rectangle partitioned into cells: the area model.
 *
 * It exists because "draw a rectangle of height x+3 and width x+2, cut it
 * into four and write each area" asks a fourteen-year-old to construct the
 * diagram before they can use it, and the construction is not what is being
 * assessed. Printing the rectangle with its edges labelled and its cells
 * empty puts the whole of the student's effort into the areas.
 *
 * The labels are ordinary packet prose and go through rich(), so they carry
 * $...$ math like any other field.
 */
export interface AreaModelSpec {
  /** Labels along the top edge, left to right. One per column. */
  topLabels: string[];
  /** Labels down the left edge, top to bottom. One per row. */
  sideLabels: string[];
  /**
   * Relative lengths of the columns and rows, in ONE unit shared by both
   * axes: topWeights [5, 2] with sideWeights [5, 3] draws x as a square with
   * a narrow strip of width 2 beside it and a wider strip of height 3 below.
   * Getting this right is not decoration -- a model whose x reads shorter
   * going down than going across contradicts the algebra it is illustrating.
   * Omit both for equal cells.
   */
  topWeights?: number[];
  sideWeights?: number[];
  /**
   * Pre-filled cell contents, row-major, as a worked or partly worked
   * example. Omit it, or leave an entry empty, for a cell the student fills.
   */
  cells?: string[][];
  /** One line under the figure saying what to do with it. */
  caption?: string;
}

/**
 * AnswerBoxSpec defines the answer space for a single question.
 */
export interface AnswerBoxSpec {
  kind: "blank" | "lined" | "grid" | "structured";
  heightMm: number;
  lineSpacingMm: number;
  /**
   * Column spec for a "structured" box, ignored by every other kind. Weights
   * are relative, so (4, 2, 8) reads as a wide first column, a narrow middle
   * and a wide last -- the shape a reflection table needs when the middle
   * column holds only a question number.
   */
  columns?: Array<{ header: string; weight: number }>;
  continuation: {
    enabled: boolean;
    label: string;
  };
}

/**
 * A cohesion override for a single question block.
 * If present, overrides the template-level QuestionBlockSettings.
 */
export interface QuestionCohesionOverride {
  keepPromptWithAnswerBox?: boolean;
  allowAnswerContinuation?: boolean;
  minimumUsefulAnswerBoxHeightMm?: number;
}

/**
 * ActivityQuestion is one question in the content AST.
 */
export interface ActivityQuestion {
  id: string;
  /** Global question number (1-indexed, set by the orchestrator). */
  globalNumber: number;
  /** Marks awarded for this question. */
  marks: number;
  /** Estimated minutes, computed from template pacing formula. */
  estimatedMinutes: number;
  /** Tier: 1 = ★ (entry), 2 = ★★ (standard), 3 = ★★★ (extension). */
  tier: 1 | 2 | 3;
  /**
   * Question prompt in plain text, with its mathematics in $...$ spans.
   *
   * Those spans hold LaTeX as the generator wrote them and as the preview
   * renders them; buildTypstPayload rewrites them into trusted Typst
   * before the compiler sees this field. See lib/latex-to-typst.ts.
   */
  prompt: string;
  answerBox: AnswerBoxSpec;
  /** Printed between the prompt and the answer space. */
  areaModel?: AreaModelSpec;
  cohesionOverride?: QuestionCohesionOverride;
  subparts?: ActivityQuestion[];
  /** Expected answer for the Teacher's Companion / mark scheme. */
  answer?: string;
  hint?: string;
}

/**
 * ActivitySection is one Part in the content AST.
 */
export interface ActivitySection {
  id: string;
  /** e.g. "Part 0 — Activating Prior Knowledge" */
  heading: string;
  partNumber: number;
  prerequisiteBox?: {
    items: string[];
  };
  spotlight?: {
    title: string;
    body: string;
  };
  translationTable?: {
    caption: string;
    rows: Array<{ informal: string; formal: string }>;
  };
  geometricReading?: {
    body: string;
  };
  questions: ActivityQuestion[];
}

/**
 * TOK provocation — two are required per DESIGN_INSTRUCTIONS.
 */
export interface TokProvocation {
  id: string;
  body: string;
}

/**
 * International Mindedness box.
 */
export interface InternationalMindednessBox {
  body: string;
}

/**
 * The full content AST merged with the template at render time.
 */
export interface ActivityContentAst {
  title: string;
  subtitle?: string;
  course?: string;
  syllabusTopics?: string;
  prerequisites?: string;
  materials?: string;
  /**
   * DESIGN_INSTRUCTIONS 2.4. Authored by the generator and shown in the live
   * preview, but it had no slot here at all, so it could never reach a PDF.
   */
  atl?: string;
  compulsoryCore?: string;
  tokProvocations?: TokProvocation[];
  internationalMindedness?: InternationalMindednessBox;
  commandTerms?: Array<{ term: string; definition: string }>;
  /**
   * Instructor-only pacing and teaching notes, printed only when
   * renderOptions.includeTeacherCompanion is set. Deliberately NOT a section:
   * a section prints in every copy, this prints in one.
   */
  teacherCompanion?: TeacherCompanion;
  sections: ActivitySection[];
}

// -- Merged payload ------------------------------------------------------------

/**
 * ActivityPayload is what TypstRenderService receives.
 * It bundles the validated template AST with the content AST.
 */
export interface ActivityPayload {
  template: TemplateAst;
  content: ActivityContentAst;
  renderOptions?: {
    /** If true, include the Teacher's Companion in the PDF. */
    includeTeacherCompanion?: boolean;
    /** If true, include the Answer Key section. */
    includeAnswerKey?: boolean;
    /** Page count limit — warn if exceeded but do not truncate. */
    pageCountWarningThreshold?: number;
  };
  metadata?: {
    generatedAt?: string;
    generatedBy?: string;
    platformVersion?: string;
  };
}
// -- Pacing calculation --------------------------------------------------------

/**
 * Compute estimated minutes from marks using the template pacing formula.
 * Default: round(marks * 12 / 11) — IB convention.
 */
export function computeEstimatedMinutes(
  marks: number,
  numerator = 12,
  denominator = 11
): number {
  return Math.round((marks * numerator) / denominator);
}

// -- JSON payload builder ------------------------------------------------------

/**
 * Converts an ActivityPayload into a JSON-serialisable object.
 * This object is passed into the Typst template via Typst's json() function.
 */
export function buildTypstPayload(
  payload: ActivityPayload
): Record<string, unknown> {
  const { template, content, renderOptions = {}, metadata = {} } = payload;

  // Annotate questions with pacing
  const annotatedSections = content.sections.map((section) => ({
    ...section,
    questions: section.questions.map((q) => ({
      ...q,
      estimatedMinutes:
        q.estimatedMinutes ??
        computeEstimatedMinutes(
          q.marks,
          template.questionBlocks.minutesPerMarkNumerator,
          template.questionBlocks.minutesPerMarkDenominator
        ),
    })),
  }));

  // Typeset any mathematics that is still undelimited. sanitizeDraft() already
  // does this for anything generated from now on, but packets saved BEFORE
  // that existed -- A.1, A.2 and the first B.4 among them -- are stored with
  // bare ASCII equations, and this is the only point every render passes
  // through. Idempotent, so a correctly delimited packet is unchanged.
  const typesetContent = typesetDraftMath({
    ...content,
    sections: annotatedSections,
  });

  // Then translate the mathematics into the language the compiler reads.
  //
  // Packets are AUTHORED in LaTeX -- that is what the on-screen preview
  // renders with KaTeX, and what every other mathematical surface in this
  // codebase stores -- and Typst does not know what a backslash is. This is
  // the one point every render passes through, so it is where the crossing
  // happens: each $...$ span holding LaTeX becomes pre-converted Typst,
  // marked trusted so rich() evaluates it directly. A span with no backslash
  // in it is legacy Typst syntax from a packet saved before the switch, and
  // is left exactly as it was, still guarded by rich()'s own identifier gate.
  //
  // See lib/latex-to-typst.ts.
  const renderableContent = mapDraftProse(typesetContent, (text) =>
    convertLatexSegmentsToTypst(text, spanIsForLatexConversion),
  );

  return {
    schemaVersion: template.schemaVersion,
    template,
    content: renderableContent,
    renderOptions,
    metadata: {
      generatedAt: metadata.generatedAt ?? new Date().toISOString(),
      generatedBy: metadata.generatedBy ?? "CleverPlatform",
      platformVersion: metadata.platformVersion ?? "1.0.0",
    },
  };
}
