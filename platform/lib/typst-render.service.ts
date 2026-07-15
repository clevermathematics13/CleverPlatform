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
 *   @myriaddreamin/typst-ts-node-compiler is a real dependency (see
 *   package.json). It is a native (napi-rs) addon — not WASM despite this
 *   file's name — and is listed in next.config.ts's serverExternalPackages so
 *   Next.js's build-time file tracing includes the platform-specific native
 *   binary in the deployed function instead of trying to bundle it with
 *   webpack/Turbopack. npm resolves only ONE platform binary via
 *   optionalDependencies (linux-x64-gnu on Vercel, ~37MB unpacked) — it does
 *   not download every platform's variant.
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

// Compiler singleton — initialised once per server process.
// @myriaddreamin/typst-ts-node-compiler is a native (napi-rs) addon, not WASM:
// npm resolves only the matching platform binary via optionalDependencies
// (linux-x64-gnu on Vercel's Node runtime, ~37MB), and it is listed in
// next.config.ts's serverExternalPackages so Next's build tracing includes the
// native binary in the function bundle instead of trying to webpack-bundle it.
let _typstCompiler: NodeCompilerLike | null = null;

interface NodeCompilerLike {
  pdf(
    opts: { mainFileContent: string; inputs?: Record<string, string> }
  ): Buffer;
}

/**
 * Loads the Typst Node compiler lazily (synchronous native call under the
 * hood; wrapped as async so callers don't need to change if this ever becomes
 * genuinely async again).
 *
 * To install: npm install @myriaddreamin/typst-ts-node-compiler
 */
