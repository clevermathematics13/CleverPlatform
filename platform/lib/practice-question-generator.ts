/**
 * Writes an original practice question modelled on a past paper question.
 *
 * The teacher's problem this solves: a past paper question used for practice
 * can no longer be used to assess, because the class has seen it. The bank is
 * finite -- about a hundred integration questions tagged in the whole thing --
 * so spending them on revision is expensive. This writes a new question that
 * exercises the same technique at the same tariff, leaving the original
 * unused.
 *
 * The authoring rules live in `question_authoring/practice_question_authoring.md`
 * and are loaded at runtime, the same arrangement as the grading policy and
 * the NA feedback voice: the teacher can edit how questions are written
 * without a deploy, and the rules sit somewhere a person can read them. Edit
 * that file, not a copy of its text. buildAuthoringSystemPrompt() is the only
 * way to build the prompt -- the constants below are deliberately unexported,
 * so a caller that forgets the rules is a compile error rather than a batch of
 * quietly worse questions.
 *
 * The model is shown the source question as an IMAGE. The bank's LaTeX is
 * sparse (98 of 2095 parts) and its OCR text is mangled, so the rendered page
 * is the only faithful representation of most questions. It is also the one a
 * teacher would hand you if you asked what the question was.
 *
 * Nothing here writes to the database, and nothing here approves anything. A
 * generated question reaches a student only after a teacher has read it and
 * approved it -- see the approved_at gate in migration 20260911170521.
 */

import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { normaliseTariffs } from "@/lib/latex-hfill";

export const PRACTICE_GENERATOR_MODEL = "claude-opus-5";

const AUTHORING_GUIDE_PATH = path.join(
  process.cwd(),
  "question_authoring",
  "practice_question_authoring.md"
);

function loadAuthoringGuide(): string {
  try {
    return fs.readFileSync(AUTHORING_GUIDE_PATH, "utf8").trim();
  } catch (e) {
    throw new Error(
      `Could not load the practice question authoring guide from ${AUTHORING_GUIDE_PATH}: ${
        e instanceof Error ? e.message : String(e)
      }`
    );
  }
}

const AUTHORING_GUIDE = loadAuthoringGuide();

/** Schema of what the model returns. Also the shape stored on the item. */
const GeneratedQuestionSchema = z.object({
  questionLatex: z
    .string()
    .describe("The question as a student sees it. Body LaTeX only."),
  answerLatex: z
    .string()
    .describe("The worked mark scheme, with IB M1/A1/R1 attribution summing to the tariff."),
  difference: z
    .string()
    .describe(
      "One or two sentences for the teacher: how this differs from the source, and why the source is still safe to set as an assessment."
    ),
  concerns: z
    .array(z.string())
    .describe(
      "Anything the author is unsure about: an answer that would not come out clean, a tariff that felt wrong, a check left incomplete. Empty when there are genuinely none."
    ),
});

export type GeneratedQuestion = z.infer<typeof GeneratedQuestionSchema>;

export interface GenerationSource {
  /** The bank question being modelled on, for provenance and the prompt. */
  code: string;
  /** Sub-topic codes with their descriptors, e.g. "5.16 (parts) Integration by parts". */
  subtopics: string[];
  marks: number;
  /** 1 (no calculator) or 2 (GDC). Null when the bank has no paper recorded. */
  paper: number | null;
  /** PNG bytes of the rendered question page. */
  imageBase64: string;
  imageMediaType: "image/png" | "image/jpeg";
}

/**
 * The system prompt. Not exported: every caller must go through
 * buildAuthoringSystemPrompt() so the authoring guide cannot be skipped.
 */
const ROLE_PREAMBLE = `You write original mathematics questions for IB Diploma Programme Analysis and Approaches Higher Level.

The rules that follow are the teacher's own, loaded from the platform at runtime. Follow them exactly. They are not suggestions, and the first of them -- that your question must not be a reworded copy of the source -- is the entire reason this task exists.`;

export function buildAuthoringSystemPrompt(): string {
  return `${ROLE_PREAMBLE}\n\n---\n\n${AUTHORING_GUIDE}`;
}

