/**
 * The claim this file exists to pin: the exam conditions print on BOTH PDFs.
 *
 * The student paper and the mark scheme are built by two separate functions
 * that shared no cover code at all and had already drifted -- the paper carries
 * a name/block/date grid, a score box and the instructions; the mark scheme
 * carries none of them. A calculator policy that printed on only one of them
 * would be invisible until a mark was being argued over, which is the moment
 * it is needed. Unit-testing lib/exam-conditions.ts alone would not catch that:
 * the block can be perfect and still be wired into one renderer.
 */

import { describe, it, expect } from "vitest";
import { DocumentOrchestratorService, generateMarkSchemeHtml } from "./document-orchestrator";
import { DEFAULT_ASSESSMENT_FORMATTING } from "./formative-assessment-pdf-body";
import { applyKindFormatting } from "./assessment-kind";

const sections = [
  {
    heading: "LEVEL 1 -- READ THE STRUCTURE",
    questions: [
      { prompt: "Write down the coefficient of x in 3x + 7.", marks: 1, answer: "3", markScheme: "A1" },
      {
        prompt: "Solve 5(x + 2) - 4 = 3x + 18.",
        marks: 3,
        answer: "x = 6",
        markScheme: "M1 M1 A1",
      },
    ],
  },
];

const summativeFormatting = applyKindFormatting("summative", DEFAULT_ASSESSMENT_FORMATTING);

function studentHtml(formatting = summativeFormatting): string {
  const result = DocumentOrchestratorService.render({
    title: "Summative Assessment 1",
    subtitle: "Grade 9 Mathematics -- Extended",
    instructions: ["Answer every part."],
    sections,
    formatting,
  });
  if (!result.success) throw new Error(result.error);
  return result.html;
}

function markSchemeHtml(formatting = summativeFormatting): string {
  return generateMarkSchemeHtml({
    title: "Summative Assessment 1",
    subtitle: "Grade 9 Mathematics -- Extended -- MARK SCHEME",
    sections,
    formatting,
  });
}

describe("exam conditions on a summative", () => {
  it("prints the calculator policy on the student paper", () => {
    expect(studentHtml()).toContain("No calculator permitted");
  });

  it("prints it on the mark scheme too", () => {
    // The one that gets forgotten. "Was a GDC allowed?" is the question a
    // disputed mark turns on, and the marker reads this copy.
    expect(markSchemeHtml()).toContain("No calculator permitted");
  });

  it("prints time allowed, the total and the honesty line on both", () => {
    for (const html of [studentHtml(), markSchemeHtml()]) {
      expect(html).toContain("Time allowed:");
      expect(html).toContain("50 minutes");
      expect(html).toContain("Total:");
      expect(html).toContain("4 marks");
      expect(html).toContain("Academic honesty");
    }
  });

  it("counts the total from the questions, not from a field someone typed", () => {
    // 1 + 3. A cover total that disagrees with the paper is worse than none.
    expect(studentHtml()).toContain("4 marks");
  });

  it("styles the block in both stylesheets", () => {
    for (const html of [studentHtml(), markSchemeHtml()]) {
      expect(html).toContain(".exam-conditions");
      expect(html).toContain("ec-honesty");
    }
  });
});

describe("a formative is left exactly as it was", () => {
  it("renders no conditions block on either document", () => {
    const formative = applyKindFormatting("formative", summativeFormatting);
    for (const html of [studentHtml(formative), markSchemeHtml(formative)]) {
      expect(html).not.toContain('<div class="exam-conditions">');
      expect(html).not.toContain("Academic honesty");
      expect(html).not.toContain("Time allowed:");
    }
  });

  it("still renders its own cover furniture", () => {
    // Guards the edit itself: the conditions were inserted into the middle of
    // the student cover, and dropping the meta grid on the way would be easy.
    const html = studentHtml(applyKindFormatting("formative", summativeFormatting));
    expect(html).toContain("Student Name:");
    expect(html).toContain("Summative Assessment 1");
  });
});
