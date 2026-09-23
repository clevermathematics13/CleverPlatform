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
import {
  MAX_QUESTION_IMAGES_PER_QUESTION,
  SEND_QUESTION_IMAGES_FOR_TEXTLESS_PARTS,
  buildGradingRequest,
  questionImagesForUnits,
  type QuestionImage,
} from "./ai-grading-run";

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

describe("questionImagesForUnits", () => {
  const textless = (questionNumber: number, over: Partial<GradingUnit> = {}): GradingUnit => ({
    ...GRADEABLE[0],
    testItemId: `q${questionNumber}`,
    questionNumber,
    questionLatex: "",
    ...over,
  });
  const img = (questionNumber: number): QuestionImage => ({
    questionNumber,
    storagePath: `q${questionNumber}.png`,
    mediaType: "image/png",
    data: "",
  });

  it("keeps only the images of questions with a textless gradeable bank part", () => {
    const units = [
      GRADEABLE[0], // question 1, has text
      textless(2),
      textless(3, { markschemeSource: "none" }),
      textless(4, { questionCode: "", markschemeSource: "custom" }),
    ];
    expect(questionImagesForUnits([img(1), img(2), img(3), img(4), img(5)], units)).toEqual([img(2)]);
  });
});

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

  // A bank part with no question text: the marker sees only its mark scheme
  // unless the question's picture travels with the request.
  const TEXTLESS: GradingUnit = { ...GRADEABLE[0], testItemId: "item-2", questionNumber: 2, questionLatex: "" };
  const image = (questionNumber: number, n = 1): QuestionImage => ({
    questionNumber,
    storagePath: `q${questionNumber}/${n}.png`,
    mediaType: "image/jpeg",
    data: `img-${questionNumber}-${n}`,
  });

  it("is byte-identical to today's request when there are no question images", () => {
    const today = comparable(buildGradingRequest(args()));
    expect(comparable(buildGradingRequest(args({ questionImages: [] })))).toEqual(today);
    // Question 1 has text, so an image offered for it changes nothing either.
    expect(comparable(buildGradingRequest(args({ questionImages: [image(1)] })))).toEqual(today);
  });

  it("puts a textless question's images ahead of the cached mark-scheme block, and the scan after it", () => {
    const request = buildGradingRequest(
      args({ gradeable: [...GRADEABLE, TEXTLESS], questionImages: [image(1), image(2, 1), image(2, 2)] })
    );
    const content = request.messages[0].content as Anthropic.ContentBlockParam[];

    expect(content.map((b) => b.type)).toEqual(["text", "image", "text", "image", "text", "document", "text"]);
    expect((content[0] as Anthropic.TextBlockParam).text).toBe("Question image for question 2 (no question text on file):");
    expect((content[1] as Anthropic.ImageBlockParam).source).toEqual({
      type: "base64",
      media_type: "image/jpeg",
      data: "img-2-1",
    });
    expect((content[3] as Anthropic.ImageBlockParam).source).toMatchObject({ data: "img-2-2" });
    // Question 1 has text, so its image is not sent even though it was offered.
    expect(JSON.stringify(content)).not.toContain("img-1-1");

    const markSchemeBlock = content[4] as Anthropic.TextBlockParam;
    expect(markSchemeBlock.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(markSchemeBlock.text).toBe(
      buildGradingUserPrompt([...GRADEABLE, TEXTLESS], { testName: TEST_NAME, questionImagesFor: new Set([2]) })
    );
    expect(markSchemeBlock.text).toContain('"Question image for question 2"');
    expect(markSchemeBlock.text).not.toContain('"Question image for question 1"');
    for (const block of content.slice(0, 4)) expect("cache_control" in block).toBe(false);
  });

  it("ships with the images switched off", () => {
    expect(SEND_QUESTION_IMAGES_FOR_TEXTLESS_PARTS).toBe(false);
    expect(MAX_QUESTION_IMAGES_PER_QUESTION).toBe(2);
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
