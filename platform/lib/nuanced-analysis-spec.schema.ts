/**
 * nuanced-analysis-spec.schema.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Zod schema for the CleverPlatform **NuancedAnalysisSpec** — the pedagogical
 * "feel" layer of a Nuanced Analysis template.
 *
 * There are two coordinated template layers in this platform:
 *
 *   1. TemplateAst  (lib/template-ast.schema.ts)  — the "LOOK".
 *        Typography, colour, spacing, answer boxes, spatial cohesion / pagination.
 *        Drives the deterministic Typst renderer.
 *
 *   2. NuancedAnalysisSpec  (THIS FILE)           — the "FEEL".
 *        The pedagogical architecture a packet must obey: the cognitive arc,
 *        the required structural components and their order, the eight universal
 *        design layers, the tier system, planted-error rules, TOK / IM rules,
 *        reflection requirements, the Teacher's Companion contract, the
 *        verification contract, and the flipped → in-class → take-home phase
 *        model. It is compiled deterministically into the generation system
 *        prompt (see nuanced-analysis-spec.compile.ts).
 *
 * This spec is the machine-readable encoding of:
 *   - Nuanced_Analysis_Instructions (ROLE / MODES / REQUIRED PACKET ORDER / …)
 *   - DESIGN_INSTRUCTIONS (1).md    (the eight universal design layers)
 *   - 01_Nuanced_Analysis_Template_Design_Principles.md
 *   - 03_Spatial_Cohesion_and_Pagination_Rules.md  (the layout half lives in TemplateAst)
 *   - the exemplars (Great Unification, Architecture of Chance, Rational Functions)
 *
 * NON-NEGOTIABLE (from 01_…Design_Principles.md §"Non-negotiables"):
 *   Store only validated JSON. No raw HTML / CSS / LaTeX strings as template
 *   configuration. This schema enforces that structurally — every field is a
 *   typed scalar, enum, or structured object; there is no free "html"/"latex"
 *   escape hatch.
 *
 * Usage:
 *   import {
 *     NuancedAnalysisSpecSchema,
 *     validateNuancedAnalysisSpec,
 *   } from "@/lib/nuanced-analysis-spec.schema";
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { z } from "zod";

// ── small reusable pieces ─────────────────────────────────────────────────────

/**
 * A single named, human-readable rule. This is the workhorse shape: it keeps the
 * spec editable and expressive while staying fully validated (no free-form blob).
 */
const RuleSchema = z
  .object({
    id: z.string().min(1).max(80),
    rule: z.string().min(1).max(1200),
    rationale: z.string().max(1200).optional(),
  })
  .strict();

export type SpecRule = z.infer<typeof RuleSchema>;

/** A glossary/command-term entry the packet must define for students. */
const CommandTermEntrySchema = z
  .object({
    term: z.string().min(1).max(60),
    demand: z.string().min(1).max(400),
    /** 0 (lowest output demand, e.g. "write down") … 10 (highest, e.g. "prove"). */
    demandRank: z.number().int().min(0).max(10),
  })
  .strict();

export type CommandTermEntry = z.infer<typeof CommandTermEntrySchema>;

// ── 1. Identity ───────────────────────────────────────────────────────────────

const CourseIdentitySchema = z
  .object({
    programme: z.string().min(1).max(40), // "IBDP"
    subject: z.string().min(1).max(60), // "Mathematics"
    strand: z.enum(["AA", "AI"]), // Analysis & Approaches / Applications & Interpretation
    level: z.enum(["HL", "SL"]),
    label: z.string().min(1).max(120), // "IBDP Mathematics: Analysis & Approaches HL"
    studentAgeRange: z.string().min(1).max(40), // "16–18"
  })
  .strict();

const IdentitySchema = z
  .object({
    specId: z.string().min(1).max(80),
    specVersion: z.string().min(1).max(40), // "YYYY-MM-DD.N"
    name: z.string().min(1).max(160),
    course: CourseIdentitySchema,
    calculatorPolicy: z.enum([
      "paper1-no-calculator",
      "mixed",
      "calculator-allowed",
    ]),
    paperStyles: z
      .array(z.enum(["paper1", "paper2", "paper3"]))
      .min(1)
      .max(3),
    defaultDurationLessons: z.number().int().min(1).max(12),
    lessonLengthMinutes: z.number().int().min(20).max(120),
    pageTargetMin: z.number().int().min(2).max(60),
    pageTargetMax: z.number().int().min(2).max(80),
  })
  .strict();

// ── 2. Core philosophy (the arc + what it is / is not) ────────────────────────

