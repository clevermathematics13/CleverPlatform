/**
 * typst-render.service.ts
 * -----------------------------------------------------------------------------
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
 * -----------------------------------------------------------------------------
 */

import { validateTemplateAst } from "./template-ast.schema";
import type { TemplateAst } from "./template-ast.schema";

// -- Activity content AST ------------------------------------------------------

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
  /**
   * DESIGN_INSTRUCTIONS 2.4. Authored by the generator and shown in the live
   * preview, but it had no slot here at all, so it could never reach a PDF.
   */
  atl?: string;
  compulsoryCore?: string;
  tokProvocations?: TokProvocation[];
  internationalMindedness?: InternationalMindednessBox;
  commandTerms?: Array<{ term: string; definition: string }>;
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

// -- TypstRenderService result -------------------------------------------------

export type TypstRenderResult =
  | { success: true; pdfBuffer: Buffer; pageCount?: number }
  | { success: false; error: string; detail?: string };

// -- Lazy Typst compiler initialisation ---------------------------------------

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

// -- TypstRenderService --------------------------------------------------------

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
      // WHY THIS IS WIDER THAN `err instanceof Error ? err.message : String(err)`
      // (2026-08-18): production logged "render failed: Typst compilation
      // failed. | detail:" with NOTHING after the colon — that exact
      // expression produced an empty string. compiler.pdf() is a native addon
      // call (Rust via NAPI); native addons frequently throw objects that
      // pass `instanceof Error` but carry the real diagnostic somewhere other
      // than .message (a custom .toString(), a diagnostics array, additional
      // properties the binding sets, or a genuinely empty .message with the
      // real text only in the constructor name). Mirrors the
      // instanceof-across-a-realm-boundary lesson already applied in
      // nuanced-analysis-generation.ts's extractErrorMessage: don't assume an
      // object crossing out of native code matches ordinary JS Error
      // conventions. describeCompileError() tries every plausible source and
      // only falls back to a placeholder if genuinely none of them have text.
      const detail = describeCompileError(err);
      console.error("[typst-render.service] compiler.pdf() threw:", err);
      return {
        success: false,
        error: "Typst compilation failed.",
        detail,
      };
    }
  },
};

/**
 * Pulls whatever diagnostic text is available from a thrown value, trying
 * several plausible shapes before giving up. See the CATCH block above for
 * why `err instanceof Error ? err.message : String(err)` was not enough on
 * its own.
 */
function describeCompileError(err: unknown): string {
  const parts: string[] = [];

  if (err && typeof err === "object") {
    const withMessage = err as { message?: unknown };
    if (typeof withMessage.message === "string" && withMessage.message.trim()) {
      parts.push(withMessage.message.trim());
    }

    const withCode = err as { code?: unknown };
    if (withCode.code !== undefined) parts.push(`code=${String(withCode.code)}`);

    // Some native bindings attach the compiler's own diagnostics as a
    // stringified array/object under a non-standard property name.
    for (const key of ["diagnostics", "diagnostic", "cause", "reason"] as const) {
      const val = (err as Record<string, unknown>)[key];
      if (val !== undefined && val !== null) {
        try {
          parts.push(`${key}=${typeof val === "string" ? val : JSON.stringify(val)}`);
        } catch {
          parts.push(`${key}=${String(val)}`);
        }
      }
    }

    // toString() on a class instance sometimes differs from .message and
    // sometimes carries real content when .message does not. Skip it when
    // it's just "Error: <message we already captured>" - pure duplication.
    if (typeof (err as { toString?: unknown }).toString === "function") {
      const stringified = String(err);
      const isRedundant = parts.some((p) => stringified === `Error: ${p}` || stringified === p);
      if (stringified && stringified !== "[object Object]" && !isRedundant) {
        parts.push(stringified);
      }
    }

    if (parts.length === 0) {
      // Last resort: dump every enumerable own property so nothing is lost.
      try {
        const dumped = JSON.stringify(err, Object.getOwnPropertyNames(err));
        if (dumped && dumped !== "{}") parts.push(`raw=${dumped}`);
      } catch {
        /* unstringifiable; fall through to the final placeholder below */
      }
    }
  } else if (typeof err === "string" && err.trim()) {
    parts.push(err.trim());
  }

  return parts.length > 0
    ? parts.join(" | ")
    : "(no diagnostic text was available on the thrown error - see server logs for the raw object)";
}

