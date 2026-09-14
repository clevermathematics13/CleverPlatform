import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  AiGradeResponseSchema,
  GRADING_MODEL,
  buildGradingStudentPrompt,
  buildGradingSystemPrompt,
  buildGradingUserPrompt,
  type GradingUnit,
} from "./ai-grading";
import { buildCachePrimerRequest, buildGradingRequest } from "./ai-grading-run";

/**
 * These are the pin on the extraction: the synchronous route used to build
 * this object inline, and the batch path now shares it. What the model
 * receives -- block order, both cache breakpoints, temperature, structured
 * output -- must not have moved in the process, because nothing downstream
 * would notice if it had. A silently dropped cache_control costs ~14K tokens
 * of prefix per student at full price; a reordered content array puts the
 * per-student text before the scan it refers to.
 */

const GRADEABLE: GradingUnit[] = [
  {
    testItemId: "item-1",
    questionNumber: 1,
    partLabel: "a",
    maxMarks: 5,
    questionCode: "Q1",
    questionLatex: "Solve $x^2 = 4$.",
    markscheme: "M1 A1 A1 R1 A1",
    markschemeSource: "part_latex",
    commandTerms: ["Solve"],
    subtopicCodes: ["AA-SL-2.5"],
    curriculum: ["AA"],
    level: "AHL",
    paper: 2,
  },
];

const TEST_NAME = "BiStats Paper 2";
const STUDENT = "Luciana Rojas";
const SCAN_BASE64 = "JVBERi0xLjQK";

const args = (overrides: Partial<Parameters<typeof buildGradingRequest>[0]> = {}) => ({
  gradeable: GRADEABLE,
  testName: TEST_NAME,
  studentDisplayName: STUDENT,
  scanBase64: SCAN_BASE64,
  cacheTtl: "1h" as const,
  ...overrides,
});

/**
 * The request with both cache breakpoints removed, so two TTLs can be
 * compared on everything except the breakpoints themselves. output_config
 * collapses to its schema: the format also carries a parse callback, which is
 * a fresh closure on every build and so never compares equal.
 */
function comparable(request: Anthropic.MessageCreateParamsNonStreaming) {
  const stripBlock = <T extends { cache_control?: unknown }>(block: T): T => {
    const copy = { ...block };
    delete copy.cache_control;
    return copy;
  };
  return {
    ...request,
    output_config: request.output_config?.format?.schema,
    system: (request.system as Anthropic.TextBlockParam[]).map(stripBlock),
    messages: request.messages.map((m) => ({
      ...m,
      content: (m.content as Anthropic.ContentBlockParam[]).map((b) =>
        b.type === "text" ? stripBlock(b) : b
      ),
    })),
  };
}

describe("buildGradingRequest", () => {
  it("matches the request the synchronous route sent inline, at a 1h TTL", () => {
    const { output_config, ...request } = buildGradingRequest(args());

    expect(request).toEqual({
      model: GRADING_MODEL,
      max_tokens: 16384,
      temperature: 0,
      system: [
        {
          type: "text",
          text: buildGradingSystemPrompt(GRADEABLE),
          cache_control: { type: "ephemeral", ttl: "1h" },
        },
      ],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: buildGradingUserPrompt(GRADEABLE, { testName: TEST_NAME }),
              cache_control: { type: "ephemeral", ttl: "1h" },
            },
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: SCAN_BASE64 },
            },
            {
              type: "text",
              text: buildGradingStudentPrompt(STUDENT),
            },
          ],
        },
      ],
    });

    // Structured output comes from the same zod schema validateGradeResponse
    // checks against. Compared by schema rather than by object: the format
    // also carries a parse callback, which is a fresh closure every call.
    expect(output_config?.format?.type).toBe("json_schema");
    expect(output_config?.format?.schema).toEqual(zodOutputFormat(AiGradeResponseSchema).schema);
  });

  it("emits a bare ephemeral breakpoint at a 5m TTL, changing nothing else", () => {
    const fiveMinute = buildGradingRequest(args({ cacheTtl: "5m" }));

    const system = fiveMinute.system as Anthropic.TextBlockParam[];
    const content = fiveMinute.messages[0].content as Anthropic.ContentBlockParam[];
    const markSchemeBlock = content[0] as Anthropic.TextBlockParam;

    // Object.keys, not toEqual: `{ type: "ephemeral", ttl: undefined }` would
    // pass an equality check and still serialise as a 5m breakpoint by
    // accident rather than by decision.
    expect(system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(Object.keys(system[0].cache_control ?? {})).toEqual(["type"]);
    expect(markSchemeBlock.cache_control).toEqual({ type: "ephemeral" });
    expect(Object.keys(markSchemeBlock.cache_control ?? {})).toEqual(["type"]);

    expect(comparable(fiveMinute)).toEqual(
      comparable(buildGradingRequest(args({ cacheTtl: "1h" })))
    );
  });

  it("still asks for the JSON object when there is no student name", () => {
    const request = buildGradingRequest(args({ studentDisplayName: undefined }));
    const content = request.messages[0].content as Anthropic.ContentBlockParam[];
    const perStudent = content[2] as Anthropic.TextBlockParam;

    expect(perStudent.type).toBe("text");
    expect(perStudent.text.endsWith("Return the JSON object now.")).toBe(true);
    expect(perStudent.text).not.toContain("Student:");
  });
});

