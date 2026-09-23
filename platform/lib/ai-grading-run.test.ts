import { afterEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument } from "pdf-lib";
import {
  AiGradeResponseSchema,
  GRADING_MODEL,
  buildGradingStudentPrompt,
  buildGradingSystemPrompt,
  buildGradingUserPrompt,
  type GradingUnit,
  type ValidatedGrade,
} from "./ai-grading";
import { warningsForPart } from "./ai-grade-review";
import { buildGradingRequest, evidenceCropWarnings, fetchEvidenceCrops } from "./ai-grading-run";

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

describe("evidenceCropWarnings", () => {
  it("says nothing when every crop was cut and saved", () => {
    expect(evidenceCropWarnings({ cutFailure: null, unsaved: 0, saveError: null })).toEqual([]);
  });

  it("says why no crop was cut, and how to get them back", () => {
    expect(
      evidenceCropWarnings({
        cutFailure: "Crop service offline (Railway: Application not found)",
        unsaved: 0,
        saveError: null,
      })
    ).toEqual([
      "Evidence crops unavailable: Crop service offline (Railway: Application not found). Once that is fixed, re-mark this student or use Locate on page on each part to get them back.",
    ]);
  });

  it("does not double the full stop on a reason that already ends in one", () => {
    const [warning] = evidenceCropWarnings({ cutFailure: "Could not read student PDF.", unsaved: 0, saveError: null });
    expect(warning).toContain("Evidence crops unavailable: Could not read student PDF. Once that is fixed");
  });

  it("counts crops that were cut but could not be saved", () => {
    expect(evidenceCropWarnings({ cutFailure: null, unsaved: 3, saveError: "Bucket not found" })).toEqual([
      "Evidence crops unavailable for 3 part(s): they were cut but could not be saved (Bucket not found).",
    ]);
  });

  it("is never filed under one part by the review panel", () => {
    // The panel reads a part's warnings by its "3(b): " prefix, and these are
    // about the whole run.
    const warnings = evidenceCropWarnings({ cutFailure: "Cropping timed out", unsaved: 2, saveError: null });
    expect(warnings).toHaveLength(2);
    for (const label of ["1", "3(b)", "12(a)(ii)"]) expect(warningsForPart(label, warnings)).toEqual([]);
  });
});

describe("fetchEvidenceCrops reports a run that got no crops", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  // A paper with no locked layout, so every region comes from the model's box.
  const noLockedLayout = {
    from: () => {
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: null, error: null }) };
      return query;
    },
  } as unknown as SupabaseClient;

  const LOCATED: ValidatedGrade[] = [
    {
      unit: GRADEABLE[0],
      item: { workFound: true, evidenceBox: { page: 1, x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.4 } },
      clampedMarks: 3,
      confidence: "high",
    } as unknown as ValidatedGrade,
  ];

  async function onePageScan(): Promise<string> {
    const pdf = await PDFDocument.create();
    pdf.addPage([595, 842]);
    return Buffer.from(await pdf.save()).toString("base64");
  }

  it("with the crop service's reason when the service is down", async () => {
    vi.stubEnv("GRAPH_LAB_CV_SERVICE_URL", "https://cv.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ status: "error", code: 404, message: "Application not found" }), {
            status: 404,
            headers: { "content-type": "application/json", "x-railway-fallback": "true" },
          })
      )
    );
    const { crops, failure } = await fetchEvidenceCrops(noLockedLayout, "test-1", await onePageScan(), LOCATED);
    expect(crops.size).toBe(0);
    expect(failure).toBe("Crop service offline (Railway: Application not found)");
  });

  it("when the scan cannot be opened", async () => {
    vi.stubEnv("GRAPH_LAB_CV_SERVICE_URL", "https://cv.example.test");
    const { failure } = await fetchEvidenceCrops(
      noLockedLayout,
      "test-1",
      Buffer.from("not a pdf").toString("base64"),
      LOCATED
    );
    expect(failure).toMatch(/^the scan could not be read \(/);
  });

  it("but not when cropping is simply not configured, which is most local environments", async () => {
    vi.stubEnv("GRAPH_LAB_CV_SERVICE_URL", "");
    const { crops, failure } = await fetchEvidenceCrops(noLockedLayout, "test-1", await onePageScan(), LOCATED);
    expect(crops.size).toBe(0);
    expect(failure).toBeNull();
  });

  it("and not a second time for a missing scan, which the collect route already reports", async () => {
    vi.stubEnv("GRAPH_LAB_CV_SERVICE_URL", "https://cv.example.test");
    const { failure } = await fetchEvidenceCrops(noLockedLayout, "test-1", "", LOCATED);
    expect(failure).toBeNull();
  });
});
