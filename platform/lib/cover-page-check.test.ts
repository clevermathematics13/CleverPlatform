import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { runCoverPageCheck, type CoverPageCheckClient, type CoverPageCheckStage } from "./cover-page-check";
import { COVER_PAGE_CHECK_MODEL, COVER_PAGE_NAME_ESCALATION_MODEL } from "./na-scanning";

const ROSTER = ["Vicente Alarcon", "Vania De Los Heros", "Emilia Duarte"];

/** A model answer as the API returns it: text content plus a usage meter. */
function reply(body: unknown, tokens = 10): Anthropic.Message {
  return {
    id: "msg",
    type: "message",
    role: "assistant",
    model: "fake",
    content: [{ type: "text", text: typeof body === "string" ? body : JSON.stringify(body), citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: tokens, output_tokens: tokens, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Anthropic.Message;
}

/**
 * A client that answers each call in turn and records what it was asked.
 * An answer given as an Error is thrown instead.
 */
function fakeClient(answers: (Anthropic.Message | Error)[]) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: CoverPageCheckClient = {
    messages: {
      create: async (params) => {
        calls.push(params);
        const next = answers.shift();
        if (!next) throw new Error("fake client ran out of answers");
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
  return { client, calls };
}

function userText(params: Anthropic.MessageCreateParamsNonStreaming): string {
  const content = params.messages[0].content;
  if (typeof content === "string") return content;
  return content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
}

const unmatchedCover = { isCoverPage: true, studentName: "Nicolite", rosterMatch: null, confidence: "low", note: "hard to read" };
const matchedCover = { isCoverPage: true, studentName: "Vania", rosterMatch: "Vania De Los Heros", confidence: "high", note: "" };
const notCover = { isCoverPage: false, studentName: null, rosterMatch: null, confidence: "high", note: "worked maths" };
const secondRead = { isCoverPage: true, studentName: "Vicente", rosterMatch: "Vicente Alarcon", confidence: "high", note: "looped V" };

describe("runCoverPageCheck", () => {
  it("makes one Haiku call and stops when the first read already matched", async () => {
    const { client, calls } = fakeClient([reply(matchedCover)]);
    const stages: CoverPageCheckStage[] = [];
    const outcome = await runCoverPageCheck({
      anthropic: client,
      pdfBase64: "AAAA",
      rosterNames: ROSTER,
      onUsage: async (s) => void stages.push(s),
    });
    expect(outcome).toEqual({ ok: true, result: matchedCover, escalated: false });
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe(COVER_PAGE_CHECK_MODEL);
    expect(stages.map((s) => s.stage)).toEqual(["first"]);
  });

  it("sends the same page to the stronger model when the first read found no roster match", async () => {
    const { client, calls } = fakeClient([reply(unmatchedCover), reply(secondRead)]);
    const stages: CoverPageCheckStage[] = [];
    const outcome = await runCoverPageCheck({
      anthropic: client,
      pdfBase64: "AAAA",
      rosterNames: ROSTER,
      onUsage: async (s) => void stages.push(s),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.escalated).toBe(true);
    expect(outcome.result.rosterMatch).toBe("Vicente Alarcon");
    expect(outcome.result.isCoverPage).toBe(true);
    expect(outcome.result.note).toContain("first read as 'Nicolite'");

    expect(calls).toHaveLength(2);
    expect(calls[1].model).toBe(COVER_PAGE_NAME_ESCALATION_MODEL);
    // The very same page bytes, and the first read's transcription in the ask.
    const content = calls[1].messages[0].content;
    expect(Array.isArray(content) && content[0].type === "document" && content[0].source.type === "base64" ? content[0].source.data : null).toBe("AAAA");
    expect(userText(calls[1])).toContain('"Nicolite"');
    expect(userText(calls[1])).toContain("- Vicente Alarcon");

    expect(stages.map((s) => [s.stage, s.model])).toEqual([
      ["first", COVER_PAGE_CHECK_MODEL],
      ["escalation", COVER_PAGE_NAME_ESCALATION_MODEL],
    ]);
  });

  it("does not escalate a page that is not a cover page", async () => {
    const { client, calls } = fakeClient([reply(notCover)]);
    const outcome = await runCoverPageCheck({ anthropic: client, pdfBase64: "AAAA", rosterNames: ROSTER });
    expect(outcome).toEqual({ ok: true, result: notCover, escalated: false });
    expect(calls).toHaveLength(1);
  });

  it("does not escalate when no roster was supplied", async () => {
    const { client, calls } = fakeClient([reply(unmatchedCover)]);
    const outcome = await runCoverPageCheck({ anthropic: client, pdfBase64: "AAAA", rosterNames: [] });
    expect(outcome).toEqual({ ok: true, result: unmatchedCover, escalated: false });
    expect(calls).toHaveLength(1);
  });

  it("does not escalate when the caller turned it off", async () => {
    const { client, calls } = fakeClient([reply(unmatchedCover)]);
    const outcome = await runCoverPageCheck({
      anthropic: client,
      pdfBase64: "AAAA",
      rosterNames: ROSTER,
      escalateUnmatched: false,
    });
    expect(outcome).toEqual({ ok: true, result: unmatchedCover, escalated: false });
    expect(calls).toHaveLength(1);
  });

  it("keeps the first verdict when the second read throws", async () => {
    const { client } = fakeClient([reply(unmatchedCover), new Error("overloaded")]);
    const outcome = await runCoverPageCheck({ anthropic: client, pdfBase64: "AAAA", rosterNames: ROSTER });
    expect(outcome).toEqual({ ok: true, result: unmatchedCover, escalated: false });
  });

  it("keeps the first verdict when the second read is unusable", async () => {
    const { client } = fakeClient([reply(unmatchedCover), reply("I cannot tell.")]);
    const outcome = await runCoverPageCheck({ anthropic: client, pdfBase64: "AAAA", rosterNames: ROSTER });
    expect(outcome).toEqual({ ok: true, result: unmatchedCover, escalated: false });
  });

  it("keeps the first verdict, with the attempt noted, when the second read matches nobody either", async () => {
    const { client } = fakeClient([
      reply(unmatchedCover),
      reply({ ...unmatchedCover, studentName: "Nicolete", note: "still unclear" }),
    ]);
    const outcome = await runCoverPageCheck({ anthropic: client, pdfBase64: "AAAA", rosterNames: ROSTER });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.escalated).toBe(true);
    expect(outcome.result.rosterMatch).toBeNull();
    expect(outcome.result.note).toContain("could not match it to the roster either");
  });

  it("reports an unusable first read as a failed check, without a second read", async () => {
    const { client, calls } = fakeClient([reply("not json at all")]);
    const outcome = await runCoverPageCheck({ anthropic: client, pdfBase64: "AAAA", rosterNames: ROSTER });
    expect(outcome.ok).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("lets a thrown first read propagate, as the callers expect", async () => {
    const { client } = fakeClient([new Error("rate limited")]);
    await expect(runCoverPageCheck({ anthropic: client, pdfBase64: "AAAA", rosterNames: ROSTER })).rejects.toThrow(
      "rate limited"
    );
  });
});
