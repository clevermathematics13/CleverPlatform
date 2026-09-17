import type Anthropic from "@anthropic-ai/sdk";
import {
  COVER_PAGE_CHECK_MODEL,
  COVER_PAGE_CHECK_SYSTEM_PROMPT,
  COVER_PAGE_NAME_ESCALATION_MODEL,
  buildCoverPageCheckUserPrompt,
  buildCoverPageEscalationUserPrompt,
  mergeEscalatedCoverPageCheck,
  needsNameEscalation,
  validateCoverPageCheck,
  type CoverPageCheck,
} from "./na-scanning";

/**
 * One cover-page check, as both batch pipelines make it: a single page as
 * its own PDF, the roster in the prompt, Haiku answering -- and, when Haiku
 * finds a cover page whose name it cannot place on the roster, a second
 * read of the same page by a stronger model (see the escalation section of
 * lib/na-scanning.ts for why). The Tests batch route and the NA batch
 * route used to carry a copy of this call each; the second read made a
 * third copy one too many.
 *
 * The client is typed by the one method used so a test can hand in a fake.
 */
export interface CoverPageCheckClient {
  messages: {
    create: (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;
  };
}

export interface CoverPageCheckStage {
  stage: "first" | "escalation";
  model: string;
  usage: Anthropic.Message["usage"];
}

export interface RunCoverPageCheckOptions {
  anthropic: CoverPageCheckClient;
  /** The page on its own, as base64 PDF bytes. */
  pdfBase64: string;
  rosterNames: string[];
  /**
   * Called once per model call made, in order, so the caller can record
   * the spend under its own pipeline. Awaited, so a throw here fails the
   * check like any other error; recordUsage never throws.
   */
  onUsage?: (stage: CoverPageCheckStage) => Promise<void>;
  /**
   * Whether an unmatched cover page gets its second read. On by default;
   * the oversized-upload chunker turns it off because it only needs to
   * know WHETHER a page is a cover, never whose.
   */
  escalateUnmatched?: boolean;
}

export type CoverPageCheckOutcome =
  | { ok: true; result: CoverPageCheck; escalated: boolean }
  | { ok: false; error: string };

function textOf(message: Anthropic.Message): string {
  return message.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
}

/**
 * Check one page. A first read that fails to parse is reported as such
 * (the callers decide whether that is a thrown page or "not a cover"). A
 * second read that throws or fails to parse never loses the first: the
 * first read's verdict is returned as it was, since a page Haiku has
 * already called a cover page must not turn into a failed check because
 * the optional improvement on its name did not arrive.
 */
export async function runCoverPageCheck(opts: RunCoverPageCheckOptions): Promise<CoverPageCheckOutcome> {
  const { anthropic, pdfBase64, rosterNames } = opts;
  const document: Anthropic.DocumentBlockParam = {
    type: "document",
    source: { type: "base64", media_type: "application/pdf", data: pdfBase64 },
  };

  const first = await anthropic.messages.create({
    model: COVER_PAGE_CHECK_MODEL,
    max_tokens: 512,
    system: COVER_PAGE_CHECK_SYSTEM_PROMPT,
    messages: [{ role: "user", content: [document, { type: "text", text: buildCoverPageCheckUserPrompt(rosterNames) }] }],
  });
  await opts.onUsage?.({ stage: "first", model: COVER_PAGE_CHECK_MODEL, usage: first.usage });
  const validated = validateCoverPageCheck(textOf(first));
  if (!validated.ok) return validated;

  const escalate = opts.escalateUnmatched ?? true;
  if (!escalate || !needsNameEscalation(validated.result, rosterNames.length)) {
    return { ok: true, result: validated.result, escalated: false };
  }

  try {
    const second = await anthropic.messages.create({
      model: COVER_PAGE_NAME_ESCALATION_MODEL,
      max_tokens: 1024,
      system: COVER_PAGE_CHECK_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [document, { type: "text", text: buildCoverPageEscalationUserPrompt(rosterNames, validated.result) }],
        },
      ],
    });
    await opts.onUsage?.({ stage: "escalation", model: COVER_PAGE_NAME_ESCALATION_MODEL, usage: second.usage });
    const secondValidated = validateCoverPageCheck(textOf(second));
    if (!secondValidated.ok) return { ok: true, result: validated.result, escalated: false };
    return { ok: true, result: mergeEscalatedCoverPageCheck(validated.result, secondValidated.result), escalated: true };
  } catch {
    return { ok: true, result: validated.result, escalated: false };
  }
}
