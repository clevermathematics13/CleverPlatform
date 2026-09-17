/**
 * teacher-companion.compile.test.ts
 * -----------------------------------------------------------------------------
 * The Teacher's Companion has one property that matters more than how it looks:
 * it must reach the instructor's copy and NOT the students'. It is a field
 * rather than a section for exactly that reason -- a section in `sections`
 * prints in every copy -- so the test that protects it has to compare the two
 * renders rather than inspect one.
 *
 * The second property is that it cannot take the packet down with it. The Typst
 * dict is all-or-nothing (a key present but the wrong shape aborts the whole
 * document, not one block), so a half-written companion must degrade to no
 * companion. sanitiseTeacherCompanion is what guarantees that, and the
 * malformed case below is the one that would otherwise ship a packet that
 * refuses to print.
 * -----------------------------------------------------------------------------
 */

import { describe, it, expect } from "vitest";
import { DocumentOrchestratorService } from "./document-orchestrator-nuanced";
import { TypstRenderService } from "./typst-render.service";
import type { AssignmentDraft, TeacherCompanion } from "./assignments";

const COMPANION: TeacherCompanion = {
  designNote: "Built around $\\frac{\\mathrm{d}y}{\\mathrm{d}x}$ as the hinge.",
  tieredDeadlines: [{ slot: "Lesson 1", covers: "Part 0" }],
  integrationMap: [{ element: "Topic 5.14", location: "Part 0" }],
  partNotes: [
    {
      part: "Part 0",
      timing: "40 min",
      purpose: "New teaching, not revision.",
      watchFor: ["Differentiating $y^{2}$ to $2y$ and stopping."],
      ifStuck: "Ask which of the three steps they are on.",
    },
  ],
  plantedErrors: [
    {
      question: "Q23",
      misconceptionName: "Division by an expression containing the unknown",
      errorDescription: "Dividing by $\\cos x$ discards the roots where $\\cos x = 0$.",
      correctAnswer: "$x = \\frac{\\pi}{2}$",
      hlConcept: "Factorise, never divide.",
    },
  ],
};

function draftWith(companion?: unknown): AssignmentDraft {
  return {
    title: "Companion Test Packet",
    subtitle: "Mastery Packet",
    instructions: ["Show all working."],
    sections: [
      {
        heading: "Part 0 — Activating Prior Knowledge",
        questions: [
          { prompt: "Find $\\frac{\\mathrm{d}y}{\\mathrm{d}x}$ for $y^{2} + x = 7$.", marks: 3, tier: 1 },
        ],
      },
    ],
    ...(companion === undefined ? {} : { teacherCompanion: companion as TeacherCompanion }),
  };
}

function pageCount(pdf: Buffer): number {
  const counts = [...pdf.toString("latin1").matchAll(/\/Count\s+(\d+)/g)].map((m) => Number(m[1]));
  return counts.length > 0 ? Math.max(...counts) : 0;
}

async function render(draft: AssignmentDraft, includeTeacherCompanion: boolean) {
  const built = DocumentOrchestratorService.build(draft, undefined, {
    includeTeacherCompanion,
    includeAnswerKey: false,
  });
  expect(built.success, `orchestrator: ${built.success ? "" : built.error}`).toBe(true);
  if (!built.success) throw new Error(built.error);
  const result = await TypstRenderService.render(built.payload);
  expect(result.success, `compile: ${result.success ? "" : `${result.error} ${result.detail ?? ""}`}`).toBe(true);
  if (!result.success) throw new Error(result.error);
  return { payload: built.payload, pages: result.pageCount ?? pageCount(result.pdfBuffer) };
}

describe("Teacher's Companion", () => {
  it("reaches the instructor's copy and not the student's", async () => {
    const draft = draftWith(COMPANION);

    const teacher = await render(draft, true);
    const student = await render(draft, false);

    // The companion is carried on the content AST either way -- it is
    // renderOptions, not the payload, that decides who sees it.
    expect(teacher.payload.content.teacherCompanion).toBeDefined();

    // ...and only the instructor's render pays for the pages.
    expect(teacher.pages).toBeGreaterThan(student.pages);
  }, 120_000);

  it("still compiles for a packet that has no companion at all", async () => {
    const { payload, pages } = await render(draftWith(undefined), true);
    expect(payload.content.teacherCompanion).toBeUndefined();
    expect(pages).toBeGreaterThan(0);
  }, 120_000);

  it("degrades a malformed companion to none rather than aborting the document", async () => {
    const malformed = {
      designNote: "   ",
      tieredDeadlines: [{ slot: "Lesson 1" }, "not an object"],
      integrationMap: "not an array",
      partNotes: [{ timing: "40 min" }],
      plantedErrors: [{ question: "Q1" }],
    };
    const { payload, pages } = await render(draftWith(malformed), true);
    expect(payload.content.teacherCompanion).toBeUndefined();
    expect(pages).toBeGreaterThan(0);
  }, 120_000);

  it("keeps only the entries that carry their required fields", () => {
    const built = DocumentOrchestratorService.build(
      draftWith({
        ...COMPANION,
        tieredDeadlines: [{ slot: "Lesson 1", covers: "Part 0" }, { slot: "Lesson 2", covers: "" }],
        plantedErrors: [...(COMPANION.plantedErrors ?? []), { question: "Q9", misconceptionName: "x" }],
      }),
      undefined,
      { includeTeacherCompanion: true, includeAnswerKey: false },
    );
    expect(built.success).toBe(true);
    if (!built.success) return;
    const tc = built.payload.content.teacherCompanion;
    expect(tc?.tieredDeadlines).toHaveLength(1);
    expect(tc?.plantedErrors).toHaveLength(1);
  });
});
