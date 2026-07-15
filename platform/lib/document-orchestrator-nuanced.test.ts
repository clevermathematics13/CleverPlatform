/**
 * document-orchestrator-nuanced.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Smoke tests for DocumentOrchestratorService.
 *
 * Run: cd platform && npx vitest run lib/document-orchestrator-nuanced.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { DocumentOrchestratorService } from "./document-orchestrator-nuanced";
import type { AssignmentDraft } from "./assignments";

const MINIMAL_DRAFT: AssignmentDraft = {
  title: "Test Nuanced Analysis",
  subtitle: "IBDP Mathematics AA HL",
  instructions: ["Show all working."],
  sections: [
    {
      heading: "Part 0 — Prior Knowledge",
      questions: [
        { prompt: "Write down the polar form of z = 1 + i.", marks: 2, tier: 1 },
        { prompt: "Show that |z1 z2| = |z1| |z2|.", marks: 4, tier: 2 },
      ],
    },
    {
      heading: "Part 1 — Multiplication",
      prerequisiteBox: { items: ["Polar form", "Compound-angle formulae"] },
      questions: [
        {
          prompt: "Prove De Moivre's Theorem by induction.",
          marks: 6,
          tier: 2,
          hint: "Base case: verify for n = 1.",
        },
      ],
    },
  ],
  commandTerms: [
    { term: "Write down", definition: "No working required." },
    { term: "Prove", definition: "Rigorous complete reasoning." },
  ],
  tokProvocations: [
    { id: "tok1", body: "Is mathematical beauty evidence of truth?" },
    { id: "tok2", body: "Was i discovered or invented?" },
  ],
  internationalMindedness: {
    body: "Contributions from Argand, Wessel, and Madhava.",
  },
};

describe("DocumentOrchestratorService", () => {
  it("builds a valid ActivityPayload from a minimal NuancedDraft", () => {
    const result = DocumentOrchestratorService.build(MINIMAL_DRAFT);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const { payload } = result;

    expect(payload.template).toBeDefined();
    expect(payload.content.title).toBe("Test Nuanced Analysis");
    expect(payload.content.sections).toHaveLength(2);
  });

  it("assigns sequential global question numbers", () => {
    const result = DocumentOrchestratorService.build(MINIMAL_DRAFT);
    if (!result.success) throw new Error(result.error);
    const { sections } = result.payload.content;
    expect(sections[0].questions[0].globalNumber).toBe(1);
    expect(sections[0].questions[1].globalNumber).toBe(2);
    expect(sections[1].questions[0].globalNumber).toBe(3);
  });

  it("computes pacing correctly (12/11 rule)", () => {
    const result = DocumentOrchestratorService.build(MINIMAL_DRAFT);
    if (!result.success) throw new Error(result.error);
    const { sections } = result.payload.content;
    // round(2 * 12 / 11) = round(2.18) = 2
    expect(sections[0].questions[0].estimatedMinutes).toBe(2);
    // round(6 * 12 / 11) = round(6.54) = 7
    expect(sections[1].questions[0].estimatedMinutes).toBe(7);
  });

  it("passes tokProvocations and internationalMindedness through", () => {
    const result = DocumentOrchestratorService.build(MINIMAL_DRAFT);
    if (!result.success) throw new Error(result.error);
    const { content } = result.payload;
    expect(content.tokProvocations).toHaveLength(2);
    expect(content.internationalMindedness?.body).toContain("Argand");
  });

  it("passes prerequisiteBox and hint through", () => {
    const result = DocumentOrchestratorService.build(MINIMAL_DRAFT);
    if (!result.success) throw new Error(result.error);
    const part1 = result.payload.content.sections[1];
    expect(part1.prerequisiteBox?.items).toContain("Polar form");
    expect(part1.questions[0].hint).toBe("Base case: verify for n = 1.");
  });

  it("returns failure gracefully on empty sections", () => {
    const bad: AssignmentDraft = {
      title: "Bad",
      subtitle: "",
      instructions: [],
      sections: [],
    };
    const result = DocumentOrchestratorService.build(bad);
    // Empty sections should still succeed at the orchestrator level;
    // the TypstRenderService will produce an empty-sections PDF.
    expect(result.success).toBe(true);
  });

  // ── Malformed AI output — regression tests ────────────────────────────────
  // The Typst template accesses these enrichment fields via direct dictionary
  // access (not `.at(key, default:)`), and a missing key is a HARD COMPILE
  // FAILURE for the entire document (confirmed empirically against the real
  // compiler: "dictionary does not contain key ..."). The AI's JSON output is
  // not guaranteed to include every nested sub-field even when the parent
  // object is present, so the orchestrator must strip or omit anything
  // incomplete rather than passing it through.

  it("omits a spotlight box missing its title instead of passing a partial object", () => {
    const draft: AssignmentDraft = {
      title: "T",
      subtitle: "",
      instructions: [],
      sections: [
        {
          heading: "Part 1",
          spotlight: { title: "", body: "Body with no title." } as unknown as { title: string; body: string },
          questions: [{ prompt: "Q", marks: 1, tier: 1 }],
        },
      ],
    };
    const result = DocumentOrchestratorService.build(draft);
    if (!result.success) throw new Error(result.error);
    expect(result.payload.content.sections[0].spotlight).toBeUndefined();
  });

  it("drops individual commandTerms/tokProvocations entries missing a required field", () => {
    const draft: AssignmentDraft = {
      title: "T",
      subtitle: "",
      instructions: [],
      sections: [{ heading: "Part 1", questions: [{ prompt: "Q", marks: 1, tier: 1 }] }],
      commandTerms: [
        { term: "Prove" } as unknown as { term: string; definition: string },
        { term: "Show that", definition: "Every step must appear." },
      ],
      tokProvocations: [
        { id: "tok1" } as unknown as { id: string; body: string },
        { id: "tok2", body: "Was it discovered or invented?" },
      ],
    };
    const result = DocumentOrchestratorService.build(draft);
    if (!result.success) throw new Error(result.error);
    const { content } = result.payload;
    expect(content.commandTerms).toHaveLength(1);
    expect(content.commandTerms?.[0].term).toBe("Show that");
    expect(content.tokProvocations).toHaveLength(1);
    expect(content.tokProvocations?.[0].id).toBe("tok2");
  });

  it("omits prerequisiteBox, geometricReading, and internationalMindedness when empty/incomplete", () => {
    const draft: AssignmentDraft = {
      title: "T",
      subtitle: "",
      instructions: [],
      sections: [
        {
          heading: "Part 1",
          prerequisiteBox: { items: [] },
          geometricReading: {} as unknown as { body: string },
          questions: [{ prompt: "Q", marks: 1, tier: 1 }],
        },
      ],
      internationalMindedness: {} as unknown as { body: string },
    };
    const result = DocumentOrchestratorService.build(draft);
    if (!result.success) throw new Error(result.error);
    const { content } = result.payload;
    expect(content.sections[0].prerequisiteBox).toBeUndefined();
    expect(content.sections[0].geometricReading).toBeUndefined();
    expect(content.internationalMindedness).toBeUndefined();
  });

  it("auto-captions a translation table missing its caption, keeping only complete rows", () => {
    const draft: AssignmentDraft = {
      title: "T",
      subtitle: "",
      instructions: [],
      sections: [
        {
          heading: "Part 1",
          translationTable: {
            rows: [
              { informal: "looks right", formal: "is unbiased" },
              { informal: "no formal side" } as unknown as { informal: string; formal: string },
            ],
          } as unknown as { caption: string; rows: Array<{ informal: string; formal: string }> },
          questions: [{ prompt: "Q", marks: 1, tier: 1 }],
        },
      ],
    };
    const result = DocumentOrchestratorService.build(draft);
    if (!result.success) throw new Error(result.error);
    const table = result.payload.content.sections[0].translationTable;
    expect(table?.caption).toBeTruthy();
    expect(table?.rows).toHaveLength(1);
    expect(table?.rows[0].informal).toBe("looks right");
  });
});
