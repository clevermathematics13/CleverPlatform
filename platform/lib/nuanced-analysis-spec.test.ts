/**
 * nuanced-analysis-spec.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests for the NuancedAnalysisSpec validation + compilation layer.
 *
 * Run with:  cd platform && npx vitest run lib/nuanced-analysis-spec.test.ts
 *
 * What these prove:
 *   1. The canonical AA HL spec passes Zod validation.
 *   2. Strict mode rejects unknown/extra fields.
 *   3. Cross-field invariants (superRefine) are enforced.
 *   4. The compiler is deterministic and emits every required contract anchor.
 *   5. The checklist summarises the spec.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import {
  validateNuancedAnalysisSpec,
  NuancedAnalysisSpecSchema,
} from "./nuanced-analysis-spec.schema";
import { CANONICAL_AAHL_SPEC } from "./nuanced-analysis-spec.defaults";
import {
  compileSpecToSystemPrompt,
  compileSpecToChecklist,
} from "./nuanced-analysis-spec.compile";

describe("NuancedAnalysisSpec validation", () => {
  it("accepts the canonical AA HL default spec", () => {
    const result = validateNuancedAnalysisSpec(CANONICAL_AAHL_SPEC);
    if (!result.success) {
      // Surface the exact failure to make debugging trivial.
      throw new Error(result.error);
    }
    expect(result.success).toBe(true);
  });

  it("rejects unknown extra fields (strict mode)", () => {
    const bad = { ...CANONICAL_AAHL_SPEC, somethingExtra: true } as unknown;
    const result = validateNuancedAnalysisSpec(bad);
    expect(result.success).toBe(false);
  });

  it("rejects a spec whose pageTargetMax < pageTargetMin (cross-field)", () => {
    const bad = {
      ...CANONICAL_AAHL_SPEC,
      identity: { ...CANONICAL_AAHL_SPEC.identity, pageTargetMin: 30, pageTargetMax: 10 },
    };
    const result = validateNuancedAnalysisSpec(bad);
    expect(result.success).toBe(false);
  });

  it("rejects a spec with the wrong TOK count", () => {
    const bad = {
      ...CANONICAL_AAHL_SPEC,
      tok: { ...CANONICAL_AAHL_SPEC.tok, countExactly: 3 },
    };
    const result = NuancedAnalysisSpecSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("requires exactly 8 design layers", () => {
    const bad = {
      ...CANONICAL_AAHL_SPEC,
      designLayers: {
        ...CANONICAL_AAHL_SPEC.designLayers,
        layers: CANONICAL_AAHL_SPEC.designLayers.layers.slice(0, 7),
      },
    };
    const result = NuancedAnalysisSpecSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

describe("NuancedAnalysisSpec compilation", () => {
  const prompt = compileSpecToSystemPrompt(CANONICAL_AAHL_SPEC);

  it("is deterministic (same spec → identical prompt)", () => {
    const again = compileSpecToSystemPrompt(CANONICAL_AAHL_SPEC);
    expect(prompt).toBe(again);
  });

  it("emits the three-phase model anchors", () => {
    expect(prompt).toContain("FLIPPED CLASSROOM");
    expect(prompt).toContain("IN-CLASS");
    expect(prompt).toContain("TAKE-HOME");
  });

  it("emits the core contract anchors", () => {
    expect(prompt).toContain("REQUIRED PACKET ORDER");
    expect(prompt).toContain("EIGHT UNIVERSAL DESIGN LAYERS");
    expect(prompt).toContain("PLANTED ERRORS");
    expect(prompt).toContain("EXACTLY 2 TOK");
    expect(prompt).toContain("TEACHER'S COMPANION");
    expect(prompt).toContain("OUTPUT CONTRACT");
  });

  it("enforces the platform copy rules verbatim", () => {
    expect(prompt).toContain("Clev's Marks");
    expect(prompt).toContain("intersects");
  });

  it("names the phase tag field and its three values", () => {
    expect(prompt).toContain("phase");
    expect(prompt).toContain("flipped");
    expect(prompt).toContain("inClass");
    expect(prompt).toContain("takeHome");
  });

  it("produces a non-trivial prompt", () => {
    expect(prompt.length).toBeGreaterThan(3000);
  });

  it("checklist summarises key requirements", () => {
    const checklist = compileSpecToChecklist(CANONICAL_AAHL_SPEC);
    expect(checklist.length).toBeGreaterThan(8);
    expect(checklist.join(" ")).toContain("flipped + in-class + take-home");
  });
});
