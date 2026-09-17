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
import { TYPST_MATH_IDENTS, MATH_ALIASES } from "./math-typesetting";
import { TRUSTED_MATH_DELIM } from "./latex-to-typst";
import { buildTypstPayload } from "./typst-payload";
import type { ActivityPayload } from "./typst-payload";

// The payload shapes and their two pure builders live in ./typst-payload so
// that the browser can reach them without reaching the native compiler below
// (see that file's header). They are re-exported here because this module was
// their original home and server-side callers still import them from it.
export type {
  MathNode,
  AnswerBoxSpec,
  QuestionCohesionOverride,
  ActivityQuestion,
  ActivitySection,
  TokProvocation,
  InternationalMindednessBox,
  ActivityContentAst,
  ActivityPayload,
} from "./typst-payload";
export { computeEstimatedMinutes, buildTypstPayload } from "./typst-payload";

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
  // The trusted-math marker, written as a Typst string escape rather than as
  // a raw control character in the emitted source. Derived from the one
  // constant latex-to-typst.ts wraps spans in, so the writer and the reader
  // of the marker can never drift apart.
  const trustedDelim = `"\\u{${TRUSTED_MATH_DELIM.codePointAt(0)!.toString(16)}}"`;
  // The same treatment for the currency escape: `BS` is one backslash, so
  // `escapedDollar` is the Typst literal for the two characters
  // escapeCurrencyDollars() writes, and `dollarSentinel` is a private code
  // point one above the trusted marker -- it exists only between this
  // module's two replace() calls and can never occur in packet prose.
  const BS = String.fromCharCode(92);
  const escapedDollar = `"${BS}${BS}$"`;
  const dollarSentinel = `"${BS}u{2}"`;
  return `
// -- CleverPlatform Nuanced Analysis — Typst template ------------------------
#let raw = sys.inputs.at("payload", default: "{}")
#let data = json.decode(raw)
#let tmpl = data.template
#let content = data.content
#let opts = data.at("renderOptions", default: (:))

#let page-size = if tmpl.document.pageSize == "a4" { "a4" } else { "us-letter" }
// Every page carries its number and the total: "2 of 23".
//
// A packet is stapled, worked on over three lessons, torn apart at the
// Teacher's Companion and scanned back in. Without the total, a student
// holding page 14 cannot tell whether anything is missing, and neither can
// whoever collects it. counter(page).final() is what makes the total
// available -- it needs the context block, because Typst can only know how
// many pages there are after it has laid them all out.
#set page(
  paper: page-size,
  margin: (
    top: (tmpl.document.marginTopMm) * 1mm,
    right: (tmpl.document.marginRightMm) * 1mm,
    bottom: (tmpl.document.marginBottomMm) * 1mm,
    left: (tmpl.document.marginLeftMm) * 1mm,
  ),
  footer: context [
    #set align(center)
    #text(size: 8pt, fill: rgb("#9ca3af"))[
      #counter(page).display("1") of #counter(page).final().first()
    ]
  ],
)
#set text(font: tmpl.typography.bodyFont, size: (tmpl.typography.bodySizePt) * 1pt)

// Pin the math face explicitly rather than inheriting Typst's default.
// New Computer Modern Math is the Computer Modern successor -- the face LaTeX
// has set mathematics in for forty years -- and it is the ONLY math font the
// shipped compiler carries (Libertinus Math, STIX Two Math and Fira Math were
// all probed against this exact binary and are absent). Naming it here means
// the packets' mathematics cannot silently change face if the bundled font
// set ever shifts, and it documents that a math font is a deliberate choice
// on a mathematics platform rather than an accident of the default.
#show math.equation: set text(font: "New Computer Modern Math")

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
// An odd number of $ (malformed/unbalanced input) falls back to literal text
// instead of a hard compile failure.
// Multi-letter runs inside $...$ are variable lookups in Typst math, so a
// prose word makes eval() raise "unknown variable: <word>" and abort the
// entire compile. Not hypothetical: "Pencils cost $2.50 per package and
// pens cost $3 per package" pairs two currency dollars into a fake math
// segment and dies on "per". Typst has no try/catch, so the check has to
// come before eval -- a segment counts as math only when every multi-letter
// run in it is an identifier Typst math actually defines. Deliberately
// conservative: words that are overwhelmingly ordinary English in this
// content ("and", "not", "text") are left out. Operator words the generator
// genuinely emits per its 11b MATH rule ("times", "div", "dot", "min",
// "max", "in", "macron", ...) ARE included -- excluding them silently
// degraded real equations like "$a div b := a times 1/b$" to literal text,
// dollar signs and all, on a printed student packet. Every entry was
// verified to eval() cleanly in math mode against the shipped compiler
// (see typst-rich-inline-math.test.ts); an entry that Typst does NOT
// define belongs in math-aliases below instead, never here alone, or a
// genuine math segment using it aborts the whole compile.
#let math-idents = (${TYPST_MATH_IDENTS.map((i) => JSON.stringify(i)).join(", ")},)

// Operator names the generator emits out of LaTeX habit that Typst math
// does NOT define. They pass the identifier check above (so the segment
// still counts as math) and are rewritten to the real Typst symbol just
// before eval -- without this, eval() dies on "unknown variable: leq" and
// takes the entire document with it.
#let math-aliases = (${MATH_ALIASES.map(([a, b]) => `(${JSON.stringify(a)}, ${JSON.stringify(b)})`).join(", ")},)

#let normalize-math(seg) = {
  let out = seg
  for (name, sym) in math-aliases {
    out = out.replace(regex("\\\\b" + name + "\\\\b"), sym)
  }
  out
}

#let looks-like-math(seg) = {
  // Quoted spans are literal text in Typst math -- the 11b MATH rule
  // requires named operators be written that way ($"Var"(X)$) -- so the
  // words inside them are always valid and must not fail the check.
  let unquoted = seg.replace(regex("\\"[^\\"]*\\""), " ")
  // A LETTER glued to a digit is one identifier to Typst -- "m1", "A1",
  // "S3E11" -- and an unknown identifier aborts the whole document rather
  // than degrading. The loop below cannot catch it: it looks for runs of two
  // or more LETTERS, and those runs have none. This costs nothing in false
  // rejections, because a span containing such an identifier could never
  // have compiled in the first place; it only turns a packet that would not
  // print into one that prints this span verbatim.
  //
  // A DIGIT glued to a letter is a different thing and is fine: "6x^2" lexes
  // as a number beside a variable, which is why the pattern starts on a
  // letter.
  if unquoted.matches(regex("[A-Za-z][A-Za-z0-9]*[0-9]")).len() > 0 { return false }
  // A dotted path is ONE symbol -- "arrow.l.r.double" -- and its modifiers
  // are not identifiers in their own right. See typstGateAccepts() in
  // lib/math-typesetting.ts: the same check there rejected a span this
  // pipeline had just written itself.
  let paths = unquoted.replace(
    regex("([A-Za-z]+)(\\.[A-Za-z]+)+"),
    m => m.captures.at(0),
  )
  for m in paths.matches(regex("[A-Za-z]{2,}")) {
    if not math-idents.contains(lower(m.text)) { return false }
  }
  true
}

// An ESCAPED dollar is a dollar SIGN, and never a delimiter.
//
// A.1 is set at a ticket window, so it prices things: sixty per adult, five
// hundred and seventy in total. Thirteen of its lines carried one such
// amount and nothing else with a dollar in it, which left an ODD number of
// "$" in the line -- and both ends of the pipeline gave up on a line like
// that. lib/math-typesetting.ts handed it back untypeset, so an expression
// in the same sentence never became mathematics; this function then printed
// the whole line verbatim. A.1 priced its tickets correctly and typeset no
// mathematics anywhere near a price.
//
// escapeCurrencyDollars() in that module now decides which "$" is which and
// marks the currency ones. All this has to do is take them out of the
// pairing, and put them back once the pairing is settled -- including on
// every path that gives up, or the escape itself would print.
#let dollar-sign = ${dollarSentinel}

#let rich-legacy(raw) = {
  let s = raw.replace(${escapedDollar}, dollar-sign)
  let literal = raw.replace(${escapedDollar}, "$")
  let parts = s.split("$")
  if calc.rem(parts.len(), 2) == 0 {
    return [#literal]
  }
  // A candidate segment that is really prose means the $-pairing was never
  // math; render the string exactly as written rather than evaluating a
  // fragment that would take the whole document down with it.
  for (i, part) in parts.enumerate() {
    if calc.rem(i, 2) == 1 and not looks-like-math(part) {
      return [#literal]
    }
  }
  let out = []
  for (i, part) in parts.enumerate() {
    if calc.rem(i, 2) == 0 {
      out += [#part.replace(dollar-sign, "$")]
    } else {
      out += eval(normalize-math(part.replace(dollar-sign, "$")), mode: "math")
    }
  }
  out
}

// The real rich(): a trusted channel first, the guessing one underneath.
//
// Spans wrapped in TRUSTED_MATH_DELIM were converted from LaTeX to Typst by
// lib/latex-to-typst.ts, which built every bracket and every identifier in
// them itself. They do not need looks-like-math()'s guess and must not be
// subjected to it -- the gate rejects any multi-letter run it does not
// recognise, which would throw out mat(delim: "[", ...) and every other
// construct that carries a named argument.
//
// Everything OUTSIDE those markers is packet prose exactly as before, so the
// currency-dollar protection that rich-legacy() exists for is untouched: a
// legacy $...$ span still has to earn its evaluation.
//
// An odd marker count means the pairing was broken in transit; the whole
// string then goes down the legacy path rather than evaluating half a span.
#let rich-line(s) = {
  let chunks = s.split(${trustedDelim})
  if chunks.len() == 1 { return rich-legacy(s) }
  if calc.rem(chunks.len(), 2) == 0 { return rich-legacy(s) }
  let out = []
  for (i, chunk) in chunks.enumerate() {
    if calc.rem(i, 2) == 0 {
      out += rich-legacy(chunk)
    } else {
      out += eval(chunk, mode: "math")
    }
  }
  out
}

// A newline in a prompt is a line on the page.
//
// Without this, a question with lettered parts had only one shape available:
// "(a) ... (b) ... (c) ..." run together in a paragraph, because a string
// interpolated into Typst content renders its newlines as spaces. A student
// scanning for part (d) then has to read the whole paragraph to find it.
// Splitting here lets a prompt put its stem on one line and each lettered
// part on its own, which is how the A.1 and A.2 packets read on paper.
//
// The split happens BEFORE any $-pairing, which is safe because a math span
// never contains a newline -- the preview's own splitter assumes the same
// (see splitSegments in components/LatexRenderer.tsx).
#let rich(s) = {
  let lines = s.split("\n")
  if lines.len() == 1 { return rich-line(s) }
  let out = []
  for (i, line) in lines.enumerate() {
    if i > 0 { out += linebreak() }
    if line.trim() != "" { out += rich-line(line) }
  }
  out
}

// A labelled rectangle partitioned into cells: the area model.
// See AreaModelSpec in typst-payload.ts for why a packet prints the rectangle
// rather than asking the student to draw it.
#let area-model(spec) = {
  let tops = spec.at("topLabels", default: ())
  let sides = spec.at("sideLabels", default: ())
  let cells = spec.at("cells", default: ())
  if tops.len() == 0 or sides.len() == 0 { return [] }
  // Weights are lengths, in one shared unit across BOTH axes -- which is the
  // whole point of an area model: the side of length x has to be drawn the
  // same length going across as it is going down, or the picture contradicts
  // the algebra. Equal cells when no weights are given.
  let tw = spec.at("topWeights", default: ())
  let sw = spec.at("sideWeights", default: ())
  let unit = 16pt
  let col-w = range(tops.len()).map(i => if tw.len() > i { tw.at(i) * unit } else { 84pt })
  let row-h = range(sides.len()).map(i => if sw.len() > i { sw.at(i) * unit } else { 38pt })
  block(breakable: false, width: 100%, inset: (y: 4pt))[
    #align(center)[
      #grid(
        columns: (30pt,) + col-w,
        rows: (14pt,) + row-h,
        align: center + horizon,
        [],
        ..tops.map(t => text(size: 9pt, weight: "bold")[#rich(t)]),
        ..range(sides.len()).map(r => (
          text(size: 9pt, weight: "bold")[#rich(sides.at(r))],
          ..range(tops.len()).map(c => rect(
            width: 100%, height: 100%, stroke: 0.7pt + col-border, inset: 3pt,
          )[#align(center + horizon)[#text(size: 10pt)[#if cells.len() > r and cells.at(r).len() > c { rich(cells.at(r).at(c)) }]]]),
        )).flatten(),
      )
    ]
    #if spec.at("caption", default: "") != "" [
      #v(3pt)
      #align(center)[#text(size: 8pt, style: "italic", fill: rgb("#6b7280"))[#rich(spec.caption)]]
    ]
  ]
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
//
// Each box carries its OWN section's heading. It used to print a running
// count -- "Part 1" through "Part #sections" -- which silently assumed the
// sections were named Part 1..N in order. They never are. The shipped B.4
// packet has ten sections headed Part 0, Parts 1-5, Reflection, Optional
// Extension, B.5 Pre-Class Prep and Teacher's Companion, so every box was
// off by one against the page it referred to, and the last one pointed at a
// section the student never receives. A.1 and A.2 had the same mismatch.
//
// Only the leading name is used, not the whole heading: "Part 4 -- Splitting
// the Middle: Grouping as the General Method" is a title, not a tick-box
// label, and ten of those would not fit on the line.
#if tmpl.progressTracker.enabled [
  #let tracker-label(h) = {
    let parts = h.split("\u{2014}")          // em dash, as the headings use
    let name = if parts.len() > 1 { parts.at(0) } else { h }
    // This label is a plain string, not rich() content, so a trusted-math
    // marker would print as a notdef box rather than typeset. Headings are
    // never mathematics; drop the marker rather than risk the glyph.
    name.replace(${trustedDelim}, "").trim()
  }
  // The Teacher's Companion is torn off before the packet is handed out, so
  // a student cannot tick it. Drop it rather than print a box for a page
  // they will never hold.
  #let tracked = content.sections.filter(
    (s) => not lower(s.heading).contains("companion")
  )
  #if tracked.len() > 0 [
    #text(size:8pt,fill:rgb("#6b7280"))[
      *#tmpl.progressTracker.label* #h(4pt)
      #for s in tracked [ #tracker-label(s.heading) \u{25a1} #h(4pt) ]
    ]
    #v(6pt)
  ]
]

// Command Terms strip
#if "commandTerms" in content and content.commandTerms.len() > 0 [
  #line(length:100%,stroke:(dash:"dashed",thickness:0.5pt,paint:col-strip))
  #block(fill:col-strip.lighten(90%),width:100%,inset:(x:8pt,y:6pt))[
    #block(fill:col-strip,inset:(x:6pt,y:3pt))[#text(size:8pt,weight:"bold",fill:white)[#upper("Command Terms")]]
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
        #if "areaModel" in q [ #area-model(q.areaModel) ]
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
//
// Every block below is optional and guarded with .at(.., default: ..): a
// packet written before this existed has no teacherCompanion at all, and the
// Typst dict is all-or-nothing, so an unguarded field access would not print
// a thinner companion -- it would refuse to print the packet.
//
// There are deliberately no answer sketches here. The authoritative key is
// na_rubric_items, exported by /api/na-review/rubric/[id]?format=html, and a
// second copy would drift from it the first time a question was edited.
#if opts.at("includeTeacherCompanion",default:false) [
  #pagebreak()
  #line(length:100%,stroke:2pt+col-accent)
  #v(4pt)
  #text(size:14pt,weight:"bold",fill:col-accent)[Teacher's Companion]
  #v(2pt)
  #callout-box(text(size:9pt)[*For the instructor only.* Remove before distributing. The answer key is a separate document.],fill-color:rgb("#faf5ff"),border-color:col-accent)

  #let tc = content.at("teacherCompanion", default: (:))

  #if "designNote" in tc [
    #v(8pt)
    #text(size:10.5pt,weight:"bold")[A. Why the packet is built this way]
    #v(3pt)
    #text(size:9.5pt)[#rich(tc.designNote)]
  ]

  #let slots = tc.at("tieredDeadlines", default: ())
  #if slots.len() > 0 [
    #v(8pt)
    #text(size:10.5pt,weight:"bold")[B. What fits in which slot]
    #v(3pt)
    #table(columns:(auto,1fr),stroke:0.4pt+col-border,
      table.header(text(weight:"bold",size:9pt)[Slot],text(weight:"bold",size:9pt)[Covers]),
      ..for r in slots { (text(size:9pt)[#rich(r.slot)],text(size:9pt)[#rich(r.covers)]) }
    )
  ]

  #let imap = tc.at("integrationMap", default: ())
  #if imap.len() > 0 [
    #v(8pt)
    #text(size:10.5pt,weight:"bold")[C. Integration map]
    #v(3pt)
    #table(columns:(auto,1fr),stroke:0.4pt+col-border,
      table.header(text(weight:"bold",size:9pt)[IB element],text(weight:"bold",size:9pt)[Where it lives]),
      ..for r in imap { (text(size:9pt,weight:"bold")[#rich(r.element)],text(size:9pt)[#rich(r.location)]) }
    )
  ]

  #let notes = tc.at("partNotes", default: ())
  #if notes.len() > 0 [
    #v(8pt)
    #text(size:10.5pt,weight:"bold")[D. Running it, Part by Part]
    #for n in notes [
      #v(5pt)
      #block(breakable:false)[
        #text(size:9.5pt,weight:"bold")[#rich(n.part)]
        #if "timing" in n [ #h(4pt) #text(size:8.5pt,fill:col-accent)[#rich(n.timing)] ]
        #if "purpose" in n [ #v(2pt) #text(size:9pt,style:"italic")[#rich(n.purpose)] ]
        #let watch = n.at("watchFor", default: ())
        #if watch.len() > 0 [
          #v(2pt)
          #text(size:8.5pt,weight:"bold",fill:rgb("#b45309"))[WATCH FOR]
          #for w in watch [
            #v(1pt)
            #text(size:9pt)[- #rich(w)]
          ]
        ]
        #if "ifStuck" in n [
          #v(2pt)
          #text(size:9pt)[*If stuck:* #rich(n.ifStuck)]
        ]
      ]
    ]
  ]

  #let errs = tc.at("plantedErrors", default: ())
  #if errs.len() > 0 [
    #v(8pt)
    #text(size:10.5pt,weight:"bold")[E. Planted errors]
    #for e in errs [
      #v(4pt)
      #block(breakable:false)[
        #text(size:9.5pt,weight:"bold")[#rich(e.question) -- #rich(e.misconceptionName)]
        #v(2pt)
        #text(size:9pt)[#rich(e.errorDescription)]
        #if "correctAnswer" in e [ #v(2pt) #text(size:9pt)[*Correct:* #rich(e.correctAnswer)] ]
        #if "hlConcept" in e [ #v(2pt) #text(size:9pt)[*HL concept:* #rich(e.hlConcept)] ]
      ]
    ]
  ]
]
`;
}
