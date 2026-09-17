import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ASK_WHAT_YOU_MARK_RULES, askWhatYouMarkBlock } from "./ask-what-you-mark";
import { buildFormativeAssessmentSystemPrompt } from "./formative-assessment-prompt";
import { buildActivityGeneratorSystemPrompt, buildSystemPrompt } from "./assignments";
import { buildAuthoringSystemPrompt } from "./practice-question-generator";

const ROOT = process.cwd();

describe("the rule itself", () => {
  it("states the demand that Key Assessment 1 Q13(b) broke", () => {
    const block = askWhatYouMarkBlock();
    // The scheme wanted the 28% AND the reason; the printed part asked only
    // "explain why the student is wrong".
    expect(block).toMatch(/AND/);
    expect(block).toMatch(/explain why the student is wrong/i);
    expect(block).toMatch(/describe the mistake/);
  });

  it("names asking-for-more as the safe direction of mismatch", () => {
    // The dangerous direction is the one that costs a student a mark.
    expect(askWhatYouMarkBlock()).toMatch(/ask for more and the scheme require less/);
  });

  it("numbers every rule so a teacher can name the one that was broken", () => {
    ASK_WHAT_YOU_MARK_RULES.forEach((rule, i) => {
      expect(rule.startsWith(`A${i + 1}. `), rule.slice(0, 40)).toBe(true);
    });
  });
});

describe("every generator that writes a question carries it", () => {
  it("reaches the assessment, Nuanced Analysis and practice prompts", () => {
    const prompts = [
      buildFormativeAssessmentSystemPrompt("formative"),
      buildFormativeAssessmentSystemPrompt("summative"),
      buildActivityGeneratorSystemPrompt("Grade 9"),
      buildActivityGeneratorSystemPrompt("Grade 12"),
      buildSystemPrompt("Grade 9"),
      buildAuthoringSystemPrompt(),
    ];
    for (const prompt of prompts) {
      expect(prompt).toContain("ASK FOR WHAT YOU WILL MARK");
      for (const rule of ASK_WHAT_YOU_MARK_RULES) expect(prompt).toContain(rule);
    }
  });

  it("splices the block rather than restating it", () => {
    // A copy is a copy that drifts. Every carrier must call the function.
    const files = [
      "lib/formative-assessment-prompt.ts",
      "lib/assignments.ts",
      "lib/practice-question-generator.ts",
    ];
    for (const file of files) {
      const source = readFileSync(join(ROOT, file), "utf8");
      expect(source, `${file} does not splice the rule`).toMatch(/askWhatYouMarkBlock\(\)/);
      expect(source, `${file} restates a rule`).not.toContain("A1. READ THE SCHEME BACK");
      // The old inline rule 16 said this; it lives in the shared block now.
      expect(source, `${file} still carries the old rule 16`).not.toContain(
        "A part that quotes a wrong claim is where this bites hardest"
      );
    }
  });
});
