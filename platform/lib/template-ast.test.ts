/**
 * template-ast.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Smoke tests for the TemplateAst Zod validation layer.
 *
 * Run with:  cd platform && npx jest lib/template-ast.test.ts
 *
 * What these tests prove:
 *   1. A valid template AST passes validation and returns the typed object.
 *   2. An invalid template AST is rejected with human-readable error messages.
 *   3. Unknown extra fields are rejected (strict mode).
 *   4. The default template fixture validates cleanly.
 *   5. The pacing formula is correct.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { validateTemplateAst } from "./template-ast.schema";
import { DEFAULT_NUANCED_ANALYSIS_TEMPLATE } from "./template-ast-defaults";
import { computeEstimatedMinutes } from "./typst-render.service";
import validFixture from "./fixtures/valid-template-ast.fixture.json";
import invalidFixture from "./fixtures/invalid-template-ast.fixture.json";

describe("TemplateAst validation", () => {
  it("accepts the default template fixture", () => {
    const result = validateTemplateAst(DEFAULT_NUANCED_ANALYSIS_TEMPLATE);
    expect(result.success).toBe(true);
  });

  it("accepts the valid JSON fixture file", () => {
    const result = validateTemplateAst(validFixture);
    expect(result.success).toBe(true);
  });

  it("rejects the invalid JSON fixture with readable errors", () => {
    const result = validateTemplateAst(invalidFixture);
    expect(result.success).toBe(false);
    if (!result.success) {
      // Should report multiple issues
      expect(result.error).toMatch(/TemplateAst validation failed/);
      // templateName is empty string → should fail min(1)
      expect(result.fieldErrors["templateName"]).toBeTruthy();
      // colors.primary is not a hex colour
      expect(result.fieldErrors["colors.primary"]).toBeTruthy();
      // document.pageSize is 'B5' not in enum
      expect(result.fieldErrors["document.pageSize"]).toBeTruthy();
      // document.marginTopMm is 3, below min of 5
      expect(result.fieldErrors["document.marginTopMm"]).toBeTruthy();
      // answerBoxes.defaultKind is invalid
      expect(result.fieldErrors["answerBoxes.defaultKind"]).toBeTruthy();
    }
  });

  it("rejects unknown extra fields (strict mode)", () => {
    const withExtra = {
      ...DEFAULT_NUANCED_ANALYSIS_TEMPLATE,
      header: {
        ...DEFAULT_NUANCED_ANALYSIS_TEMPLATE.header,
        undocumentedExtraField: true,
      },
    };
    const result = validateTemplateAst(withExtra);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/unrecognized key/i);
    }
  });

  it("rejects bodySizePt above maximum", () => {
    const bad = {
      ...DEFAULT_NUANCED_ANALYSIS_TEMPLATE,
      typography: {
        ...DEFAULT_NUANCED_ANALYSIS_TEMPLATE.typography,
        bodySizePt: 20,
      },
    };
    const result = validateTemplateAst(bad);
    expect(result.success).toBe(false);
  });

  it("rejects connections.allowedTypes as empty array", () => {
    const bad = {
      ...DEFAULT_NUANCED_ANALYSIS_TEMPLATE,
      connections: {
        ...DEFAULT_NUANCED_ANALYSIS_TEMPLATE.connections,
        allowedTypes: [],
      },
    };
    const result = validateTemplateAst(bad);
    expect(result.success).toBe(false);
  });
});

describe("Pacing formula", () => {
  it("computes 12/11 pacing correctly", () => {
    // round(3 * 12 / 11) = round(3.27) = 3
    expect(computeEstimatedMinutes(3, 12, 11)).toBe(3);
    // round(6 * 12 / 11) = round(6.54) = 7
    expect(computeEstimatedMinutes(6, 12, 11)).toBe(7);
    // round(11 * 12 / 11) = round(12) = 12
    expect(computeEstimatedMinutes(11, 12, 11)).toBe(12);
  });

  it("uses default 12/11 when no params given", () => {
    expect(computeEstimatedMinutes(3)).toBe(3);
  });
});
