import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import {
  buildTranscriptionRequest,
  buildTranscriptionSystemPrompt,
  mediaTypeForBytes,
  mediaTypeForPath,
  parseTranscription,
} from "./markscheme-transcribe";

const valid = {
  questionNumber: 3,
  totalMarks: 2,
  parts: [{ label: "", marks: 2, latex: "$x = 1$ \\hfill M1A1\n\\hfill [2 marks]" }],
  unreadable: [],
  sourceProblems: [],
};

function message(overrides: Partial<Anthropic.Message> & { parsed_output?: unknown } = {}): Anthropic.Message & {
  parsed_output?: unknown;
} {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content: [
      { type: "thinking", thinking: "", signature: "sig" } as Anthropic.ThinkingBlock,
      { type: "text", text: JSON.stringify(valid), citations: null } as Anthropic.TextBlock,
    ],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: {} as Anthropic.Usage,
    ...overrides,
  } as Anthropic.Message & { parsed_output?: unknown };
}

describe("buildTranscriptionRequest", () => {
  it("caches one system prompt and sends every image before the instruction", () => {
    const req = buildTranscriptionRequest({
      code: "19M.1.AHL.TZ2.H_3",
      questionNumber: 3,
      images: [
        { mediaType: "image/png", base64: "AAA" },
        { mediaType: "image/png", base64: "BBB" },
      ],
      effort: "high",
      maxTokens: 16000,
    });
    expect(req.model).toBe("claude-opus-5");
    expect(req.thinking).toEqual({ type: "adaptive" });
    expect(req.output_config?.effort).toBe("high");
    expect(req.output_config?.format?.type).toBe("json_schema");
    const system = req.system as Anthropic.TextBlockParam[];
    expect(system[0].cache_control).toEqual({ type: "ephemeral" });
    const content = req.messages[0].content as Anthropic.ContentBlockParam[];
    expect(content.map((b) => b.type)).toEqual(["image", "image", "text"]);
    expect((content[2] as Anthropic.TextBlockParam).text).toMatch(/question 3 \(question bank code 19M\.1\.AHL\.TZ2\.H_3\)/);
  });

  it("keeps the style guide and the scheme rules in the system prompt", () => {
    const prompt = buildTranscriptionSystemPrompt();
    expect(prompt).toMatch(/IB Mathematics past-paper LaTeX conventions/);
    expect(prompt).toMatch(/A2 stays A2/);
    expect(prompt).toMatch(/Never \\\[/);
  });

  it("picks the media type from the stored path", () => {
    expect(mediaTypeForPath("x/markscheme/01.png")).toBe("image/png");
    expect(mediaTypeForPath("x/markscheme/02.JPG")).toBe("image/jpeg");
  });

  it("trusts the bytes over the extension", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect(mediaTypeForBytes(jpeg, "x/markscheme/01.png")).toBe("image/jpeg");
    expect(mediaTypeForBytes(png, "x/markscheme/01.jpg")).toBe("image/png");
    expect(mediaTypeForBytes(webp, "x/markscheme/01.png")).toBe("image/webp");
    expect(mediaTypeForBytes(new Uint8Array([1, 2, 3]), "x/markscheme/01.gif")).toBe("image/gif");
  });
});

describe("parseTranscription", () => {
  it("reads the JSON after a thinking block", () => {
    expect(parseTranscription(message())).toEqual({ ok: true, scheme: valid });
  });

  it("prefers parsed_output when parse() provided it", () => {
    const result = parseTranscription(message({ parsed_output: { ...valid, totalMarks: 9 } }));
    expect(result.ok && result.scheme.totalMarks).toBe(9);
  });

  it("fails a refusal, a cut-off response, bad JSON and the wrong shape", () => {
    expect(parseTranscription(message({ stop_reason: "refusal" })).ok).toBe(false);
    expect(parseTranscription(message({ stop_reason: "max_tokens" })).ok).toBe(false);
    expect(
      parseTranscription(message({ content: [{ type: "text", text: "not json", citations: null } as Anthropic.TextBlock] })).ok
    ).toBe(false);
    expect(
      parseTranscription(message({ content: [{ type: "text", text: '{"parts": 3}', citations: null } as Anthropic.TextBlock] })).ok
    ).toBe(false);
  });
});
