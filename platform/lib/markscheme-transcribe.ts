/**
 * One PPQ question's mark-scheme images -> a structured transcription.
 *
 * buildTranscriptionRequest() is the single request both senders use: the
 * synchronous (streamed) call of scripts/build-mark-schemes.ts (gold runs,
 * pilots, questions already in use) and one entry of a Message Batch (the
 * bulk run). Keeping one builder is what keeps the two from transcribing the
 * same images differently -- the same reason lib/ai-grading-run.ts has one
 * buildGradingRequest().
 *
 * The system prompt is identical for every question, so it is cached. It
 * embeds IB_LATEX_STYLE_GUIDE verbatim (that guide asks to be used verbatim)
 * and then states where the bank's rules for schemes differ from it.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { IB_LATEX_STYLE_GUIDE } from "@/lib/latex-utils";
import { TranscribedSchemeSchema, type TranscribedScheme } from "@/lib/markscheme-build";

export const MARKSCHEME_BUILD_MODEL = "claude-opus-5";

/** Bumped whenever the prompt changes, so builds record which one they ran. */
export const MARKSCHEME_PROMPT_VERSION = "2026-09-26.1";

export type TranscriptionEffort = "low" | "medium" | "high" | "xhigh" | "max";

export interface SchemeImage {
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  base64: string;
}

export function mediaTypeForPath(path: string): SchemeImage["mediaType"] {
  const ext = path.toLowerCase().split(".").pop();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  return "image/png";
}

/**
 * The media type the bytes actually are, falling back to the extension. The
 * API rejects an image whose declared type does not match its content, and
 * a Doc import names every file by the type the Doc reported.
 */
export function mediaTypeForBytes(bytes: Uint8Array, path: string): SchemeImage["mediaType"] {
  const at = (i: number) => bytes[i] ?? -1;
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "image/png";
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46) return "image/gif";
  if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45) {
    return "image/webp";
  }
  return mediaTypeForPath(path);
}

export function buildTranscriptionSystemPrompt(): string {
  return `You transcribe one question's IB Mathematics mark scheme from images into LaTeX for a teacher's question bank. A grader will mark students' work against exactly what you write, so fidelity is everything: every expression, number, sign, mark code and note must match the images.

WHAT YOU RECEIVE
- One or more images of a typeset IB mark scheme. They may be in any order. A page may also show the end of the question before or the start of the question after.
- The number of the question to transcribe. Transcribe that question only.

WHAT YOU RETURN
- parts: one entry per lowest-level part that prints its own "[N marks]". (a) and (b) are separate parts. When (b)(i) and (b)(ii) each print their own marks they are separate parts, labelled "(b)(i)" and "(b)(ii)"; when only (b) prints marks, (b) is one part and its (i) and (ii) stay inside its text. A question with no labelled parts is a single part with label "".
- label: exactly as printed, e.g. "(a)" or "(b)(ii)".
- marks: the part's printed "[N marks]", or null when the scheme prints none for it.
- latex: that part's scheme only. Do not start it with the part's own label. End it with \\hfill [N marks] when marks are printed. Never put the question's "Total [N marks]" line in any part; give that number as totalMarks.
- questionNumber: the question number printed on the scheme, or null. totalMarks: the printed total, or null.
- unreadable: every place where you are not certain of a character, digit, sign, exponent or code. Leave it empty only when you are certain of everything.
- sourceProblems: anything wrong with the images themselves: they show a different question, the scheme is cut off or continues beyond them, a part seems missing, the scheme contains a diagram you could not transcribe, or the scheme itself contains an obvious misprint. Empty when there are none.

HOW TO WRITE THE LATEX
${IB_LATEX_STYLE_GUIDE}

For mark schemes these rules come first, and override the guide above where they differ:
- Maths: $...$ inline and $$...$$ for display. Never \\[...\\] or \\(...\\). Never \\begin{IBPart} or \\begin{enumerate}.
- Mark codes: each code goes at the end of the line it annotates, after \\hfill, exactly as printed: (M1), M1, A1, (A1)(A1), M1A1, A2, R1, AG, N2, and combinations such as A1 N2 or A1A1 N2. Never put a code inside maths. Never drop the brackets of an implied mark. Never split or merge codes: A2 stays A2 and A1A1 stays A1A1.
- Keep every structural line as its own line of text: METHOD 1 / METHOD 2, EITHER / OR / THEN, "Note: ..." lines, and phrases such as "eg", "accept", "award", "do not award", "(seen anywhere)", "FT". Transcribe them verbatim.
- Sub-parts that share their parent's marks start on their own line with their printed label, e.g. "(i)".
- One line per line of the scheme, with a blank line between separate steps.
- Transcribe only the mark scheme, never the question.
- Do not add, correct or complete anything. If the scheme contains a misprint, transcribe it as printed and mention it in sourceProblems.
- A diagram or graph in the scheme becomes one line such as [diagram: sketch of a cubic through the origin with a minimum near x = 2], and a sourceProblems entry saying so.`;
}

export function buildTranscriptionUserText(code: string, questionNumber: number | null): string {
  const which = questionNumber !== null ? `question ${questionNumber}` : "the question shown";
  return `Transcribe the mark scheme of ${which} (question bank code ${code}). The images above are all the scheme images stored for it.`;
}

export function buildTranscriptionRequest(args: {
  code: string;
  questionNumber: number | null;
  images: SchemeImage[];
  effort: TranscriptionEffort;
  maxTokens: number;
  model?: string;
}): Anthropic.MessageCreateParamsNonStreaming {
  const content: Anthropic.ContentBlockParam[] = args.images.map((img) => ({
    type: "image",
    source: { type: "base64", media_type: img.mediaType, data: img.base64 },
  }));
  content.push({ type: "text", text: buildTranscriptionUserText(args.code, args.questionNumber) });

  return {
    model: args.model ?? MARKSCHEME_BUILD_MODEL,
    max_tokens: args.maxTokens,
    thinking: { type: "adaptive" },
    system: [{ type: "text", text: buildTranscriptionSystemPrompt(), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
    output_config: {
      effort: args.effort,
      format: zodOutputFormat(TranscribedSchemeSchema),
    },
  };
}

export type TranscriptionResult =
  | { ok: true; scheme: TranscribedScheme }
  | { ok: false; error: string };

/**
 * The transcription in a response, validated. parsed_output exists only on
 * a parse() or stream() response; a batch result carries the JSON in its
 * text block, which is validated with the same schema. A refusal or a response
 * cut off at max_tokens is a failed build, never a partial one: batches
 * cannot take the fallbacks parameter, so there is no second model to ask.
 */
export function parseTranscription(message: Anthropic.Message & { parsed_output?: unknown }): TranscriptionResult {
  if (message.stop_reason === "refusal") {
    return { ok: false, error: `The model declined (${message.stop_details?.category ?? "no category"}).` };
  }
  if (message.stop_reason === "max_tokens") {
    return { ok: false, error: "The response was cut off at max_tokens." };
  }

  let raw: unknown = message.parsed_output ?? null;
  if (raw === null) {
    const text = message.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
    if (!text) return { ok: false, error: "The response had no text block." };
    try {
      raw = JSON.parse(text);
    } catch {
      return { ok: false, error: "The response was not valid JSON." };
    }
  }
  const parsed = TranscribedSchemeSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: `The response did not match the schema: ${parsed.error.issues[0]?.message ?? "unknown"}` };
  }
  return { ok: true, scheme: parsed.data };
}
