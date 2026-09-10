/**
 * answer-box-columns.test.ts
 * -----------------------------------------------------------------------------
 * A question declares a table through answerBoxColumns, and the field has to
 * survive three hops to mean anything: validation (zod strips what it does not
 * know), the orchestrator (which turns it into an AnswerBoxSpec), and the Typst
 * program (which draws it). typst-answer-box.test.ts covers the last hop; these
 * cover the first two, and the bounds that keep an unusable table out.
 * -----------------------------------------------------------------------------
 */

import { describe, it, expect } from "vitest";
import { AssignmentPdfRequestSchema } from "./template-schema";
import { DocumentOrchestratorService } from "./document-orchestrator-nuanced";
import type { AssignmentDraft } from "./assignments";

// The standard concept map. The middle column holds "Q13", so it is the
// narrowest despite having the longest header -- the inversion that A.1's Q28
// and A.2's Q19 both got wrong.
const CONCEPT_MAP_COLUMNS = [
  { header: "The idea", weight: 4 },
  { header: "Where it appeared (Q number)", weight: 2 },
  { header: "What it connected to", weight: 8 },
];

function parseWithColumns(columns: unknown) {
  return AssignmentPdfRequestSchema.safeParse({
    title: "Packet",
    subtitle: "A.3",
    instructions: ["Go."],
    formatting: {
      schoolName: "S",
      teacherName: "T",
      includeNameLine: true,
      includeDateLine: true,
      includeMarksColumn: true,
      includeAnswerKey: false,
      fontSize: 11,
      lineSpacing: "normal",
      pageMarginsMm: 16,
      numberingStyle: "numeric",
    },
    sections: [
      {
        heading: "Reflection",
        questions: [{ prompt: "List five ideas.", answerBoxColumns: columns }],
      },
    ],
  });
}

describe("answerBoxColumns survives validation", () => {
  it("keeps a valid column spec rather than stripping it", () => {
    const result = parseWithColumns(CONCEPT_MAP_COLUMNS);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.sections[0].questions[0].answerBoxColumns).toEqual(CONCEPT_MAP_COLUMNS);
  });

  it("is optional", () => {
    expect(parseWithColumns(undefined).success).toBe(true);
  });

  it("rejects a table too small or too large to be one", () => {
    expect(parseWithColumns([{ header: "Only", weight: 1 }]).success).toBe(false);
    expect(
      parseWithColumns(Array.from({ length: 7 }, (_, i) => ({ header: `C${i}`, weight: 1 }))).success
    ).toBe(false);
  });

  it("rejects a column with no header or a non-positive weight", () => {
    expect(parseWithColumns([{ header: "", weight: 4 }, { header: "B", weight: 2 }]).success).toBe(false);
    expect(parseWithColumns([{ header: "A", weight: 0 }, { header: "B", weight: 2 }]).success).toBe(false);
  });
});

describe("the orchestrator turns columns into a structured box", () => {
  function build(columns?: Array<{ header: string; weight: number }>) {
    const draft = {
      title: "Packet",
      subtitle: "A.3",
      instructions: ["Go."],
      sections: [
        {
          heading: "Reflection",
          questions: [{ prompt: "List five ideas.", marks: 5, ...(columns ? { answerBoxColumns: columns } : {}) }],
        },
      ],
    } as unknown as AssignmentDraft;
    const built = DocumentOrchestratorService.build(draft, undefined, {
      includeTeacherCompanion: false,
      includeAnswerKey: false,
    });
    if (!built.success) throw new Error(built.error);
    return built.payload.content.sections[0].questions[0].answerBox;
  }

  it("sets kind structured and carries the weights through", () => {
    const box = build(CONCEPT_MAP_COLUMNS);
    expect(box.kind).toBe("structured");
    expect(box.columns).toEqual(CONCEPT_MAP_COLUMNS);
  });

  it("leaves a question without columns on the template default", () => {
    const box = build();
    expect(box.kind).toBe("lined");
    expect(box.columns).toBeUndefined();
  });
});
