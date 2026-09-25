/**
 * The student mark scheme never says "AI" or names a model (CLAUDE.md:
 * "Never 'AI' ... anywhere a student can see it"), though its explanations
 * are written by one. The generated text is checked by checkExplanation;
 * this checks the code a student's browser runs and the page it loads, in
 * their source, where a new label or error message would be written.
 * Comments are included on purpose: a file a student downloads is no place
 * to explain that either.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");

const STUDENT_FACING = [
  "components/reflection/MarkSchemePart.tsx",
  "components/reflection/ExplainMore.tsx",
  "components/reflection/ExplanationDiagram.tsx",
  "components/reflection/OfficeHoursLink.tsx",
  "app/mark-scheme/[id]/page.tsx",
  "lib/office-hours.ts",
  "lib/math-text.ts",
  "lib/tex-render.ts",
  "lib/diagram-math.ts",
  "lib/student-mark-scheme-access.ts",
  "lib/student-mark-scheme-paths.ts",
];

describe("student mark scheme copy", () => {
  it.each(STUDENT_FACING)("%s never says AI or names a model", (file) => {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    expect(source).not.toMatch(/\bAI\b|\bClaude\b|\bAnthropic\b|artificial intelligence|language model/);
  });

  it("offers the office hours booking page", () => {
    const source = fs.readFileSync(path.join(ROOT, "lib/office-hours.ts"), "utf8");
    expect(source).toContain("https://calendar.app.google/ZV43sgr6EcWY5KkF8");
  });

  it("keeps the slideshow's button words as the teacher asked for them", () => {
    const source = fs.readFileSync(path.join(ROOT, "components/reflection/ExplainMore.tsx"), "utf8");
    expect(source).toContain("I understand, please continue");
    expect(source).toContain("Explain this further");
    const card = fs.readFileSync(path.join(ROOT, "components/reflection/MarkSchemePart.tsx"), "utf8");
    expect(card).toContain("Explain more");
  });
});
