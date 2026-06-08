/**
 * typst-render.service.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * TypstRenderService — Phase 2 of the CleverPlatform document generation
 * pipeline.
 *
 * Responsibility: accept a merged ActivityPayload (template AST + content AST)
 * and return a PDF buffer by calling the Typst WASM compiler.
 *
 * Architecture note:
 *   This file is deliberately a thin wrapper so it can be called from:
 *     - An API route (platform/app/api/typst-render/route.ts)
 *     - A Supabase Edge Function in the future
 *     - A test fixture
 *
 *   The actual Typst source is a separate .typ file loaded at compile time.
 *   The JSON payload is passed into Typst using its native json() data loader.
 *
 * Current status:
 *   Typst WASM (via @myriaddreamin/typst.ts) is loaded lazily so it does not
 *   inflate the Next.js edge runtime. The first call initialises the compiler;
 *   subsequent calls reuse it.
 *
 * Fallback:
 *   If the Typst WASM cannot be loaded (e.g. missing dependency), the service
 *   returns { success: false, error } with a clear message so callers can fall
 *   back to the KaTeX → Puppeteer path.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { validateTemplateAst } from "./template-ast.schema";
import type { TemplateAst } from "./template-ast.schema";

// ── Activity content AST ──────────────────────────────────────────────────────

/**
 * A MathNode carries a single mathematical expression in Typst native syntax.
 *
 * Example:
 *   { type: "math", display: true, content: "f(x) = x^2 - 4x + 3" }
 *
 * The content is Typst math syntax (not LaTeX).  The AI generation pipeline
 * should output Typst math strings.  The frontend preview can convert KaTeX
 * strings to Typst where needed.
 */
export interface MathNode {
  type: "math";
  display: boolean;
  content: string;
}

/**
 * AnswerBoxSpec defines the answer space for a single question.
 */
export interface AnswerBoxSpec {
  kind: "blank" | "lined" | "grid" | "structured";
  heightMm: number;
  lineSpacingMm: number;
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
  /** Question prompt in plain text with Typst math syntax for equations. */
  prompt: string;
  answerBox: AnswerBoxSpec;
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
  compulsoryCore?: string;
  tokProvocations?: TokProvocation[];
  internationalMindedness?: InternationalMindednessBox;
  commandTerms?: Array<{ term: string; definition: string }>;
  sections: ActivitySection[];
}

// ── Merged payload ────────────────────────────────────────────────────────────

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

// ── TypstRenderService result ─────────────────────────────────────────────────

export type TypstRenderResult =
  | { success: true; pdfBuffer: Buffer; pageCount?: number }
  | { success: false; error: string; detail?: string };

// ── Lazy Typst compiler initialisation ───────────────────────────────────────

// We store a reference to the compiler singleton so it is only
// initialised once per server process.
let _typstCompilerPromise: Promise<unknown> | null = null;

/**
 * Loads the Typst WASM compiler lazily.
 *
 * Returns the compiler instance, or throws if the package is not installed.
 */
async function getTypstCompiler(): Promise<unknown> {
  if (_typstCompilerPromise) return _typstCompilerPromise;

  _typstCompilerPromise = (async () => {
    // Dynamic import so the package is not bundled into the client.
    // The package is: npm install @myriaddreamin/typst.ts
    const mod = await import("@myriaddreamin/typst.ts" as string);
    // Initialise the WASM compiler.
    // The exact API depends on the version — see typst.ts documentation.
    const compiler = new (mod as { NodeCompiler: new () => unknown }).NodeCompiler();
    return compiler;
  })();

  return _typstCompilerPromise;
}

// ── Pacing calculation ────────────────────────────────────────────────────────

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

// ── JSON payload builder ──────────────────────────────────────────────────────

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

  return {
    schemaVersion: template.schemaVersion,
    template,
    content: {
      ...content,
      sections: annotatedSections,
    },
    renderOptions,
    metadata: {
      generatedAt: metadata.generatedAt ?? new Date().toISOString(),
      generatedBy: metadata.generatedBy ?? "CleverPlatform",
      platformVersion: metadata.platformVersion ?? "1.0.0",
    },
  };
}

// ── TypstRenderService ────────────────────────────────────────────────────────