async function getTypstCompiler(): Promise<NodeCompilerLike> {
  if (_typstCompiler) return _typstCompiler;

  const mod = await import("@myriaddreamin/typst-ts-node-compiler");
  _typstCompiler = mod.NodeCompiler.create() as unknown as NodeCompilerLike;
  return _typstCompiler;
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
   *   3. Load the Typst WASM compiler (optional dep — fails gracefully).
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
    let compiler: NodeCompilerLike;
    try {
      compiler = await getTypstCompiler();
    } catch (err) {
      return {
        success: false,
        error:
          "Typst compiler not available. Install with: npm install @myriaddreamin/typst-ts-node-compiler",
        detail: err instanceof Error ? err.message : String(err),
      };
    }

    // Step 4 — Compile
    try {
      const payloadJson = JSON.stringify(typstPayload);
      const typstSource = getActivityTypstSource();

      // compiler.pdf() is synchronous (native addon call) and returns the PDF
      // bytes directly as a Buffer — there is no separate .compile() step and
      // no .pdf() method on a result object; that shape does not exist on this
      // package's real API.
      const pdfBuffer = compiler.pdf({
        mainFileContent: typstSource,
        inputs: { payload: payloadJson },
      });

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
 * Returns the full Typst template source as a string.
 * Embedded here so the API route has zero file I/O at runtime.
 * The canonical source lives in platform/typst/activity.typ.
 */
function getActivityTypstSource(): string {
  return `
// ── CleverPlatform Nuanced Analysis — Typst template ────────────────────────
#let raw = sys.inputs.at("payload", default: "{}")
#let data = json.decode(raw)
#let tmpl = data.template
#let content = data.content
#let opts = data.at("renderOptions", default: (:))

#let page-size = if tmpl.document.pageSize == "a4" { "a4" } else { "us-letter" }
#set page(
  paper: page-size,
  margin: (
    top: (tmpl.document.marginTopMm) * 1mm,
    right: (tmpl.document.marginRightMm) * 1mm,
    bottom: (tmpl.document.marginBottomMm) * 1mm,
    left: (tmpl.document.marginLeftMm) * 1mm,
  ),
)
#set text(font: tmpl.typography.bodyFont, size: (tmpl.typography.bodySizePt) * 1pt)
#set par(leading: 0.65em)

#let col-primary = rgb(tmpl.colors.primary)
#let col-secondary = rgb(tmpl.colors.secondary)
#let col-accent = rgb(tmpl.colors.accent)
#let col-border = rgb(tmpl.colors.border)
#let col-tok = rgb(tmpl.colors.tokBox)
#let col-im = rgb(tmpl.colors.imBox)
#let col-strip = rgb(tmpl.colors.commandTermStrip)

#let tier-badge(tier) = {
  if tier == 1 { text(fill: rgb("#1a7a4a"), size: 8pt)[\\u{2605}] }
  else if tier == 2 { text(fill: rgb("#1a5c9e"), size: 8pt)[\\u{2605}\\u{2605}] }
  else if tier == 3 { text(fill: rgb("#8b3a8b"), size: 8pt)[\\u{2605}\\u{2605}\\u{2605}] }
  else { [] }
}

#let answer-box(height-mm, label: none) = {
  block(breakable: false)[
    #if label != none [ #block(inset: (x:4pt,y:2pt))[#text(size:7pt,fill:rgb("#6b7280"))[#label]] ]
    #rect(width: 100%, height: (height-mm) * 1mm, stroke: 0.5pt + col-border, radius: 1pt)
  ]
}

#let callout-box(body, fill-color: white, border-color: col-border, label: none) = {
  block(breakable: false, width: 100%)[
    #rect(width:100%, fill:fill-color, stroke:(left:3pt+border-color, rest:0.5pt+border-color), inset:(x:8pt,y:6pt), radius:(right:2pt))[
      #if label != none [ #text(size:8pt,weight:"bold",fill:border-color)[#upper(label)] #v(3pt) ]
      #body
    ]
  ]
}

// Renders a string that may contain $...$-delimited Typst math segments as
// real typeset math, while everything outside $...$ stays literal text.
// AI-generated prompts/hints/TOK text etc. are expected to use $...$ for
// inline math (per the ActivityQuestion.prompt / MathNode docstrings) — a
// bare #text[#s] interpolation would print the dollar signs literally rather
// than typesetting the math, which is unacceptable on a mathematics platform.
// An odd number of $ (malformed/unbalanced input) falls back to literal text
// instead of a hard compile failure.
#let rich(s) = {
  let parts = s.split("$")
  if calc.rem(parts.len(), 2) == 0 {
    return [#s]
  }
  let out = []
  for (i, part) in parts.enumerate() {
    if calc.rem(i, 2) == 0 {
      out += [#part]
    } else {
      out += eval(part, mode: "math")
    }
  }
  out
}

// Header
#align(center)[
  #text(size:9pt,weight:"bold",fill:col-secondary)[#upper(content.at("course", default:"CleverPlatform"))]
  #v(4pt)
  #text(size:16pt,weight:"bold")[#rich(content.title)]
  #v(2pt)
  #text(size:10pt,fill:rgb("#4b5563"),style:"italic")[#rich(content.at("subtitle",default:""))]
]
#v(6pt)
#line(length:100%,stroke:0.5pt+col-border)
#v(4pt)
#grid(columns:(1fr,1fr),gutter:8pt)[*Name:* #h(4pt)#underline[#h(120pt)]][*Date:* #h(4pt)#underline[#h(80pt)]]
#v(8pt)

// Progress tracker
#if tmpl.progressTracker.enabled [
  #let n = content.sections.len()
  #text(size:8pt,fill:rgb("#6b7280"))[
    *#tmpl.progressTracker.label* #h(4pt)
    #for i in range(n) [ Part #str(i+1) \\u{25a1} #h(4pt) ]
  ]
  #v(6pt)
]

// Command Terms strip
#if "commandTerms" in content and content.commandTerms.len() > 0 [
  #line(length:100%,stroke:(dash:"dashed",thickness:0.5pt,paint:col-strip))
  #block(fill:col-strip.lighten(90%),width:100%,inset:(x:8pt,y:6pt))[
    #block(fill:col-strip,inset:(x:6pt,y:3pt))[#text(size:8pt,weight:"bold",fill:white)[#upper("Command Terms — tear off and keep beside you")]]
    #v(3pt)
    #table(columns:(80pt,1fr),stroke:0.3pt+col-border,
      ..for ct in content.commandTerms { (text(weight:"bold",size:9pt)[#rich(ct.term)],text(size:9pt)[#rich(ct.definition)]) }
    )
    #v(3pt)
    #text(size:8pt)[*Output demand →* Write down · State · Describe · Explain · Show that · *Prove*]
  ]
  #line(length:100%,stroke:(dash:"dashed",thickness:0.5pt,paint:col-strip))
  #v(6pt)
]

// TOK
#if "tokProvocations" in content and content.tokProvocations.len() > 0 [
  #callout-box(label:"TOK Provocations — return to these in the Reflection",fill-color:col-tok,border-color:col-accent)[
    #for (i,tok) in content.tokProvocations.enumerate() [
      #v(2pt)
      #text(size:9.5pt)[*#str(i+1).* #rich(tok.body)]
      #v(2pt)
    ]
  ]
  #v(6pt)
]

// IM
#if "internationalMindedness" in content [
  #callout-box(label:"International Mindedness",fill-color:col-im,border-color:rgb("#059669"))[
    #text(size:9.5pt)[#rich(content.internationalMindedness.body)]
  ]
  #v(6pt)
]

// Sections
#for section in content.sections [
  #v(8pt)
  #block(breakable:false)[
    #line(length:100%,stroke:1.5pt+col-primary)
    #v(3pt)
    #text(size:12pt,weight:"bold")[#rich(section.heading)]
    #v(4pt)
    #if "prerequisiteBox" in section [
      #callout-box(label:"What you need to start this Part",fill-color:rgb("#eff6ff"),border-color:rgb("#3b82f6"))[
        #for item in section.prerequisiteBox.items [ - #text(size:9pt)[#rich(item)] ]
      ]
      #v(4pt)
    ]
  ]
  #if "spotlight" in section [
    #callout-box(label:"Command-Term Spotlight: "+section.spotlight.title,fill-color:col-strip.lighten(90%),border-color:col-strip)[
      #text(size:9.5pt)[#rich(section.spotlight.body)]
    ]
    #v(4pt)
  ]
  #for q in section.questions [
    #block(breakable:false)[
      #grid(columns:(24pt,1fr,36pt),gutter:6pt)[
        #text(weight:"bold")[#str(q.globalNumber).] #tier-badge(q.tier)
      ][
        #text[#rich(q.prompt)]
        #if "hint" in q [ #v(2pt)#text(size:9pt,style:"italic",fill:rgb("#6b7280"))[Hint: #rich(q.hint)] ]
      ][
        #if tmpl.questionBlocks.showMarks [#text(size:8pt,fill:rgb("#6b7280"))[[#str(q.marks)M]]]
        #if tmpl.questionBlocks.showEstimatedMinutes [#v(1pt)#text(size:7pt,fill:rgb("#9ca3af"))[(~#str(q.estimatedMinutes) min)]]
      ]
      #v(3pt)
      #answer-box(q.answerBox.heightMm)
    ]
    #v(4pt)
  ]
  #if "translationTable" in section [
    #v(4pt)
    #text(size:9pt,weight:"bold")[#section.translationTable.caption]
    #v(2pt)
    #table(columns:(1fr,1fr),stroke:0.4pt+col-border,
      table.header(text(weight:"bold",size:9pt)[What you say in your head...],text(weight:"bold",size:9pt)[What you write on the exam...]),
      ..for row in section.translationTable.rows { (text(size:9pt,style:"italic")[#rich(row.informal)],text(size:9pt)[#rich(row.formal)]) }
    )
  ]
  #if "geometricReading" in section [
    #v(4pt)
    #callout-box(label:"Geometric / Physical Reading",fill-color:rgb("#f9fafb"),border-color:col-border)[
      #text(size:9.5pt,style:"italic")[#rich(section.geometricReading.body)]
    ]
  ]
]

// Teacher's Companion
#if opts.at("includeTeacherCompanion",default:false) [
  #pagebreak()
  #line(length:100%,stroke:2pt+col-accent)
  #v(4pt)
  #text(size:14pt,weight:"bold",fill:col-accent)[Teacher's Companion]
  #v(2pt)
  #callout-box(text(size:9pt)[*For the instructor only.* Remove before distributing.],fill-color:rgb("#faf5ff"),border-color:col-accent)
]
`;
}