/**
 * The primer's whole job is to write the prefix the batch then reads, and
 * caching is a prefix match -- so the only property that matters is that its
 * cached blocks are byte-identical to the ones the batch sends. Drift here
 * does not fail, it silently pays for a write nobody reads, which is exactly
 * the bill this was added to cut. Hence identity assertions rather than
 * shape ones.
 */
describe("buildCachePrimerRequest", () => {
  const primerArgs = (ttl: "5m" | "1h" = "5m") => ({
    gradeable: GRADEABLE,
    testName: TEST_NAME,
    cacheTtl: ttl,
  });

  it.each(["5m", "1h"] as const)(
    "sends cached blocks byte-identical to the real request at %s",
    (ttl) => {
      const primer = buildCachePrimerRequest(primerArgs(ttl));
      const real = buildGradingRequest(args({ cacheTtl: ttl }));

      expect(primer.system).toEqual(real.system);

      const primerContent = primer.messages[0].content as Anthropic.ContentBlockParam[];
      const realContent = real.messages[0].content as Anthropic.ContentBlockParam[];
      expect(primerContent[0]).toEqual(realContent[0]);

      // Same model, or the entry is written into a different cache namespace.
      expect(primer.model).toBe(real.model);
      expect(primer.model).toBe(GRADING_MODEL);
    }
  );

  it("carries max_tokens 0 and no output_config, which together are a 400", () => {
    const primer = buildCachePrimerRequest(primerArgs());

    expect(primer.max_tokens).toBe(0);
    // max_tokens 0 is an invalid_request_error when output_config.format is
    // present. The real request always carries it; the primer must not.
    expect(primer.output_config).toBeUndefined();
  });

  it("sends the prefix only -- no scan and no per-student tail", () => {
    const primer = buildCachePrimerRequest(primerArgs());
    const content = primer.messages[0].content as Anthropic.ContentBlockParam[];

    expect(content).toHaveLength(1);
    expect(content[0].type).toBe("text");
    expect(content.some((b) => b.type === "document")).toBe(false);
    expect(JSON.stringify(primer)).not.toContain(SCAN_BASE64);
    expect(JSON.stringify(primer)).not.toContain(STUDENT);
  });

  it("keeps both breakpoints cached, not just the system one", () => {
    const primer = buildCachePrimerRequest(primerArgs());
    const system = primer.system as Anthropic.TextBlockParam[];
    const markScheme = (primer.messages[0].content as Anthropic.TextBlockParam[])[0];

    expect(system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(markScheme.cache_control).toEqual({ type: "ephemeral" });
  });

  it("propagates the 1h TTL to both breakpoints", () => {
    const primer = buildCachePrimerRequest(primerArgs("1h"));
    const system = primer.system as Anthropic.TextBlockParam[];
    const markScheme = (primer.messages[0].content as Anthropic.TextBlockParam[])[0];

    expect(system[0].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(markScheme.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });
});
