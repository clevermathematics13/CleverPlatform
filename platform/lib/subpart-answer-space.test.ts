/**
 * A subpart's answer space is the subpart's to decide.
 *
 * Found by printing a real paper: "Write the coefficient of k^2" was given
 * three ruled lines, because a subpart inherited half its question's allowance
 * and could never fall below MIN_USEFUL_LINES. Three lines for a one-value
 * answer is not neutral -- it tells the student more is wanted than a value,
 * and it pushes an eight-mark level onto two pages.
 *
 * The field already existed on a QUESTION and on both subpart schemas; the
 * renderer simply never read it on a subpart.
 */
import { describe, it, expect } from "vitest";
import { DocumentOrchestratorService } from "./document-orchestrator";
import { DEFAULT_ASSESSMENT_FORMATTING } from "./formative-assessment-pdf-body";

const formatting = { ...DEFAULT_ASSESSMENT_FORMATTING, answerLineHeightMm: 12, answerBoxLines: 8 };

function render(subparts: Array<Record<string, unknown>>): string {
  const result = DocumentOrchestratorService.render({
    title: "T",
    subtitle: "S",
    instructions: ["Answer every part."],
    sections: [{ heading: "LEVEL 1", questions: [{ prompt: "Q", marks: 2, subparts }] }],
    formatting,
  } as never);
  if (!result.success) throw new Error(result.error);
  return result.html;
}

/** Ruled lines are divs with a bottom border at the configured height. */
const countLines = (html: string) => html.split("border-bottom:0.5pt solid #bbb").length - 1;

describe("answer space follows the answer", () => {
  it("gives a one-value subpart one line when it asks for one", () => {
    expect(countLines(render([{ prompt: "State the coefficient.", marks: 1, answerBoxLines: 1 }]))).toBe(1);
  });

  it("still inherits half the question's allowance when the subpart says nothing", () => {
    // 8 lines on the question -> 4 on the subpart, which is above the floor.
    expect(countLines(render([{ prompt: "Solve.", marks: 3 }]))).toBe(4);
  });

  it("never falls below the useful floor by inheritance alone", () => {
    const html = DocumentOrchestratorService.render({
      title: "T", subtitle: "S", instructions: ["x"],
      sections: [{ heading: "L", questions: [{ prompt: "Q", marks: 1, answerBoxLines: 2, subparts: [{ prompt: "p", marks: 1 }] }] }],
      formatting,
    } as never);
    if (!html.success) throw new Error(html.error);
    // ceil(2/2) = 1, floored up to MIN_USEFUL_LINES = 3.
    expect(countLines(html.html)).toBe(3);
  });

  it("lets a proof subpart ask for room", () => {
    expect(countLines(render([{ prompt: "Prove it.", marks: 4, answerBoxLines: 6 }]))).toBe(6);
  });
});
