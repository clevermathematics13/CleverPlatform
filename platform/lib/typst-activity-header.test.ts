/**
 * typst-activity-header.test.ts
 * -----------------------------------------------------------------------------
 * Regression test for the packet header missing from generated PDFs.
 *
 * DESIGN_INSTRUCTIONS 2.1 requires the header block to carry Student Name and
 * Date, Course, Syllabus Topic(s), Prerequisites and Materials; 2.4 adds the
 * ATL statement. The orchestrator sent syllabusTopics, prerequisites,
 * materials and compulsoryCore, and the shipped Typst program read none of
 * them -- it emitted only course, title, subtitle and a "Name:" line. ATL had
 * no slot in ActivityContentAst at all. So the live preview showed a compliant
 * header and the downloaded PDF quietly dropped it, and nothing failed loudly
 * enough to notice.
 *
 * These cases compile the real shipped program against a real orchestrator
 * payload and read the rendered text back out of Typst's SVG output, rather
 * than asserting on the source. A mistyped content key would still compile and
 * still render nothing, which is exactly the failure being pinned here.
 * -----------------------------------------------------------------------------
 */

import { describe, it, expect, beforeAll } from "vitest";
import { NodeCompiler } from "@myriaddreamin/typst-ts-node-compiler";
import { getActivityTypstSource, buildTypstPayload } from "./typst-render.service";
import { DocumentOrchestratorService } from "./document-orchestrator-nuanced";
import type { AssignmentDraft } from "./assignments";

let compiler: ReturnType<typeof NodeCompiler.create>;
let source: string;

beforeAll(() => {
  compiler = NodeCompiler.create();
  source = getActivityTypstSource();
});

/** Render a draft through the real orchestrator + template and return its text. */
function renderText(extra: Record<string, unknown>): string {
  const draft = {
    title: "Key Algebraic Properties",
    subtitle: "Nuanced Analysis Packet A.3",
    instructions: ["Complete all questions."],
    sections: [
      { heading: "Part 0", questions: [{ prompt: "Show that $2+2=4$.", marks: 2 }] },
    ],
    ...extra,
  } as unknown as AssignmentDraft;

  const built = DocumentOrchestratorService.build(draft, undefined, {
    includeTeacherCompanion: false,
    includeAnswerKey: false,
  });
  if (!built.success) throw new Error(`orchestrator build failed: ${built.error}`);

  return compiler.svg({
    mainFileContent: source,
    inputs: { payload: JSON.stringify(buildTypstPayload(built.payload)) },
  });
}

const FULL_HEADER = {
  course: "Pre-DP Mathematics (Grade 9, preparing for IBDP Mathematics AA)",
  syllabusTopics: "Pre-Topic 1 - commutative, associative and distributive properties",
  prerequisites: "From A.2: the formal definition $a - b := a + (-b)$",
  materials: "Pencil, ruler for area diagrams, GDC",
  atl: "You will build representational fluency.",
  compulsoryCore: "Parts 0 to 2 are compulsory.",
};

describe("the rendered packet header", () => {
  it("prints every DESIGN_INSTRUCTIONS 2.1 field the payload carries", () => {
    const text = renderText(FULL_HEADER);
    expect(text).toContain("Student Name");
    expect(text).toContain("Date");
    expect(text).toContain("Syllabus Topics");
    expect(text).toContain("Pre-Topic 1 - commutative, associative and distributive properties");
    expect(text).toContain("Prerequisites");
    expect(text).toContain("Pencil, ruler for area diagrams, GDC");
  });

  it("prints the ATL statement and the compulsory-core callout", () => {
    const text = renderText(FULL_HEADER);
    expect(text).toContain("ATL skill");
    expect(text).toContain("You will build representational fluency.");
    // callout-box uppercases its label.
    expect(text).toContain("COMPULSORY CORE");
    expect(text).toContain("Parts 0 to 2 are compulsory.");
  });

  it("renders currency prose in a header field literally instead of as math", () => {
    // Two dollar amounts in one sentence read as a $...$ math span; evaluating
    // that fragment is what once took the whole document down (see
    // typst-rich-inline-math.test.ts). Header fields go through rich() too.
    const text = renderText({
      syllabusTopics: "Pencils cost $2.50 per package and pens cost $3 per package",
    });
    expect(text).toContain("Pencils cost $2.50 per package");
  });

  it("compiles a packet that carries none of these fields", () => {
    // The Typst program uses direct dictionary access, where a missing key is a
    // hard compile failure for the whole document, so absence has to be a
    // supported case rather than an accident.
    const text = renderText({});
    expect(text).toContain("Key Algebraic Properties");
    for (const label of ["Syllabus Topics", "Prerequisites", "ATL skill", "COMPULSORY CORE"]) {
      expect(text).not.toContain(label);
    }
  });

  it("omits a field that is empty, blank or not a string", () => {
    // Otherwise a bare "Syllabus Topics:" label prints with nothing after it,
    // and a non-string reaches rich()'s .split("$") and crashes the render.
    const text = renderText({ syllabusTopics: "   ", prerequisites: null, atl: 42 });
    expect(text).not.toContain("Syllabus Topics");
    expect(text).not.toContain("Prerequisites");
    expect(text).not.toContain("ATL skill");
  });
});
