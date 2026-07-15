import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { sanitizeJsonBackslashes } from "@/lib/json-repair";
import {
  validateNuancedAnalysisSpec,
  type NuancedAnalysisSpec,
} from "@/lib/nuanced-analysis-spec.schema";
import { compileSpecToChecklist } from "@/lib/nuanced-analysis-spec.compile";

export const runtime = "nodejs";
// Opus re-emitting the full spec JSON (plus thinking) can take a while.
export const maxDuration = 300;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// The heavy-reasoning model used across this codebase for editing/analysis work
// (matches generation.preferredEditingModel in the canonical spec).
const EDITING_MODEL = "claude-opus-4-5";

const EDIT_SYSTEM_PROMPT = `You are the CleverMathematics Template Architect. You edit a NuancedAnalysisSpec — the validated JSON object that defines the pedagogical contract every generated IBDP Nuanced Analysis packet must obey (cognitive arc, three-phase flipped/in-class/take-home delivery, packet order, the eight universal design layers, planted errors, TOK, reflection, Teacher's Companion, verification, output contract).

You will receive the CURRENT spec JSON and an INSTRUCTION from a teacher describing a change. Apply the instruction faithfully and conservatively.

HARD RULES — violating any of these makes your output unusable:
1. Output ONLY the complete, updated JSON object. No prose, no explanation, no markdown code fences. Your entire reply must parse with JSON.parse().
2. Preserve the exact object structure: do not add, remove, or rename keys. Only change VALUES (strings, numbers, booleans, and the contents of arrays whose lengths are allowed to vary).
3. Fixed cardinalities you must never change: designLayers.layers has exactly 8 entries; designLayers.tiers exactly 3; designLayers.scaffoldHierarchy exactly 5; outputContract.partPhaseTagValues is exactly ["flipped","inClass","takeHome"]; tok.countExactly stays 2; threePhaseModel.enabled stays true.
4. Do not change identity.course (programme/subject/strand/level/label/studentAgeRange) — course identity is managed outside this editor.
5. Keep every rule object in the {id, rule, rationale?} shape; keep ids stable for rules you are only rewording, and invent short-kebab-case ids for genuinely new rules.
6. Respect field length limits: rule texts under 1200 characters, guidance strings under 600, names under 160.
7. Update identity.specVersion to today's date with a bumped suffix (format YYYY-MM-DD.N).
8. If the instruction asks for something these rules forbid, apply the closest allowed change and leave the rest of the spec untouched.
9. Preserve the platform copy rules verbatim (the "Clev's Marks" and "intersects" rules) unless the instruction explicitly targets them.`;

function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

async function callOpus(
  messages: Anthropic.MessageParam[],
): Promise<string> {
  // .stream().finalMessage() — the SDK requires streaming above ~21,333
  // max_tokens (same pattern as generate-packet). Adaptive-thinking models may
  // lead with a thinking block, so find the text block by type.
  const stream = anthropic.messages.stream({
    model: EDITING_MODEL,
    max_tokens: 32000,
    system: EDIT_SYSTEM_PROMPT,
    messages,
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "max_tokens") {
    console.error("[spec-edit] Opus response truncated at max_tokens.", message.usage);
  }
  const textBlock = message.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );
  return textBlock?.text ?? "";
}

function parseAndValidate(raw: string): {
  spec: NuancedAnalysisSpec | null;
  errorSummary: string | null;
  fieldErrors: Record<string, string> | null;
} {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) {
    return {
      spec: null,
      errorSummary: "The model's reply contained no JSON object.",
      fieldErrors: null,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(sanitizeJsonBackslashes(jsonText));
  } catch (e: any) {
    return {
      spec: null,
      errorSummary: `JSON.parse failed: ${e?.message ?? "unknown"}`,
      fieldErrors: null,
    };
  }
  const validated = validateNuancedAnalysisSpec(parsed);
  if (!validated.success) {
    return {
      spec: null,
      errorSummary: validated.error,
      fieldErrors: validated.fieldErrors,
    };
  }
  return { spec: validated.data, errorSummary: null, fieldErrors: null };
}

