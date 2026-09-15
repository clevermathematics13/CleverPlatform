/**
 * tok-provocations.test.ts
 * -----------------------------------------------------------------------------
 * What these prove:
 *   1. The bar is a single, consistently numbered list, so a teacher rejecting
 *      a provocation can name the rule it broke.
 *   2. It names the bolted-on openers outright, which is the whole point.
 *   3. "Where appropriate" constrains the ANGLE, never the count -- the spec
 *      fixes that at exactly 2 and the Reflection, preview and Typst callout
 *      all assume both are present.
 *   4. Both DP creators carry it, and pre-DP deliberately does not.
 *   5. Nobody pasted a copy of it, and the compiled prompt is still
 *      byte-identical run to run.
 * -----------------------------------------------------------------------------
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  TOK_PROVOCATION_RULES,
  TOK_ANGLE_MENU,
  tokProvocationBlock,
} from "./tok-provocations";
import { buildActivityGeneratorSystemPrompt } from "./assignments";
import { compileSpecToSystemPrompt } from "./nuanced-analysis-spec.compile";
import { CANONICAL_AAHL_SPEC } from "./nuanced-analysis-spec.defaults";

const ROOT = process.cwd();

describe("the bar itself", () => {
  it("is a single numbered list, so a finding can name the rule broken", () => {
    TOK_PROVOCATION_RULES.forEach((rule, i) => {
      expect(rule.startsWith(`T${i + 1}.`), `rule ${i + 1} is misnumbered: ${rule}`).toBe(true);
    });
  });

  it("demands an anchor in this packet and a defensible other side", () => {
    const block = tokProvocationBlock();
    // T1 and T2 are the two that separate a provocation from a decoration.
    expect(block).toMatch(/ANCHOR EACH PROVOCATION IN THIS PACKET/);
    expect(block).toMatch(/BOTH ANSWERS MUST BE DEFENSIBLE/);
  });

  it("names the bolted-on openers, rather than describing them", () => {
    // A rule that said "avoid generic TOK" would be unenforceable. These are
    // the exact lines that arrive unattached.
    const t6 = TOK_PROVOCATION_RULES.find((r) => r.startsWith("T6."));
    expect(t6).toBeDefined();
    expect(t6).toContain("Is mathematics discovered or invented?");
    expect(t6).toContain("Is mathematics a universal language?");
    expect(t6).toContain("Can we ever be certain of anything in mathematics?");
    // Banned in BARE form only -- the question underneath is a good one, and
    // the rule has to say so or the model will avoid the idea entirely.
    expect(t6).toMatch(/banned in bare form|BANNED IN BARE FORM/i);
  });

  it("carries the portability test, which is how a bolted-on one is caught", () => {
    const t5 = TOK_PROVOCATION_RULES.find((r) => r.startsWith("T5."));
    expect(t5).toMatch(/pasted unchanged into a packet on a completely different topic/);
  });

  it("reads 'where appropriate' as the angle, never as permission to skip one", () => {
    const block = tokProvocationBlock();
    expect(block).toMatch(/TAKE THE ANGLE THIS MATHEMATICS ACTUALLY RAISES/);
    // Nothing in the bar may make a provocation conditional: two is the
    // contract everywhere downstream.
    expect(block).not.toMatch(/omit (?:the|a|one) (?:TOK )?provocation/i);
    expect(block).not.toMatch(/only include .{0,40}provocations? (?:if|when)/i);
  });

  it("keeps somewhere honest to go for a computational packet", () => {
    // T4 forbids inflating to a metaphysical question the mathematics cannot
    // support, so the menu has to offer a small true one instead.
    expect(TOK_ANGLE_MENU.join(" ")).toMatch(/technology/);
    expect(TOK_ANGLE_MENU.join(" ")).toMatch(/definition lets in/);
  });

  it("shows a worked provocation instead of only describing one", () => {
    const block = tokProvocationBlock();
    expect(block).toMatch(/A provocation that passes T1-T5/);
    expect(block).toMatch(/Why it passes/);
  });

  it("takes the caller's angles when it is given some", () => {
    const block = tokProvocationBlock(["How a sample can flatter the population it came from."]);
    expect(block).toContain("How a sample can flatter the population it came from.");
    // ... and only those, so the DB stays the single source on that path.
    expect(block).not.toContain(TOK_ANGLE_MENU[0]);
  });

  it("is pure, so the compiled prompt stays reproducible", () => {
    expect(tokProvocationBlock(CANONICAL_AAHL_SPEC.tok.angles)).toBe(
      tokProvocationBlock(CANONICAL_AAHL_SPEC.tok.angles),
    );
  });
});

describe("every DP Nuanced Analysis creator carries the bar", () => {
  const carriers: [string, string][] = [
    ["NA tab, Grade 12", buildActivityGeneratorSystemPrompt("Grade 12")],
    ["NA tab, Grade 11", buildActivityGeneratorSystemPrompt("Grade 11")],
    ["/admin/create, spec-compiled", compileSpecToSystemPrompt(CANONICAL_AAHL_SPEC)],
  ];

  it.each(carriers)("%s", (_name, prompt) => {
    expect(prompt).toContain("TOK PROVOCATIONS -- THE QUALITY BAR");
    for (const rule of TOK_PROVOCATION_RULES) expect(prompt).toContain(rule);
  });

  it("still states the count and the Reflection return alongside it", () => {
    const spec = compileSpecToSystemPrompt(CANONICAL_AAHL_SPEC);
    expect(spec).toContain("EXACTLY 2 TOK");
    expect(buildActivityGeneratorSystemPrompt("Grade 12")).toMatch(
      /tokProvocations: exactly 2/,
    );
  });

  it("asks the DP reflection to cite a numbered result, not a feeling", () => {
    const dp = buildActivityGeneratorSystemPrompt("Grade 12");
    expect(dp).toMatch(/specific numbered result from this packet as the evidence/);
  });
});

describe("pre-DP packets are deliberately left alone", () => {
  // Grade 9/10 students are not in TOK. Their packets keep the older
  // one-line rule; adding the bar there would be a change nobody asked for.
  it.each(["Grade 9", "Grade 10"])("%s does not carry the bar", (grade) => {
    const prompt = buildActivityGeneratorSystemPrompt(grade);
    expect(prompt).not.toContain("TOK PROVOCATIONS -- THE QUALITY BAR");
    expect(prompt).toContain(
      "12. tokProvocations: exactly 2, both referencing a real philosophical tension in the mathematics.",
    );
  });
});

describe("one copy of the bar, not two", () => {
  it("splices the block rather than restating it", () => {
    // The two DP creators reach the model by different routes. A copy is a
    // copy that drifts.
    const files = ["lib/assignments.ts", "lib/nuanced-analysis-spec.compile.ts"];
    for (const file of files) {
      const source = readFileSync(join(ROOT, file), "utf8");
      expect(source, `${file} does not splice the bar`).toMatch(/tokProvocationBlock\(/);
      expect(source, `${file} restates a bar rule`).not.toContain("T5. THE PORTABILITY TEST");
    }
  });
});