const CorePhilosophySchema = z
  .object({
    definition: z.string().min(1).max(1200),
    /** The cognitive arc, in order. Freeform-but-listed so it stays visible. */
    arc: z.array(z.string().min(1).max(80)).min(4).max(10),
    /** Representation forms the packet must move between (representational fluency). */
    representationForms: z
      .array(
        z.enum([
          "algebraic",
          "graphical",
          "numerical",
          "geometric",
          "verbal",
          "technological",
          "applied",
          "tabular",
        ])
      )
      .min(4),
    /** Anti-patterns — "what this packet is NOT" (DESIGN §9). */
    antiPatterns: z.array(RuleSchema).min(3),
  })
  .strict();

// ── 3. Three-phase delivery model (flipped → in-class → take-home) ────────────
//
// This is the delivery spine the teacher requested. Every generated packet must
// route its Parts into exactly these three phases and label them accordingly.

const PhaseSchema = z
  .object({
    enabled: z.boolean(),
    purpose: z.string().min(1).max(600),
    /** Concrete things this phase must contain. */
    requiredElements: z.array(RuleSchema).min(1),
    /** Which Part numbers (by convention) belong to this phase, as guidance. */
    partAllocationGuidance: z.string().min(1).max(600),
    timingGuidanceMinutes: z.number().int().min(5).max(240),
    deliverables: z.array(z.string().min(1).max(300)).min(1),
    accessibilityNotes: z.array(z.string().min(1).max(400)).default([]),
  })
  .strict();

const ThreePhaseModelSchema = z
  .object({
    enabled: z.literal(true), // this template is defined around the three phases
    flippedClassroom: PhaseSchema,
    inClass: PhaseSchema,
    takeHome: PhaseSchema,
    /** How the three phases must hand off to one another (continuity contract). */
    continuityRules: z.array(RuleSchema).min(1),
  })
  .strict();

// ── 4. Required structural components, in order ───────────────────────────────

const StructuralComponentSchema = z
  .object({
    key: z.string().min(1).max(60),
    label: z.string().min(1).max(120),
    required: z.boolean(),
    /** e.g. "exactly 2", "≥ 1", "0..8" — a human-readable cardinality note. */
    cardinality: z.string().min(1).max(60),
    notes: z.string().max(800).optional(),
  })
  .strict();

const RequiredStructureSchema = z
  .object({
    /** The canonical packet order (REQUIRED PACKET ORDER in the Instructions). */
    order: z.array(StructuralComponentSchema).min(8),
    /** Every Part's internal contract. */
    partContract: z
      .object({
        descriptiveTitleRequired: z.boolean(),
        startsWithWhatYouNeedBox: z.boolean(),
        whatYouNeedBulletMin: z.number().int().min(1).max(6),
        whatYouNeedBulletMax: z.number().int().min(1).max(8),
        standaloneEnterable: z.boolean(),
        maxQuestionsBeforeBreak: z.number().int().min(2).max(10),
        endsWithRepresentationBridgeWhenAppropriate: z.boolean(),
        part0Purpose: z.string().min(1).max(300),
      })
      .strict(),
    numbering: z
      .object({
        continuous: z.boolean(),
        subpartStyle: z.string().min(1).max(40), // "Q4(a), Q4(b)"
      })
      .strict(),
  })
  .strict();

// ── 5. Command terms ──────────────────────────────────────────────────────────

const CommandTermPolicySchema = z
  .object({
    boldFirstUse: z.boolean(),
    boldMainMathematicalObject: z.boolean(),
    oneInstructionPerSentence: z.boolean(),
    separateContextFromTask: z.boolean(),
    henceMustNameEarlierResult: z.boolean(),
    demandScaleRequired: z.boolean(),
    tearOffGlossaryRequired: z.boolean(),
    spotlightRequired: z.boolean(),
    spotlightGuidance: z.string().min(1).max(400),
    /** Canonical AA command terms; also enforced canonically in lib/command-terms.ts. */
    canonicalTerms: z.array(CommandTermEntrySchema).min(8),
  })
  .strict();

// ── 6. The eight universal design layers ──────────────────────────────────────

const DesignLayerSchema = z
  .object({
    layer: z.number().int().min(1).max(8),
    name: z.string().min(1).max(120),
    primaryBeneficiaries: z.array(z.string().min(1).max(80)).min(1),
    rules: z.array(RuleSchema).min(1),
  })
  .strict();

const TierSchema = z
  .object({
    symbol: z.string().min(1).max(6), // ★ / ★★ / ★★★
    name: z.string().min(1).max(60),
    meaning: z.string().min(1).max(300),
    compulsory: z.boolean(),
  })
  .strict();

