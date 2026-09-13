import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildTypstPayload, computeEstimatedMinutes } from "./typst-payload";
import type { ActivityPayload } from "./typst-payload";
import type { TemplateAst } from "./template-ast.schema";

/**
 * The import-boundary tests below guard a bug that neither `npm test` nor
 * `npm run build` could catch: a client component reached the native Typst
 * compiler through this chain
 *
 *   assignments-client.tsx -> nuanced-analysis-sandbox.tsx
 *     -> document-orchestrator-nuanced.ts -> typst-render.service.ts
 *       -> @myriaddreamin/typst-ts-node-compiler (a napi .node addon)
 *
 * and webpack refused it, blanking /dashboard/assignments in `npm run dev`.
 * `next build` tree-shook the import away, so CI and production stayed green
 * the whole time it was broken -- which is exactly why the boundary is
 * asserted here as source-level facts rather than left to a build to notice.
 */
const read = (f: string) => readFileSync(join(process.cwd(), "lib", f), "utf8");

describe("browser-safe import boundary", () => {
  it("document-orchestrator-nuanced does not import the render service", () => {
    const src = read("document-orchestrator-nuanced.ts");
    expect(
      /from\s+"\.\/typst-render\.service"/.test(src),
      "document-orchestrator-nuanced.ts is imported by a client component, so it " +
        "must import ./typst-payload, never ./typst-render.service"
    ).toBe(false);
    expect(/from\s+"\.\/typst-payload"/.test(src)).toBe(true);
  });

  it("typst-payload pulls in no compiler and no Node built-ins", () => {
    const src = read("typst-payload.ts");
    const imports = [...src.matchAll(/^\s*import[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
    expect(imports).not.toContain("@myriaddreamin/typst-ts-node-compiler");
    for (const spec of imports) {
      expect(spec.startsWith("node:"), `typst-payload must not import ${spec}`).toBe(false);
    }
    // A dynamic import would slip past the check above.
    expect(/import\s*\(/.test(src)).toBe(false);
  });

  it("the render service still re-exports what it used to own", () => {
    const src = read("typst-render.service.ts");
    for (const name of [
      "ActivityPayload",
      "ActivityContentAst",
      "ActivitySection",
      "ActivityQuestion",
      "AnswerBoxSpec",
      "computeEstimatedMinutes",
      "buildTypstPayload",
    ]) {
      expect(src.includes(name), `typst-render.service.ts must still export ${name}`).toBe(true);
    }
  });
});

describe("computeEstimatedMinutes", () => {
  it("uses the IB 12/11 convention by default", () => {
    expect(computeEstimatedMinutes(11)).toBe(12);
    expect(computeEstimatedMinutes(0)).toBe(0);
    expect(computeEstimatedMinutes(6)).toBe(7); // 6.545 rounds to 7
  });

  it("honours an explicit numerator and denominator", () => {
    expect(computeEstimatedMinutes(10, 2, 1)).toBe(20);
    expect(computeEstimatedMinutes(10, 1, 2)).toBe(5);
  });
});

describe("buildTypstPayload", () => {
  const template = {
    schemaVersion: "1.0.0",
    questionBlocks: { minutesPerMarkNumerator: 12, minutesPerMarkDenominator: 11 },
  } as unknown as TemplateAst;

  const payload = (): ActivityPayload =>
    ({
      template,
      content: {
        title: "T",
        subtitle: "S",
        sections: [
          {
            heading: "Part 1",
            questions: [
              { prompt: "a", marks: 11 },
              { prompt: "b", marks: 4, estimatedMinutes: 99 },
            ],
          },
        ],
      },
    }) as unknown as ActivityPayload;

  it("annotates each question with pacing derived from its marks", () => {
    const out = buildTypstPayload(payload()) as {
      content: { sections: Array<{ questions: Array<{ estimatedMinutes: number }> }> };
    };
    expect(out.content.sections[0].questions[0].estimatedMinutes).toBe(12);
  });

  it("leaves an explicit estimatedMinutes alone", () => {
    const out = buildTypstPayload(payload()) as {
      content: { sections: Array<{ questions: Array<{ estimatedMinutes: number }> }> };
    };
    expect(out.content.sections[0].questions[1].estimatedMinutes).toBe(99);
  });

  it("defaults the metadata block rather than emitting undefined", () => {
    const out = buildTypstPayload(payload()) as {
      metadata: { generatedAt: string; generatedBy: string; platformVersion: string };
    };
    expect(out.metadata.generatedBy).toBe("CleverPlatform");
    expect(out.metadata.platformVersion).toBe("1.0.0");
    expect(Number.isNaN(Date.parse(out.metadata.generatedAt))).toBe(false);
  });

  it("carries renderOptions through, defaulting to an empty object", () => {
    const out = buildTypstPayload(payload()) as { renderOptions: Record<string, unknown> };
    expect(out.renderOptions).toEqual({});

    const withOpts = buildTypstPayload({
      ...payload(),
      renderOptions: { includeTeacherCompanion: true },
    }) as { renderOptions: Record<string, unknown> };
    expect(withOpts.renderOptions).toEqual({ includeTeacherCompanion: true });
  });
});
