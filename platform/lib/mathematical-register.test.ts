import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MATHEMATICAL_REGISTER_RULES,
  mathematicalRegisterBlock,
  findLooseRegisterTerms,
} from "./mathematical-register";
import { buildFormativeAssessmentSystemPrompt } from "./formative-assessment-prompt";
import { buildActivityGeneratorSystemPrompt, buildSystemPrompt } from "./assignments";
import { buildDPSystemPrompt } from "./dp-question-designer";
import { buildAuthoringSystemPrompt } from "./practice-question-generator";
import { buildAssessmentSystemPrompt } from "./na-assessment";

const ROOT = process.cwd();

describe("the register itself", () => {
  it("names the distinctions the Grade 9 review turned up", () => {
    const block = mathematicalRegisterBlock();
    // Two expressions are equal at a value and equivalent on a domain; a
    // value an expression has no meaning at is not in the domain.
    expect(block).toMatch(/EQUAL/);
    expect(block).toMatch(/EQUIVALENT/);
    expect(block).toMatch(/NOT IN THE DOMAIN/);
    expect(block).toMatch(/UNDEFINED/);
  });

  it("forbids reaching for notation the course has not taught", () => {
    // The obvious failure mode of a rigour rule is a Grade 9 paper that
    // starts writing set-builder notation.
    const r10 = MATHEMATICAL_REGISTER_RULES.find((r) => r.startsWith("R10."));
    expect(r10).toBeDefined();
    expect(r10).toMatch(/not.*unfamiliar notation|NOT UNFAMILIAR NOTATION/i);
  });

  it("is a single numbered list, so a finding can name the rule broken", () => {
    MATHEMATICAL_REGISTER_RULES.forEach((rule, i) => {
      expect(rule.startsWith(`R${i + 1}.`), `rule ${i + 1} is misnumbered: ${rule}`).toBe(true);
    });
  });
});

describe("findLooseRegisterTerms", () => {
  it("catches the two wordings the teacher sent back", () => {
    expect(findLooseRegisterTerms("State precisely where the two expressions agree.")[0]?.rule).toBe(2);
    expect(
      findLooseRegisterTerms("Write down the value of w that is excluded from this equation.")[0]?.rule,
    ).toBe(3);
  });

  it("catches the operation-hiding verbs", () => {
    // "cancel" is the one that matters: it hides a division by something
    // that may be zero, which is what these questions assess.
    expect(findLooseRegisterTerms("Cancel the (x - 5) from top and bottom.")).not.toHaveLength(0);
    expect(findLooseRegisterTerms("Move the 4 to the other side.")).not.toHaveLength(0);
    expect(findLooseRegisterTerms("Plug in x = 5.")).not.toHaveLength(0);
  });

  it("leaves correct wording alone", () => {
    const clean = [
      "State the values of $x$ for which the two expressions are equal.",
      "State the value of $w$ for which this equation is undefined.",
      "Multiply every term by $(w - 3)$, then divide both sides by 3.",
      "Substitute $x = 5$ into your expression from part (a).",
      "Factor the numerator and simplify the expression. State the restriction on $x$.",
      "Give the exact value; do not give a decimal approximation.",
    ];
    for (const text of clean) {
      expect(findLooseRegisterTerms(text), `false positive on: ${text}`).toEqual([]);
    }
  });

  it("does not read quoted speech, which is loose on purpose", () => {
    // A Broken Math Critique question quotes a student's wrong claim so the
    // reader can take it apart; a mark scheme quotes the answer it refuses.
    const critique = "A student says: 'That is the same as $30\\%$ off.' Explain why the student is wrong.";
    expect(findLooseRegisterTerms(critique)).toEqual([]);
    expect(findLooseRegisterTerms(`R1 for the reason. "They are the same thing" earns 0.`)).toEqual([]);
  });

  it("still reads the prose around a quotation", () => {
    expect(
      findLooseRegisterTerms("A student says 'it halves'. Cancel the common factor, then check."),
    ).not.toHaveLength(0);
  });

  it("does not mistake an apostrophe for an opening quotation mark", () => {
    // "student's" and "don't" must not swallow the rest of the sentence.
    expect(
      findLooseRegisterTerms("Substitute into the student's own expression; don't restart."),
    ).toEqual([]);
    expect(
      findLooseRegisterTerms("Mark the student's working, then cancel nothing silently."),
    ).not.toHaveLength(0);
  });

  it("reports each pattern at most once, so one repeated word cannot bury the rest", () => {
    const hits = findLooseRegisterTerms("Cancel it, then cancel it again, then plug in 5.");
    expect(hits.filter((h) => /cancel/i.test(h.found))).toHaveLength(1);
    expect(hits.some((h) => /plug/i.test(h.found))).toBe(true);
  });
});

describe("every generator that authors mathematics carries the register", () => {
  const carriers: [string, string][] = [
    ["formative assessment", buildFormativeAssessmentSystemPrompt("formative")],
    ["summative assessment", buildFormativeAssessmentSystemPrompt("summative")],
    ["NA activity packet", buildActivityGeneratorSystemPrompt("Grade 9")],
    ["standard assignment template", buildSystemPrompt("Grade 9")],
    ["DP curriculum module", buildDPSystemPrompt()],
    ["practice question", buildAuthoringSystemPrompt()],
    ["NA review feedback (crop)", buildAssessmentSystemPrompt("crop")],
    ["NA review feedback (wide)", buildAssessmentSystemPrompt("wide_context")],
  ];

  it.each(carriers)("%s", (_name, prompt) => {
    expect(prompt).toContain("MATHEMATICAL REGISTER");
    for (const rule of MATHEMATICAL_REGISTER_RULES) expect(prompt).toContain(rule);
  });

  it("splices the block rather than restating it", () => {
    // A copy is a copy that drifts. Every carrier must call the function.
    const files = [
      "lib/formative-assessment-prompt.ts",
      "lib/assignments.ts",
      "lib/dp-question-designer.ts",
      "lib/practice-question-generator.ts",
      "lib/na-assessment.ts",
      "lib/nuanced-analysis-spec.compile.ts",
    ];
    for (const file of files) {
      const source = readFileSync(join(ROOT, file), "utf8");
      expect(source, `${file} does not splice the register`).toMatch(/mathematicalRegisterBlock\(\)/);
      // and does not paste a rule's text inline
      expect(source, `${file} restates a register rule`).not.toContain("R2. EQUAL IS NOT EQUIVALENT");
    }
  });
});
