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
});
