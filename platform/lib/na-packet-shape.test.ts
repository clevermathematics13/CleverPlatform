/**
 * na-packet-shape.test.ts
 * -----------------------------------------------------------------------------
 * Guards the Grade 9/10 packet-shape rules (26-32) in MYP_ROLLING_BUNDLE_RULES.
 *
 * Those rules are not a style preference someone invented. They are a
 * description of the two packets Grade 9 Extended has actually taught and
 * marked -- A.1 "Sixty Times a Person" and A.2 "What Undoing Really Means" --
 * measured out of `nuanced_analyses.parts` on 16 Sep 2026:
 *
 *              parts  questions  marks   subparts  answerBoxColumns
 *   A.1          8        35      132        0            0
 *   A.2          8        25       99        0            0
 *
 * and both laid out identically: Part 0 "Warming the Engine", five named
 * teaching Parts, "Reflection" (3 questions, tier 2, 15-16 marks), "Optional
 * Extension" (0 marks, tier 3, Branch A/B/C plus a Toolbox Wondering seed).
 *
 * The B.4 packet generated before these rules existed came back with five
 * sections, no Reflection section, no Optional Extension, subparts throughout,
 * and a heading that collided with A.1's own Part 5. Hence rule 32.
 *
 * These assertions are deliberately about the PROMPT, not about a model's
 * output: what ships is the instruction, and a rule silently dropped from the
 * prompt is exactly how the shape was lost the first time.
 * -----------------------------------------------------------------------------
 */

import { describe, it, expect } from "vitest";
import { buildActivityGeneratorSystemPrompt } from "./assignments";

const g9 = buildActivityGeneratorSystemPrompt("Grade 9");
const g10 = buildActivityGeneratorSystemPrompt("Grade 10");
const g12 = buildActivityGeneratorSystemPrompt("Grade 12");

describe("packet-shape rules reach the Grade 9/10 prompt", () => {
  it.each([
    ["the eight-section spine", /EIGHT sections/],
    ["Part 0's fixed heading", /Part 0 — Warming the Engine/],
    ["Reflection as a real section", /Reflection and Optional Extension are full sections/],
    ["the three fixed Reflection questions", /concept-map question/],
    ["the TOK position statement", /return to the two provocations/i],
    ["Branch headings", /'Branch A — ', 'Branch B — ', 'Branch C — '/],
    ["the exploration seed", /Toolbox Wondering \(exploration seed\)/],
    ["the no-subparts rule", /Do NOT use subparts/],
    ["the size envelope", /25-35 questions and 100-132 marks/],
    ["the heading-reuse rule", /Do not reuse a section heading/],
  ])("carries %s", (_label, pattern) => {
    expect(g9).toMatch(pattern);
    expect(g10).toMatch(pattern);
  });

  it("states the measured per-part budgets", () => {
    expect(g9).toMatch(/3-4 questions, 10-11 marks/);   // Part 0
    expect(g9).toMatch(/3-6 questions and 12-24 marks/); // teaching Parts
  });

  it("bans the bare-label headings the first B.4 used", () => {
    expect(g9).toMatch(/never a bare label/);
    expect(g9).toContain("Part 1 — Structure");
  });

  it("explains WHY subparts are banned, not just that they are", () => {
    // A rule with no reason attached is the one a future editor deletes.
    expect(g9).toMatch(/its own anchor box/);
  });
});

describe("packet-shape rules stay out of the IBDP prompt", () => {
  // Grade 11/12 packets are Season/Episode coded and follow the DP exemplar,
  // not the pre-DP rolling bundle. Leaking an MYP shape rule into them would
  // silently restructure every DP packet.
  it.each([
    ["EIGHT sections", /EIGHT sections/],
    ["Warming the Engine", /Warming the Engine/],
    ["Toolbox Wondering", /Toolbox Wondering/],
    ["no-subparts", /Do NOT use subparts/],
  ])("does not carry %s", (_label, pattern) => {
    expect(g12).not.toMatch(pattern);
  });
});

describe("the shape rules do not contradict the rules already there", () => {
  it("keeps the rolling-bundle zones, which the new rules sit inside", () => {
    expect(g9).toMatch(/PRE-DP ROLLING BUNDLE STRUCTURE/);
    expect(g9).toMatch(/Teacher's Companion/);
  });

  it("points answerBoxColumns at rule 6b rather than restating its weights", () => {
    // Two copies of the 4/2/8 weighting would drift; the concept-map question
    // is the one place the packet uses the field, so it cites the rule.
    expect(g9).toMatch(/answerBoxColumns, weighted per rule 6b/);
  });

  it("numbers the new rules without colliding with the existing ones", () => {
    const numbers = [...g9.matchAll(/^(\d{1,2})\. /gm)].map((m) => Number(m[1]));
    const duplicated = numbers.filter((n, i) => n >= 26 && numbers.indexOf(n) !== i);
    expect(duplicated, `duplicate rule numbers: ${duplicated.join(", ")}`).toEqual([]);
  });
});
