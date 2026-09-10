/**
 * typst-answer-box.test.ts
 * -----------------------------------------------------------------------------
 * The Typst program took only heightMm from the AnswerBoxSpec. kind and
 * lineSpacingMm were computed by the orchestrator and validated by
 * template-ast.schema, then dropped at the point of use -- so a template
 * configured "lined", which is the default, printed an empty rectangle, and
 * the "grid" and "structured" kinds the schema allows had no renderer at all.
 *
 * These cases compile the real shipped program, because a spec key that is
 * mistyped here would still compile and still draw nothing, which is the
 * failure being pinned.
 * -----------------------------------------------------------------------------
 */

import { describe, it, expect, beforeAll } from "vitest";
import { NodeCompiler } from "@myriaddreamin/typst-ts-node-compiler";
import { getActivityTypstSource, buildTypstPayload } from "./typst-render.service";
import { DocumentOrchestratorService } from "./document-orchestrator-nuanced";
import { DEFAULT_NUANCED_ANALYSIS_TEMPLATE } from "./template-ast-defaults";
import type { AssignmentDraft } from "./assignments";

let compiler: ReturnType<typeof NodeCompiler.create>;
let source: string;

beforeAll(() => {
  compiler = NodeCompiler.create();
  source = getActivityTypstSource();
});

type Kind = "blank" | "lined" | "grid" | "structured";

function render(question: Record<string, unknown>, kind?: Kind): string {
  const draft = {
    title: "Answer Space",
    subtitle: "Nuanced Analysis Packet A.3",
    instructions: ["Complete all questions."],
    sections: [{ heading: "Reflection", questions: [question] }],
  } as unknown as AssignmentDraft;

  const template = kind
    ? {
        ...DEFAULT_NUANCED_ANALYSIS_TEMPLATE,
        answerBoxes: { ...DEFAULT_NUANCED_ANALYSIS_TEMPLATE.answerBoxes, defaultKind: kind },
      }
    : undefined;

  const built = DocumentOrchestratorService.build(draft, template, {
    includeTeacherCompanion: false,
    includeAnswerKey: false,
  });
  if (!built.success) throw new Error(`orchestrator build failed: ${built.error}`);

  return compiler.svg({
    mainFileContent: source,
    inputs: { payload: JSON.stringify(buildTypstPayload(built.payload)) },
  });
}

/** Drawn primitives in the SVG -- rules are paths, not text. */
const strokes = (svg: string) => (svg.match(/<path/g) ?? []).length;

const PLAIN = { prompt: "Explain your reasoning.", marks: 4 };

// The reflection table A.1's Q28 and A.2's Q19 both needed: the middle column
// holds only a question number, so it gets the least room, not the most.
const CONCEPT_MAP = {
  prompt: "List five ideas this analysis connected for you.",
  marks: 5,
  answerBoxColumns: [
    { header: "The idea", weight: 4 },
    { header: "Where it appeared", weight: 2 },
    { header: "What it connected to", weight: 8 },
  ],
};

describe("answer boxes honour the spec's kind", () => {
  it("draws rules for a lined box and none for a blank one", () => {
    expect(strokes(render(PLAIN, "lined"))).toBeGreaterThan(strokes(render(PLAIN, "blank")));
  });

  it("draws more for a grid than for lines alone", () => {
    expect(strokes(render(PLAIN, "grid"))).toBeGreaterThan(strokes(render(PLAIN, "lined")));
  });

  it("compiles every kind the schema allows", () => {
    for (const kind of ["blank", "lined", "grid", "structured"] as Kind[]) {
      expect(render(PLAIN, kind), kind).toContain("Explain your reasoning.");
    }
  });

  it("falls back rather than failing when structured has no columns", () => {
    // "structured" is the template default here but the question declares no
    // columns, so there is nothing to build a table from.
    expect(strokes(render(PLAIN, "structured"))).toBeGreaterThan(0);
  });
});

describe("a question that declares columns gets a table", () => {
  it("prints each column header", () => {
    const svg = render(CONCEPT_MAP);
    expect(svg).toContain("The idea");
    expect(svg).toContain("What it connected to");
    // The weight-2 column is narrow enough that its header wraps, so the words
    // land in separate text runs rather than one contiguous string.
    expect(svg).toContain("Where");
    expect(svg).toContain("appeared");
  });

  it("applies the weights, not an even split", () => {
    const svg = render(CONCEPT_MAP);
    // Same header length either side of the divide: "What it connected to" at
    // weight 8 stays on one line while "Where it appeared" at weight 2 wraps.
    // An even split would either wrap both or neither.
    expect(svg).toContain("What it connected to");
    expect(svg).not.toContain("Where it appeared");
  });

  it("builds the table whatever the template's default kind is", () => {
    // The columns are the more specific instruction; "blank" must not win.
    expect(render(CONCEPT_MAP, "blank")).toContain("What it connected to");
  });
});