export const TypstRenderService = {
  /**
   * Validates and renders an ActivityPayload to a PDF buffer.
   *
   * Steps:
   *   1. Validate the template AST.
   *   2. Build the merged JSON payload.
   *   3. Load the Typst WASM compiler.
   *   4. Compile the Typst source with the JSON payload injected.
   *   5. Return the PDF buffer.
   */
  async render(payload: ActivityPayload): Promise<TypstRenderResult> {
    // Step 1 — Validate template
    const validation = validateTemplateAst(payload.template);
    if (!validation.success) {
      return {
        success: false,
        error: validation.error,
        detail: JSON.stringify(validation.fieldErrors, null, 2),
      };
    }

    // Step 2 — Build merged JSON payload
    const typstPayload = buildTypstPayload(payload);

    // Step 3 — Load Typst compiler
    let compiler: unknown;
    try {
      compiler = await getTypstCompiler();
    } catch (err) {
      return {
        success: false,
        error:
          "Typst compiler not available. Run: npm install @myriaddreamin/typst.ts",
        detail: err instanceof Error ? err.message : String(err),
      };
    }

    // Step 4 — Compile
    // The Typst template reads the payload via:
    //   #let data = json(sys.inputs.payload)
    // We serialize payload to a temp string and pass via stdin/env.
    try {
      const payloadJson = JSON.stringify(typstPayload);

      // typst.ts API: compiler.compile({ source, inputs })
      // The compiler instance exposes a compile() method.
      const compile = (
        compiler as {
          compile: (opts: {
            source: string;
            inputs?: Record<string, string>;
          }) => Promise<{ pdf: () => Uint8Array }>;
        }
      ).compile;

      if (typeof compile !== "function") {
        return {
          success: false,
          error: "Typst compiler API mismatch — compile() not found.",
          detail:
            "Check @myriaddreamin/typst.ts version. Expected NodeCompiler.compile().",
        };
      }

      // Load the Typst source template from disk.
      // In production this is embedded as a string constant.
      const typstSource = getActivityTypstSource();

      const result = await compile.call(compiler, {
        source: typstSource,
        inputs: { payload: payloadJson },
      });

      const pdfBytes = result.pdf();
      const pdfBuffer = Buffer.from(pdfBytes);

      // Smoke-check: all PDFs start with %PDF-
      if (!pdfBuffer.toString("ascii", 0, 5).startsWith("%PDF-")) {
        return {
          success: false,
          error: "Typst output does not appear to be a valid PDF.",
          detail: `First bytes: ${pdfBuffer.toString("ascii", 0, 20)}`,
        };
      }

      return { success: true, pdfBuffer };
    } catch (err) {
      return {
        success: false,
        error: "Typst compilation failed.",
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

// ── Embedded Typst source ─────────────────────────────────────────────────────

/**
 * Returns the Typst template source as a string.
 *
 * In development the file is read from platform/typst/activity.typ.
 * In production the source is inlined here so the API route has no file I/O.
 *
 * This function returns a minimal valid Typst document that reads the JSON
 * payload and renders a Nuanced Analysis packet.
 *
 * The full template lives in platform/typst/activity.typ.
 */
function getActivityTypstSource(): string {
  return `
// ── CleverPlatform Nuanced Analysis — Typst template ────────────────────────
// Reads a validated ActivityPayload JSON injected via sys.inputs.payload.
// ─────────────────────────────────────────────────────────────────────────────

#let raw = sys.inputs.at("payload", default: "{}")
#let data = json(raw)
#let tmpl = data.template
#let content = data.content
#let opts = data.at("renderOptions", default: (:))

// Document settings
#let page-size = if tmpl.document.pageSize == "a4" { "a4" } else { "us-letter" }
#let margin-top = str(tmpl.document.marginTopMm) + "mm"
#let margin-right = str(tmpl.document.marginRightMm) + "mm"
#let margin-bottom = str(tmpl.document.marginBottomMm) + "mm"
#let margin-left = str(tmpl.document.marginLeftMm) + "mm"

#set page(
  paper: page-size,
  margin: (top: margin-top, right: margin-right, bottom: margin-bottom, left: margin-left),
)

// Typography
#set text(
  font: tmpl.typography.bodyFont,
  size: str(tmpl.typography.bodySizePt) + "pt",
)

#set par(leading: 0.65em)

// Colour helpers
#let col-primary = rgb(tmpl.colors.primary)
#let col-secondary = rgb(tmpl.colors.secondary)
#let col-accent = rgb(tmpl.colors.accent)
#let col-border = rgb(tmpl.colors.border)
#let col-tok = rgb(tmpl.colors.tokBox)
#let col-im = rgb(tmpl.colors.imBox)
#let col-strip = rgb(tmpl.colors.commandTermStrip)

// ── Tier badge helper ────────────────────────────────────────────────────────
#let tier-badge(tier) = {
  if tier == 1 { text(fill: rgb("#1a7a4a"), size: 8pt)[\u{2605}] }
  else if tier == 2 { text(fill: rgb("#1a5c9e"), size: 8pt)[\u{2605}\u{2605}] }
  else if tier == 3 { text(fill: rgb("#8b3a8b"), size: 8pt)[\u{2605}\u{2605}\u{2605}] }
  else { [] }
}

// ── Answer box helper ────────────────────────────────────────────────────────
#let answer-box(height-mm, label: none) = {
  let box-height = str(height-mm) + "mm"
  block(breakable: false)[
    #if label != none [
      #block(inset: (x: 4pt, y: 2pt))[
        #text(size: 7pt, fill: rgb("#6b7280"))[#label]
      ]
    ]
    #rect(
      width: 100%,
      height: box-height,
      stroke: 0.5pt + col-border,
      radius: 1pt,
    )
  ]
}

// ── Section callout helper ───────────────────────────────────────────────────
#let callout-box(body, fill-color: white, border-color: col-border, label: none) = {
  block(breakable: false, width: 100%)[
    #rect(
      width: 100%,
      fill: fill-color,
      stroke: (left: 3pt + border-color, rest: 0.5pt + border-color),
      inset: (x: 8pt, y: 6pt),
      radius: (right: 2pt),
    )[
      #if label != none [
        #text(size: 8pt, weight: "bold", fill: border-color)[#upper(label)]
        #v(3pt)
      ]
      #body
    ]
  ]
}

// ── Document header ──────────────────────────────────────────────────────────
#block(width: 100%)[
  #align(center)[
    #text(size: 8pt, weight: "bold", fill: col-secondary)[#upper(content.at("course", default: "CleverPlatform Mathematics"))]
    #v(4pt)
    #text(size: 16pt, weight: "bold", font: tmpl.typography.headingFont)[#content.title]
    #v(2pt)
    #text(size: 10pt, fill: rgb("#4b5563"), style: "italic")[#content.at("subtitle", default: "")]
  ]
  #v(6pt)
  #line(length: 100%, stroke: 0.5pt + col-border)
  #v(4pt)
  #grid(columns: (1fr, 1fr), gutter: 8pt)[
    *Student Name:* #h(6pt) #underline[#h(120pt)]
  ][
    *Date:* #h(6pt) #underline[#h(80pt)]
  ]
  #v(4pt)
  #if content.has("syllabusTopics") [
    #text(size: 9pt)[*Syllabus Topic(s):* #content.syllabusTopics]
    #v(2pt)
  ]
  #if content.has("prerequisites") [
    #text(size: 9pt)[*Prerequisites:* #content.prerequisites]
    #v(2pt)
  ]
  #if content.has("materials") [
    #text(size: 9pt, style: "italic")[#content.materials]
    #v(2pt)
  ]
  #if content.has("compulsoryCore") [
    #v(2pt)
    #callout-box(
      text(size: 9pt)[*Compulsory core:* #content.compulsoryCore],
      fill-color: rgb("#f0fdf4"),
      border-color: rgb("#059669"),
    )
  ]
]

#v(8pt)

// ── Progress tracker ─────────────────────────────────────────────────────────
#if tmpl.progressTracker.enabled [
  #let part-count = content.sections.len()
  #block(width: 100%)[
    #text(size: 8pt, fill: rgb("#6b7280"))[
      #tmpl.progressTracker.label #h(4pt)
      #for i in range(part-count) [
        Part #str(i + 1) #h(2pt) \u{25a1} #h(6pt)
      ]
    ]
  ]
  #v(6pt)
]

// ── Command Terms tear-off strip ─────────────────────────────────────────────
#if content.has("commandTerms") and content.commandTerms.len() > 0 [
  #v(4pt)
  #line(length: 100%, stroke: (dash: "dashed", thickness: 0.5pt, paint: col-secondary))
  #block(fill: col-strip.lighten(90%), width: 100%, inset: (x: 8pt, y: 6pt))[
    #block(fill: col-strip, inset: (x: 6pt, y: 3pt), radius: (top: 2pt))[
      #text(size: 8pt, weight: "bold", fill: white)[#upper("Command Terms — tear off and keep beside you")]
    ]
    #v(4pt)
    #table(
      columns: (80pt, 1fr),
      stroke: 0.3pt + col-border,
      ..for ct in content.commandTerms {
        (text(weight: "bold", size: 9pt)[#ct.term], text(size: 9pt)[#ct.definition])
      }
    )
    #v(4pt)
    #text(size: 8pt, fill: rgb("#4b5563"))[
      *Output demand →* #h(4pt)
      #text(style: "italic")[Write down] · State · Describe · Explain · Show that · #text(weight: "bold", style: "italic")[Prove]
    ]
  ]
  #line(length: 100%, stroke: (dash: "dashed", thickness: 0.5pt, paint: col-secondary))
  #v(6pt)
]

// ── TOK Provocations ─────────────────────────────────────────────────────────
#if content.has("tokProvocations") and content.tokProvocations.len() > 0 [
  #callout-box(
    label: "TOK Provocations — return to these in the Reflection",
    fill-color: col-tok,
    border-color: col-accent,
  )[
    #for (i, tok) in content.tokProvocations.enumerate() [
      #v(2pt)
      #text(size: 9.5pt)[*#str(i+1).* #tok.body]
      #v(2pt)
    ]
  ]
  #v(6pt)
]

// ── International Mindedness ──────────────────────────────────────────────────
#if content.has("internationalMindedness") [
  #callout-box(
    label: "International Mindedness",
    fill-color: col-im,
    border-color: rgb("#059669"),
  )[
    #text(size: 9.5pt)[#content.internationalMindedness.body]
  ]
  #v(6pt)
]

// ── Sections ─────────────────────────────────────────────────────────────────
#for section in content.sections [
  #v(8pt)
  // Section heading — kept with first question
  #block(breakable: false)[
    #line(length: 100%, stroke: 1.5pt + col-primary)
    #v(3pt)
    #text(size: 12pt, weight: "bold", font: tmpl.typography.headingFont)[#section.heading]
    #v(4pt)

    // Prerequisite micro-box
    #if section.has("prerequisiteBox") [
      #callout-box(
        label: "What you need to start this Part",
        fill-color: rgb("#eff6ff"),
        border-color: rgb("#3b82f6"),
      )[
        #for item in section.prerequisiteBox.items [
          - #text(size: 9pt)[#item]
        ]
      ]
      #v(4pt)
    ]
  ]

  // Command-Term Spotlight callout
  #if section.has("spotlight") [
    #callout-box(
      label: "Command-Term Spotlight: " + section.spotlight.title,
      fill-color: col-strip.lighten(90%),
      border-color: col-strip,
    )[
      #text(size: 9.5pt)[#section.spotlight.body]
    ]
    #v(4pt)
  ]

  // Questions
  #for q in section.questions [
    #block(breakable: false)[
      // Question prompt row
      #grid(columns: (24pt, 1fr, 36pt), gutter: 6pt)[
        #text(weight: "bold")[#str(q.globalNumber).] #tier-badge(q.tier)
      ][
        #text(size: tmpl.typography.bodySizePt * 1pt)[#q.prompt]
      ][
        #if tmpl.questionBlocks.showMarks [
          #text(size: 8pt, fill: rgb("#6b7280"))[[#str(q.marks)M]]
        ]
        #if tmpl.questionBlocks.showEstimatedMinutes [
          #v(1pt)
          #text(size: 7pt, fill: rgb("#9ca3af"))[(~#str(q.estimatedMinutes) min)]
        ]
      ]
      #if q.has("hint") [
        #h(24pt)
        #text(size: 9pt, style: "italic", fill: rgb("#6b7280"))[Hint: #q.hint]
      ]
      #v(3pt)
      // Answer box — unbreakable with prompt
      #answer-box(q.answerBox.heightMm)
    ]
    #v(4pt)
  ]

  // Translation table
  #if section.has("translationTable") [
    #v(4pt)
    #text(size: 9pt, weight: "bold")[#section.translationTable.caption]
    #v(2pt)
    #table(
      columns: (1fr, 1fr),
      stroke: 0.4pt + col-border,
      table.header(
        text(weight: "bold", size: 9pt)[What you say in your head...],
        text(weight: "bold", size: 9pt)[What you write on the exam...],
      ),
      ..for row in section.translationTable.rows {
        (text(size: 9pt, style: "italic")[#row.informal], text(size: 9pt)[#row.formal])
      }
    )
  ]

  // Geometric reading callout
  #if section.has("geometricReading") [
    #v(4pt)
    #callout-box(
      label: "Geometric / Physical Reading",
      fill-color: rgb("#f9fafb"),
      border-color: col-border,
    )[
      #text(size: 9.5pt, style: "italic")[#section.geometricReading.body]
    ]
  ]
]

// ── Teacher's Companion ───────────────────────────────────────────────────────
#if opts.at("includeTeacherCompanion", default: false) [
  #pagebreak()
  #line(length: 100%, stroke: 2pt + col-accent)
  #v(4pt)
  #text(size: 14pt, weight: "bold", fill: col-accent)[Teacher's Companion]
  #v(2pt)
  #callout-box(
    text(size: 9pt)[*For the instructor only.* Remove this page before distributing to students.],
    fill-color: rgb("#faf5ff"),
    border-color: col-accent,
  )
]
`;
}