const ScaffoldLevelSchema = z
  .object({
    level: z.number().int().min(0).max(4),
    name: z.string().min(1).max(60),
    provides: z.string().min(1).max(300),
  })
  .strict();

const DesignLayersSchema = z
  .object({
    layers: z.array(DesignLayerSchema).length(8),
    tiers: z.array(TierSchema).length(3),
    scaffoldHierarchy: z.array(ScaffoldLevelSchema).length(5),
    minimumUsefulScaffoldRule: z.string().min(1).max(400),
    ruleOfFourMinForms: z.number().int().min(2).max(4),
    translationTableRequiredOnDomainTransfer: z.boolean(),
  })
  .strict();

// ── 7. Planted errors ─────────────────────────────────────────────────────────

const PlantedErrorPolicySchema = z
  .object({
    minPerPacket: z.number().int().min(0).max(6),
    maxPerPacket: z.number().int().min(0).max(6),
    exactlyOneErrorPerLine: z.boolean(),
    framePositively: z.boolean(),
    askWhyUnreasonableBeforeLocating: z.boolean(),
    nameMisconceptionInCompanion: z.boolean(),
    mustBeTeachableConceptualNotArithmetic: z.boolean(),
    framingText: z.string().min(1).max(600),
  })
  .strict();

// ── 8. TOK + International-mindedness ──────────────────────────────────────────

const TokPolicySchema = z
  .object({
    countExactly: z.number().int().min(2).max(2),
    mustUseSpecificPacketResults: z.boolean(),
    placedAtTop: z.boolean(),
    returnInReflection: z.boolean(),
    noAbstractOnly: z.boolean(),
    angles: z.array(z.string().min(1).max(200)).min(3),
  })
  .strict();

const InternationalMindednessPolicySchema = z
  .object({
    required: z.boolean(),
    mustBeGenuineHistoricalOrCultural: z.boolean(),
    goBeyondEuler: z.boolean(),
    includeNonEuropeanWhereMathConnects: z.boolean(),
    guidance: z.string().min(1).max(600),
  })
  .strict();

// ── 9. Reflection ─────────────────────────────────────────────────────────────

const ReflectionPolicySchema = z
  .object({
    requiredElements: z.array(RuleSchema).min(3),
    conceptMapTemplateRequired: z.boolean(),
    positionStatementFrameRequired: z.boolean(),
    mentorTextRequired: z.boolean(),
    bulletOptionRequired: z.boolean(),
    oralOptionRequired: z.boolean(),
  })
  .strict();

// ── 10. Teacher's Companion contract ──────────────────────────────────────────

const TeacherCompanionPolicySchema = z
  .object({
    separatedByPageBreak: z.boolean(),
    removedBeforeDistribution: z.boolean(),
    requiredSections: z.array(RuleSchema).min(7),
  })
  .strict();

// ── 11. Verification contract ─────────────────────────────────────────────────

const VerificationPolicySchema = z
  .object({
    requireVerificationReport: z.boolean(),
    checklist: z.array(RuleSchema).min(6),
  })
  .strict();

// ── 12. Accessibility (cross-cutting) ─────────────────────────────────────────

const AccessibilityPolicySchema = z
  .object({
    compulsoryCoreListedOnPageOne: z.boolean(),
    describeSketchDiagramAlternative: z.boolean(),
    explainBulletAlternative: z.boolean(),
    digitalSubmissionSupported: z.boolean(),
    oralAlternativeForReflection: z.boolean(),
    ellMoves: z.array(RuleSchema).min(1),
    neurodivergentMoves: z.array(RuleSchema).min(1),
  })
  .strict();

// ── 13. IA seeding / Toolbox Wondering ────────────────────────────────────────

const IaSeedingPolicySchema = z
  .object({
    minBranches: z.number().int().min(2).max(6),
    branchesFromDifferentTopicAreas: z.boolean(),
    deliberatelyUnderSpecified: z.boolean(),
    toolboxWonderingRequired: z.boolean(),
    toolboxWonderingGuidance: z.string().min(1).max(600),
  })
  .strict();

// ── 14. Voice / tone / platform copy rules ────────────────────────────────────

const VoiceAndCopySchema = z
  .object({
    tone: z.string().min(1).max(400),
    publishingGradeLayout: z.boolean(),
    noPlaceholderData: z.boolean(),
    /** Platform copy rules — enforced verbatim. */
    copyRules: z.array(RuleSchema).min(1),
  })
  .strict();

// ── 15. Output contract (what the generator must emit) ────────────────────────
//
// This is a description of the JSON the generator must produce so it can be
// inserted into the `nuanced_analyses` table. It is NOT raw code — it is a
// structured description the compiler turns into instructions. Each field is
// declared with its JSON type so the model cannot get array-vs-string wrong
// (the historical cause of insert failures).