/** Top-level sections whose serialized content differs between two specs. */
function changedSections(
  before: NuancedAnalysisSpec,
  after: NuancedAnalysisSpec,
): string[] {
  const keys = Object.keys(before) as (keyof NuancedAnalysisSpec)[];
  return keys.filter(
    (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]),
  );
}

/**
 * POST /api/nuanced-analysis-spec/edit
 * Body: { instruction: string, spec: NuancedAnalysisSpec }
 *
 * Asks Claude Opus to apply the natural-language instruction to the spec,
 * Zod-validates the result, and — if invalid — retries ONCE with the exact
 * validation errors fed back. This route only PROPOSES the edited spec; saving
 * is a separate, explicit PUT to /api/nuanced-analysis-spec so the teacher can
 * review changes first.
 */
export async function POST(request: Request) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;

  try {
    const { instruction, spec } = await request.json();

    if (typeof instruction !== "string" || instruction.trim().length === 0) {
      return NextResponse.json(
        { error: "Missing 'instruction' (a non-empty string)." },
        { status: 400 },
      );
    }

    // The edit must start from a valid spec — otherwise the model would be
    // fixing corruption rather than applying an instruction.
    const startValidated = validateNuancedAnalysisSpec(spec);
    if (!startValidated.success) {
      return NextResponse.json(
        {
          error: "The provided spec is not valid — reload it before editing.",
          fieldErrors: startValidated.fieldErrors,
        },
        { status: 422 },
      );
    }
    const currentSpec = startValidated.data;

    const baseUserMessage =
      `CURRENT SPEC JSON:\n${JSON.stringify(currentSpec)}\n\n` +
      `INSTRUCTION:\n${instruction.trim()}\n\n` +
      `Reply with ONLY the complete updated JSON object.`;

    // Attempt 1
    const firstRaw = await callOpus([{ role: "user", content: baseUserMessage }]);
    let result = parseAndValidate(firstRaw);

    // Attempt 2 (only if attempt 1 failed): feed the exact errors back.
    if (!result.spec) {
      const retryMessages: Anthropic.MessageParam[] = [
        { role: "user", content: baseUserMessage },
        { role: "assistant", content: firstRaw || "(empty reply)" },
        {
          role: "user",
          content:
            `Your previous reply was rejected: ${result.errorSummary}` +
            (result.fieldErrors
              ? `\nField errors:\n${JSON.stringify(result.fieldErrors, null, 2)}`
              : "") +
            `\nFix these problems and reply again with ONLY the complete, valid updated JSON object. Do not change anything else.`,
        },
      ];
      const secondRaw = await callOpus(retryMessages);
      result = parseAndValidate(secondRaw);
    }

    if (!result.spec) {
      return NextResponse.json(
        {
          error:
            "The AI edit did not produce a valid spec after a retry. Nothing was changed.",
          detail: result.errorSummary,
          fieldErrors: result.fieldErrors,
        },
        { status: 422 },
      );
    }

    // Server-side guard for rule 4: course identity must not move.
    const editedSpec = result.spec;
    if (
      JSON.stringify(editedSpec.identity.course) !==
      JSON.stringify(currentSpec.identity.course)
    ) {
      return NextResponse.json(
        {
          error:
            "The edit attempted to change the course identity, which this editor does not allow. Nothing was changed.",
        },
        { status: 422 },
      );
    }

    return NextResponse.json({
      success: true,
      spec: editedSpec,
      changedSections: changedSections(currentSpec, editedSpec),
      specVersion: editedSpec.identity.specVersion,
      checklist: compileSpecToChecklist(editedSpec),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Spec edit failed" },
      { status: 500 },
    );
  }
}