/** The per-question instruction. Exported for the tests, which assert that the
 *  tariff, the sub-topic and the calculator status all reach the model. */
export function buildGenerationRequest(source: GenerationSource): string {
  const calculator =
    source.paper === 2
      ? "Paper 2: a GDC is allowed, so an answer may be a decimal and the set-up is what is being assessed."
      : source.paper === 1
        ? "Paper 1: NO calculator. Every answer must be reachable and expressible exactly, by hand."
        : "The paper is not recorded, so assume NO calculator and keep every answer exact.";

  return [
    "The image is the source question. Write a different question that exercises the same mathematics.",
    "",
    `Sub-topic, which must not change: ${source.subtopics.join("; ")}`,
    `Mark tariff, which must be exactly matched: ${source.marks}`,
    calculator,
    "",
    "The source is used for assessment, so yours must not give a student who has worked it an advantage on the original. Change the mathematical substance, not just the numbers.",
    "",
    "Solve your own question completely before writing the mark scheme, and check the answer comes out cleanly for this paper. If it does not, write a different question rather than submitting one you have not closed.",
  ].join("\n");
}

export interface GenerationResult {
  question: GeneratedQuestion;
  model: string;
  usage: Anthropic.Messages.Usage | null;
}

/**
 * Write one question. Throws on an API error or an unparseable response; the
 * caller decides what to tell the teacher.
 *
 * Effort is `max` and thinking is adaptive because the expensive failure here
 * is a wrong answer, not a slow one -- this runs once per question, at a
 * teacher's desk, not in a loop.
 *
 * `messages.parse()` rather than `stream()`: only parse() populates
 * `parsed_output` from the Zod format. That caps max_tokens in practice --
 * the SDK refuses a non-streaming request whose max_tokens implies more than
 * ten minutes -- but a question and its mark scheme run to a few thousand
 * tokens, so 16000 is already generous and the ceiling never binds.
 */
export async function generatePracticeQuestion(
  source: GenerationSource
): Promise<GenerationResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.parse({
    model: PRACTICE_GENERATOR_MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "max",
      format: zodOutputFormat(GeneratedQuestionSchema),
    },
    system: buildAuthoringSystemPrompt(),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: source.imageMediaType,
              data: source.imageBase64,
            },
          },
          { type: "text", text: buildGenerationRequest(source) },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error(
      `The model declined to write this question (${response.stop_details?.category ?? "no category"}).`
    );
  }

  const parsed = parseGeneratedQuestion(response);
  return { question: parsed, model: response.model, usage: response.usage ?? null };
}

/**
 * Pull the structured result out of a response.
 *
 * `parsed_output` is the happy path. The text fallback exists because these
 * models return thinking blocks first, so `content[0]` is not the answer --
 * a mistake this codebase has made before (see docs/HANDOFF.md) -- and
 * because a parse failure leaves `parsed_output` null while the JSON is
 * sitting in the text block, which is recoverable.
 */
export function parseGeneratedQuestion(
  response: Anthropic.Messages.Message & { parsed_output?: unknown }
): GeneratedQuestion {
  if (response.parsed_output) {
    return withNormalisedTariffs(GeneratedQuestionSchema.parse(response.parsed_output));
  }

  const text = response.content.find(
    (block): block is Anthropic.Messages.TextBlock => block.type === "text"
  )?.text;
  if (!text) throw new Error("The model returned no question.");

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("The model's reply was not the expected JSON.");
  }
  return withNormalisedTariffs(GeneratedQuestionSchema.parse(raw));
}

/**
 * The authoring guide asks for `\hfill [n]` tariffs; this is what makes it so.
 *
 * Both parse paths go through here, because a question is stored straight from
 * whichever one produced it. The first thirteen generated questions came back
 * with four different tariff spellings between them, and only the canonical
 * one lays out correctly -- so normalising at the boundary is what keeps a set
 * looking like one document rather than thirteen.
 */
function withNormalisedTariffs(question: GeneratedQuestion): GeneratedQuestion {
  return {
    ...question,
    questionLatex: normaliseTariffs(question.questionLatex),
  };
}