const OutputFieldSchema = z
  .object({
    field: z.string().min(1).max(60),
    jsonType: z.enum(["string", "string[]", "object", "object[]", "number"]),
    required: z.boolean(),
    description: z.string().min(1).max(600),
  })
  .strict();

const OutputContractSchema = z
  .object({
    targetTable: z.string().min(1).max(60), // "nuanced_analyses"
    fields: z.array(OutputFieldSchema).min(8),
    /** Per-Part phase tagging so each Part declares its delivery phase. */
    partPhaseTagField: z.string().min(1).max(40), // "phase"
    partPhaseTagValues: z
      .array(z.enum(["flipped", "inClass", "takeHome"]))
      .length(3),
    jsonEscapingRules: z.array(z.string().min(1).max(400)).min(3),
    noMarkdownFences: z.boolean(),
  })
  .strict();

// ── 16. Generation hints (model + budget) ─────────────────────────────────────

const GenerationHintsSchema = z
  .object({
    /** Preferred generation model string (see codebase conventions). */
    preferredModel: z.string().min(1).max(60),
    /** Preferred model for the Claude-assisted template EDITING flow. */
    preferredEditingModel: z.string().min(1).max(60),
    maxTokens: z.number().int().min(4000).max(64000),
    adaptiveThinking: z.boolean(),
  })
  .strict();

// ── Root NuancedAnalysisSpec ──────────────────────────────────────────────────

export const NuancedAnalysisSpecSchema = z
  .object({
    identity: IdentitySchema,
    corePhilosophy: CorePhilosophySchema,
    threePhaseModel: ThreePhaseModelSchema,
    requiredStructure: RequiredStructureSchema,
    commandTerms: CommandTermPolicySchema,
    designLayers: DesignLayersSchema,
    plantedErrors: PlantedErrorPolicySchema,
    tok: TokPolicySchema,
    internationalMindedness: InternationalMindednessPolicySchema,
    reflection: ReflectionPolicySchema,
    teacherCompanion: TeacherCompanionPolicySchema,
    verification: VerificationPolicySchema,
    accessibility: AccessibilityPolicySchema,
    iaSeeding: IaSeedingPolicySchema,
    voiceAndCopy: VoiceAndCopySchema,
    outputContract: OutputContractSchema,
    generation: GenerationHintsSchema,
  })
  .strict()
  .superRefine((spec, ctx) => {
    // Cross-field invariants that Zod field validators can't express alone.
    if (spec.identity.pageTargetMax < spec.identity.pageTargetMin) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "identity.pageTargetMax must be ≥ identity.pageTargetMin",
        path: ["identity", "pageTargetMax"],
      });
    }
    if (spec.plantedErrors.maxPerPacket < spec.plantedErrors.minPerPacket) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "plantedErrors.maxPerPacket must be ≥ minPerPacket",
        path: ["plantedErrors", "maxPerPacket"],
      });
    }
    if (
      spec.requiredStructure.partContract.whatYouNeedBulletMax <
      spec.requiredStructure.partContract.whatYouNeedBulletMin
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "partContract.whatYouNeedBulletMax must be ≥ whatYouNeedBulletMin",
        path: ["requiredStructure", "partContract", "whatYouNeedBulletMax"],
      });
    }
    // At least one paper style should match Paper 1 non-calculator when the
    // calculator policy is paper1-no-calculator (internal consistency).
    if (
      spec.identity.calculatorPolicy === "paper1-no-calculator" &&
      !spec.identity.paperStyles.includes("paper1")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "calculatorPolicy 'paper1-no-calculator' requires 'paper1' in paperStyles",
        path: ["identity", "paperStyles"],
      });
    }
  });

export type NuancedAnalysisSpec = z.infer<typeof NuancedAnalysisSpecSchema>;

// ── Validation helper (mirrors validateTemplateAst) ───────────────────────────

export type NuancedAnalysisSpecValidationResult =
  | { success: true; data: NuancedAnalysisSpec }
  | { success: false; error: string; fieldErrors: Record<string, string> };

/**
 * Validates a raw unknown value against the full NuancedAnalysisSpec schema.
 * Returns a discriminated result identical in shape to validateTemplateAst.
 */
export function validateNuancedAnalysisSpec(
  raw: unknown
): NuancedAnalysisSpecValidationResult {
  const result = NuancedAnalysisSpecSchema.safeParse(raw);
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
    error: `NuancedAnalysisSpec validation failed — ${summary}`,
    fieldErrors,
  };
}
