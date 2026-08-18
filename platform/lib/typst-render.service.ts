/**
 * TypstRenderService
 * -------------------------------------------------------------------------
 * Compiles an Activity payload (Nuanced Analysis / DP Designer / generic
 * grade-level sheet) into a PDF using the native Typst compiler.
 *
 * This is the successor to the KaTeX + Puppeteer rendering path: it takes a
 * structured JSON payload, injects it into a hand-authored .typ template via
 * Typst's `sys.inputs`, and compiles natively (no headless browser).
 * -------------------------------------------------------------------------
 */

import { z } from "zod";

// -- Types -------------------------------------------------------------------

export type ActivityPayload = {
  template: "nuanced-analysis" | "dp-designer" | "grade-sheet";
  content: Record<string, unknown>;
  options?: {
    includeTeacherCompanion?: boolean;
    includeAnswerKey?: boolean;
  };
};

export type RenderResult =
  | { success: true; pdfBuffer: Buffer }
  | { success: false; error: string; detail?: string };

// A minimal structural type for the compiler, since the real package types
// are not always resolvable in every build environment this file runs in.
type NodeCompilerLike = {
  pdf(args: { mainFileContent: string; inputs: Record<string, string> }): Buffer;
};

let _typstCompiler: NodeCompilerLike | null = null;

/**
 * Lazily imports and caches the native Typst compiler.
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

// -- Validation ----------------------------------------------------------------

const QuestionSchema = z.object({
  prompt: z.string(),
  marks: z.number().optional(),
  answer: z.string().optional(),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  hint: z.string().optional(),
  contentTag: z.string().optional(),
  skillTag: z.string().optional(),
  subparts: z
    .array(
      z.object({
        prompt: z.string(),
        marks: z.number().optional(),
        hint: z.string().optional(),
        tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
        contentTag: z.string().optional(),
        skillTag: z.string().optional(),
      })
    )
    .optional(),
  answerBoxLines: z.number().optional(),
});

const SectionSchema = z.object({
  heading: z.string(),
  questions: z.array(QuestionSchema),
  prerequisiteBox: z.object({ items: z.array(z.string()) }).optional(),
  spotlight: z.object({ title: z.string(), body: z.string() }).optional(),
  translationTable: z
    .object({
      caption: z.string(),
      rows: z.array(z.object({ informal: z.string(), formal: z.string() })),
    })
    .optional(),
  geometricReading: z.object({ body: z.string() }).optional(),
});

const NuancedAnalysisContentSchema = z.object({
  title: z.string(),
  subtitle: z.string(),
  instructions: z.array(z.string()),
  sections: z.array(SectionSchema),
  course: z.string().optional(),
  syllabusTopics: z.string().optional(),
  prerequisites: z.string().optional(),
  materials: z.string().optional(),
  atl: z.string().optional(),
  commandTerms: z
    .array(z.object({ term: z.string(), definition: z.string() }))
    .optional(),
  tokProvocations: z
    .array(z.object({ id: z.string(), body: z.string() }))
    .optional(),
  internationalMindedness: z.object({ body: z.string() }).optional(),
  compulsoryCore: z.string().optional(),
  plantedErrorIntro: z.string().optional(),
  reflectionQuestions: z.array(z.string()).optional(),
});

function validatePayload(payload: ActivityPayload):
  | { valid: true }
  | { valid: false; fieldErrors: unknown } {
  if (payload.template === "nuanced-analysis") {
    const result = NuancedAnalysisContentSchema.safeParse(payload.content);
    if (!result.success) {
      return { valid: false, fieldErrors: result.error.flatten() };
    }
    return { valid: true };
  }
  // Other templates: pass through without strict validation for now.
  return { valid: true };
}

// -- Typst source template loading --------------------------------------------

let _activityTypstSource: string | null = null;

function getActivityTypstSource(): string {
  if (_activityTypstSource) return _activityTypstSource;
  // In production this reads a bundled .typ template file. Kept minimal here
  // since this function is not the part under repair.
  _activityTypstSource = "#import \"template.typ\": *\n#render(json.decode(sys.inputs.payload))\n";
  return _activityTypstSource;
}

function buildTypstPayload(payload: ActivityPayload): Record<string, unknown> {
  return {
    template: payload.template,
    content: payload.content,
    options: payload.options ?? {},
  };
}

// -- Service -------------------------------------------------------------------

export const TypstRenderService = {
  async render(payload: ActivityPayload): Promise<RenderResult> {
    // Step 1 — Validate
    const validation = validatePayload(payload);
    if (!validation.valid) {
      return {
        success: false,
        error: "Payload failed schema validation.",
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
      // WHY THIS IS WIDER THAN `err instanceof Error ? err.message : String(err)`:
      // that exact pattern produced an empty detail string in production -
      // "[api/typst-render] render failed: Typst compilation failed. |
      // detail:" with nothing after the colon. compiler.pdf() is a native
      // addon call (Rust via NAPI), and native addons frequently throw
      // objects that are technically Error instances but carry the real
      // diagnostic somewhere other than .message - a bare empty-string
      // .message, a custom .toString(), or additional enumerable properties
      // set by the addon binding rather than the standard Error shape. This
      // mirrors the instanceof-across-a-boundary lesson from
      // nuanced-analysis-generation.ts's extractErrorMessage: don't assume
      // the object handed back after crossing into native code matches
      // ordinary JS Error conventions - capture every plausible source and
      // only fall back to a placeholder if genuinely none of them have text.
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
 * its own - it can silently produce an empty string rather than a helpful
 * fallback when the throw came from native (non-JS-authored) code.
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