// -- Embedded Typst source -----------------------------------------------------

/**
 * Returns the full Typst template source as a string.
 * Embedded here so the API route has zero file I/O at runtime.
 *
 * THIS STRING IS THE TEMPLATE. Nothing reads platform/typst/activity.typ at
 * runtime; it is a reference copy that has drifted, and it previously said it
 * was canonical, which is how this program came to be missing the whole
 * DESIGN_INSTRUCTIONS 2.1 header block that activity.typ has always had. Edit
 * here, and treat that file as documentation that can lie.
 *
 * Exported so tests can compile it against a real payload: a syntax error or a
 * mistyped content key here breaks every PDF the platform produces, and
 * nothing else in the pipeline would catch it.
 */
export function getActivityTypstSource(): string {
  return `
// -- CleverPlatform Nuanced Analysis — Typst template ------------------------
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
  if tier == 1 { text(fill: rgb("#1a7a4a"), size: 8pt)[\u{2605}] }
  else if tier == 2 { text(fill: rgb("#1a5c9e"), size: 8pt)[\u{2605}\u{2605}] }
  else if tier == 3 { text(fill: rgb("#8b3a8b"), size: 8pt)[\u{2605}\u{2605}\u{2605}] }
  else { [] }
}

#let col-rule = rgb("#e5e7eb")

// Answer space for one question.
//
// This takes the whole AnswerBoxSpec because it used to take only heightMm:
// kind and lineSpacingMm were computed by the orchestrator, validated by
// template-ast.schema, and then dropped here, so a template configured
// "lined" -- which is the default -- printed an empty rectangle. Every kind
// the schema allows is honoured now.
//
// "structured" carries its own column spec, so a question that wants a table
// (a concept map, say) declares its columns as weights rather than relying on
// whatever a generator happened to draw. Weights are relative: (4, 2, 8) gives
// a wide idea column, a narrow one for a question number, and the widest for
// the explanation -- the shape a reflection table actually needs, and the one
// A.1's Q28 and A.2's Q19 both got wrong by over-allocating the middle.
#let answer-box(spec, label: none) = {
  let h = spec.at("heightMm", default: 40) * 1mm
  let gap = spec.at("lineSpacingMm", default: 7) * 1mm
  let kind = spec.at("kind", default: "blank")
  let cols = spec.at("columns", default: ())

  block(breakable: false, width: 100%)[
    #if label != none [ #block(inset: (x:4pt,y:2pt))[#text(size:7pt,fill:rgb("#6b7280"))[#label]] ]
    #if kind == "structured" and cols.len() > 0 [
      #let body-rows = calc.max(1, int(h / gap) - 1)
      #table(
        columns: cols.map(c => c.at("weight", default: 1) * 1fr),
        stroke: 0.4pt + col-border,
        inset: 4pt,
        table.header(..cols.map(c => text(weight: "bold", size: 8.5pt)[#c.at("header", default: "")])),
        ..range(body-rows * cols.len()).map(_ => block(height: gap)[])
      )
    ] else [
      #rect(width: 100%, height: h, stroke: 0.5pt + col-border, radius: 1pt, inset: 0pt)[
        #if kind == "lined" or kind == "grid" [
          #layout(size => {
            let out = []
            let i = 1
            while i * gap < size.height {
              out += place(top + left, dy: i * gap, line(length: size.width, stroke: 0.3pt + col-rule))
              i += 1
            }
            if kind == "grid" {
              let j = 1
              while j * gap < size.width {
                out += place(top + left, dx: j * gap, line(angle: 90deg, length: size.height, stroke: 0.3pt + col-rule))
                j += 1
              }
            }
            out
          })
        ]
      ]
    ]
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
// A segment that does not read as math -- including one whose $ never
// closed -- falls back to literal text on its own, leaving the rest of the
// string typeset, instead of failing the compile.
//
// Multi-letter runs inside $...$ are variable lookups in Typst math, so a
// prose word makes eval() raise "unknown variable: <word>" and abort the
// entire compile. Not hypothetical: "Pencils cost $2.50 per package and
// pens cost $3 per package" pairs two currency dollars into a fake math
// segment and dies on "per". Typst has no try/catch, so every run has to be
// accounted for before eval, and looks-like-math() below accepts one only as
// a name Typst defines (this list), a symbol variant chain
// (math-symbol-paths), or a product of single-letter variables it can
// re-space (space-out-products).
//
// The list is deliberately conservative: words that are overwhelmingly
// ordinary English in this content ("and", "not", "text") are left out.
// Operator words the generator genuinely emits per its 11b MATH rule
// ("times", "div", "dot", "min", "max", "in", "macron", ...) ARE included --
// excluding them silently degraded real equations like
// "$a div b := a times 1/b$" to literal text, dollar signs and all, on a
// printed student packet. Entries are matched case-insensitively, so that
// "Delta" reads as the Greek letter, with math-scope below vouching for the
// exact spelling; an entry that Typst does NOT define belongs in
// math-aliases instead, never here alone, or a genuine math segment using it
// aborts the whole compile. typst-rich-inline-math.test.ts holds every
// spelling of every entry to that, against the shipped compiler.
#let math-idents = (
  "sin","cos","tan","sec","csc","cot","sinh","cosh","tanh",
  "arcsin","arccos","arctan","log","ln","lg","exp","sqrt","root","abs",
  "floor","ceil","sum","product","integral","lim","liminf","limsup",
  "dif","diff","partial",
  "infinity","approx","neq","leq","geq","cdot","pm","mp","equiv","prop",
  "times","div","dot","plus","minus","in","subset","union","sect",
  "min","max","mod","gcd","lcm","det","deg","dim","arg","ker","inf","sup",
  "arrow","dots","mapsto","implies","iff","oplus","otimes",
  "forall","exists","emptyset","nothing","because","therefore",
  "frac","binom","vec","mat","cases","overline","underline","hat","tilde",
  "macron","op","bb","cal","frak","upright",
  "quad","star","compose","prec","succ",
  // Geometry and measure. Left out of the first draft of this list as
  // "ordinary English", which was wrong in the way that matters: a similar-
  // triangles packet writes "angle" and "triangle" in nearly every box and a
  // trigonometry packet writes "degree" in nearly every question, so six real
  // generations printed 50 dollar signs between them with the model's math
  // perfectly well-formed. The prose risk is the same one "in", "times",
  // "min" and "star" above already accept.
  "degree","angle","triangle","square","circle","parallel","perp",
  "nabla","prime","norm","ratio","percent","diameter",
  "rr","zz","nn","qq","cc",
  "alpha","beta","gamma","delta","epsilon","zeta","eta",
  "theta","iota","kappa","lambda","mu","nu","xi","rho","sigma","tau",
  "upsilon","phi","chi","psi","omega","pi",
)

// Operator names the generator emits out of LaTeX habit that Typst math
// does NOT define. They pass the identifier check above (so the segment
// still counts as math) and are rewritten to the real Typst symbol just
// before eval -- without this, eval() dies on "unknown variable: leq" and
// takes the entire document with it.
#let math-aliases = (
  ("neq", "eq.not"), ("leq", "lt.eq"), ("geq", "gt.eq"),
  ("cdot", "dot.op"), ("pm", "plus.minus"), ("mp", "minus.plus"),
  ("implies", "arrow.r.double"), ("iff", "arrow.l.r.double"),
  ("oplus", "plus.circle"), ("otimes", "times.circle"),
  // LaTeX names, and one Typst-shaped invention: a real trigonometry packet
  // wrote "degree.circle" eight times, which Typst does not define.
  ("degree.circle", "degree"), ("leftrightarrow", "arrow.l.r"),
  ("rightarrow", "arrow.r"), ("leftarrow", "arrow.l"),
  ("infty", "infinity"), ("ldots", "dots.h"), ("cdots", "dots.c"),
  ("subseteq", "subset.eq"), ("supseteq", "supset.eq"),
)

// Dotted names are Typst symbol variant chains, and rule 11b tells the
// generator to write them: "lt.eq / gt.eq / eq.not for <= >= !=". The head
// cannot vouch for the rest -- an unknown modifier ("eq.bogus") aborts the
// compile exactly like an unknown variable does, and Typst offers no way to
// ask a symbol which variants it has -- so the whole path is matched here.
// Every entry is compile-verified in typst-rich-inline-math.test.ts.
// Without this list "$a eq.not 0$" printed its dollar signs on a student
// packet: the identifier check saw "eq" and "not", neither a variable.
#let math-symbol-paths = (
  "eq.not","eq.triple","eq.quest","eq.def","eq.delta","eq.colon","colon.eq",
  "lt.eq","lt.eq.not","lt.not","lt.double","lt.triple",
  "gt.eq","gt.eq.not","gt.not","gt.double","gt.triple",
  "plus.minus","plus.circle","plus.dot","plus.big",
  "minus.plus","minus.dot","minus.circle",
  "dot.op","dot.c","dot.circle","dot.double","dot.triple",
  "times.circle","times.div","times.big",
  "div.circle",
  "in.not","in.rev",
  "subset.eq","subset.not","subset.eq.not","supset.eq","supset.not",
  "prec.eq","succ.eq",
  "tilde.eq","tilde.equiv","tilde.op","tilde.not",
  "arrow.r","arrow.l","arrow.t","arrow.b","arrow.r.not",
  "arrow.r.double","arrow.l.double","arrow.l.r","arrow.l.r.double",
  "arrow.r.long","arrow.r.bar",
  "angle.l","angle.r",
  "bar.v","bar.h","bar.double","bar.v.double",
  "paren.l","paren.r","bracket.l","bracket.r","brace.l","brace.r",
  "dots.h","dots.v","dots.c","dots.down","dots.up",
  "integral.cont","integral.double","integral.triple",
  "union.big","union.sq","sect.big","sect.sq",
  "and.big","or.big","exists.not",
  "star.op","circle.small","circle.filled","circle.stroked",
  "square.filled","square.stroked","triangle.filled","triangle.t",
  "prime.double","prime.triple",
)

// Typst's own math scope, the authority on whether a name exists at all.
// The list above is the prose filter and is matched case-insensitively, so
// that "Delta" reads as the Greek letter -- but on its own that also waves
// through "Sin" and a lowercase "rr", neither of which Typst defines, and
// evaluating either aborts the whole document. Asking the scope for the
// exact spelling closes that hole without narrowing what the list allows.
#let math-scope = dictionary(sym) + dictionary(math)

#let is-alias(t) = math-aliases.any(pair => pair.at(0) == t)

// A name Typst evaluates exactly as written. The peel below may only emit
// these: an alias name would still be an unknown variable at eval time,
// because normalize-math rewrites whole words and a glued "xleq" never was
// one.
#let real-name(t) = math-idents.contains(lower(t)) and t in math-scope

#let known-name(t) = {
  // Alias names are the exception: Typst does not define "leq", but
  // normalize-math rewrites it to one that exists before anything evals it.
  if is-alias(t) { return true }
  real-name(t)
}

// Takes a run Typst reads as one unknown name and splits it into pieces it
// does know, longest first: "sinx" is sin of x, "cos2theta" is cos of 2theta,
// "sinthetacostheta" is a product of four things, and every one of them
// appeared in a real generated packet. Anything the list cannot claim comes
// out as a digit run or a single letter, both of which always evaluate.
//
// Returns the re-spaced text and how many characters real names accounted
// for, which is what tells "sinx" (3 of 4) apart from "package" (0 of 7).
#let peel-run(run) = {
  let parts = ()
  let claimed = 0
  let i = 0
  let n = run.len()
  while i < n {
    let took = 0
    // Longest first, capped past the longest name in the list.
    let j = calc.min(n, i + 10)
    while j > i + 1 and took == 0 {
      let cand = run.slice(i, j)
      if real-name(cand) {
        parts.push(cand)
        claimed += j - i
        took = j - i
      }
      j -= 1
    }
    if took == 0 {
      let j2 = i + 1
      if run.slice(i, i + 1).contains(regex("[0-9]")) {
        while j2 < n and run.slice(j2, j2 + 1).contains(regex("[0-9]")) { j2 += 1 }
      }
      parts.push(run.slice(i, j2))
      took = j2 - i
    }
    i += took
  }
  (text: parts.join(" "), claimed: claimed)
}

// Two thirds of the run is names Typst has, so reading it as a product of
// them is the better bet. The threshold is what keeps a stray currency
// segment out, and a bare majority was not enough: "child" hides chi and
// peels to chi + l + d, three of five, which let "adult $7, child $5" render
// as mathematics. "minimum" hides min (three of seven) and "number" hides nu
// (two of six); at two thirds all three stay prose, while "sinx" (three of
// four) and "kpi" (two of three) are read as the products they are.
#let peels-to-names(t) = peel-run(t).claimed * 3 >= t.len() * 2

// One token of a candidate math segment: a quoted literal span, or a name,
// where a name carries its dotted symbol modifiers with it so "eq.not" is
// judged as one thing rather than as the two English words it contains.
//
// Digits are part of a name, because they are part of one to Typst: it reads
// "cos2theta" as a single identifier and dies on it. Matching only letters
// saw "cos" and "theta", found both defined, and handed the whole run to
// eval -- which aborted the document. A real trigonometry packet wrote
// "$sin^2 theta = (1-cos2theta)/2$" and took its own PDF down that way.
#let math-token = regex("\\"[^\\"]*\\"|[A-Za-z][A-Za-z0-9]*([.][A-Za-z][A-Za-z0-9]*)*")

// Typst reads a multi-letter run as ONE variable name, so "ab" is a lookup
// that fails, not a product. Algebra is written exactly that way -- "ab" and
// "ac" in $a(b+c)=ab+ac$, "ax"/"bx" in $ax^2+bx+c$, "pq" in $x^2+(p+q)x+pq$
// -- and every one of those segments used to be rejected below and printed
// with its dollar signs on a student packet, which is what this re-spacing
// fixes: "a b", "a x", "p q" are the same products in Typst's own notation.
// Real identifiers, symbol paths and quoted spans are left exactly as
// written, so "sqrt", "eq.not" and $"Var"(X)$ survive untouched.
#let space-out-products(seg) = seg.replace(math-token, m => {
  let t = m.text
  if not t.starts-with(regex("[A-Za-z]")) { t }
  else if t.contains(".") or t.len() == 1 { t }
  else if known-name(t) { t }
  else { peel-run(t).text }
})

#let normalize-math(seg) = {
  let out = seg
  for (name, sym) in math-aliases {
    out = out.replace(regex("\\\\b" + name + "\\\\b"), sym)
  }
  // After the aliases, because "pm" must become "plus.minus" while it is
  // still one token -- spacing it out first would leave "p m".
  space-out-products(out)
}

#let looks-like-math(seg) = {
  // Quoted spans are literal text in Typst math -- the 11b MATH rule
  // requires named operators be written that way ($"Var"(X)$) -- so the
  // words inside them are always valid and must not fail the check.
  let unquoted = seg.replace(regex("\\"[^\\"]*\\""), " ")
  // A run this function does not recognise is either a product of variables
  // or a word from a sentence that two stray currency dollars fenced off, and
  // the two are told apart by what surrounds it. A segment with no space at
  // all cannot be part of a sentence. A segment with spaces has to earn it:
  // every unrecognised run in it must be two letters long AND the segment
  // must carry an operator, so "$ax + by = c$" is read as math while "$5 and
  // $" -- the middle of "tickets cost $5 and $10" -- keeps its dollar signs.
  // A segment that opens with an attachment operator has nothing to attach
  // to, which is a syntax error, and eval() answers one by ending the
  // document rather than the segment. It comes from writing a unit as
  // "cm$^2$ to m$^2$", where the dollars pair up around a bare "^2".
  //
  // Tested against seg, not unquoted: stripping the quoted spans out of
  // $k = "new length" / "original length"$ leaves a trailing slash, and a
  // trailing operator is not an error anyway -- Typst renders "3 +" and a
  // lone "=" quite happily, which is how $=$ is written in prose about the
  // equals sign itself. An earlier version of this guard refused all three.
  if seg.contains(regex("^ *[_^]")) { return false }
  let unspaced = not unquoted.contains(regex("\\\\s"))
  let has-operator = unquoted.contains(regex("[-+=^_/<>()*|]"))
  for m in unquoted.matches(math-token) {
    let t = m.text
    if t.contains(".") {
      if not (math-symbol-paths.contains(lower(t)) or is-alias(t)) { return false }
    } else if t.len() > 1 and not known-name(t) and not peels-to-names(t) {
      // Nothing here is a name Typst has. A run of plain letters can still be
      // a product of single-letter variables; one carrying a digit cannot be
      // anything ("x2", "Q3"), so it is printed as written rather than handed
      // to an eval that would end the document.
      if t.contains(regex("[0-9]")) { return false }
      if not (unspaced or (t.len() == 2 and has-operator)) { return false }
    }
  }
  true
}

#let rich(s) = {
  let parts = s.split("$")
  let last = parts.len() - 1
  let out = []
  for (i, part) in parts.enumerate() {
    if calc.rem(i, 2) == 0 {
      out += [#part]
    } else if i == last or not looks-like-math(part) {
      // Either the $ never closed, or the segment is prose the $-pairing
      // only looked like math. Put the dollars back and print it as
      // written, rather than evaluating a fragment that would take the
      // whole document down with it. Per segment, not per string: one
      // currency amount used to strip the math out of every other equation
      // in the same sentence, so Q5's $a$, $b$ and $c$ all printed their
      // delimiters because "$a(b+c)=ab+ac$" earlier in the prompt failed.
      let close = if i == last { "" } else { "$" }
      out += [#("$" + part + close)]
    } else {
      out += eval(normalize-math(part), mode: "math")
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
#grid(columns:(1fr,1fr),gutter:8pt)[*Student Name:* #h(4pt)#underline[#h(120pt)]][*Date:* #h(4pt)#underline[#h(80pt)]]
#v(4pt)

// DESIGN_INSTRUCTIONS 2.1 header block, plus the 2.4 ATL line. The payload
// carried every one of these and this template rendered none of them, so the
// on-screen preview and the downloaded PDF disagreed about the packet header.
// The orchestrator omits a key entirely rather than sending an empty or
// non-string value, so presence is enough to render, and rich() is required
// because these are teacher prose that can carry inline $...$ math.
#if "syllabusTopics" in content [
  #text(size:9pt)[*Syllabus Topics:* #rich(content.syllabusTopics)]
  #v(2pt)
]
#if "prerequisites" in content [
  #text(size:9pt)[*Prerequisites:* #rich(content.prerequisites)]
  #v(2pt)
]
#if "materials" in content [
  #text(size:9pt,style:"italic")[#rich(content.materials)]
  #v(2pt)
]
#if "atl" in content [
  #text(size:9pt)[*ATL skill:* #text(style:"italic")[#rich(content.atl)]]
  #v(2pt)
]
#if "compulsoryCore" in content [
  #v(2pt)
  #callout-box(fill-color:rgb("#f0fdf4"), border-color:rgb("#059669"), label:"Compulsory core (\u{2605} and \u{2605}\u{2605} questions)")[
    #text(size:9pt)[#rich(content.compulsoryCore)]
  ]
]
#v(8pt)

// Progress tracker
#if tmpl.progressTracker.enabled [
  #let n = content.sections.len()
  #text(size:8pt,fill:rgb("#6b7280"))[
    *#tmpl.progressTracker.label* #h(4pt)
    #for i in range(n) [ Part #str(i+1) \u{25a1} #h(4pt) ]
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
      #answer-box(q.answerBox)
    ]
    #v(4pt)
  ]
  #if "translationTable" in section [
    #v(4pt)
    #text(size:9pt,weight:"bold")[#rich(section.translationTable.caption)]
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
