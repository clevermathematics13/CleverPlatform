/**
 * typst-progress-tracker.test.ts
 * -----------------------------------------------------------------------------
 * Regression test for a progress tracker that did not name the sections it was
 * tracking.
 *
 * The tracker used to print a running count -- "Part 1" through "Part N" --
 * which silently assumed the sections were headed Part 1..N in order. They
 * never are. The shipped B.4 packet ("Products of Linear Expressions",
 * 16 Sep 2026) has ten sections:
 *
 *   Part 0 - Warming the Engine          Reflection
 *   Part 1 - How Many Terms, What Move   Optional Extension
 *   ...                                  B.5 Pre-Class Prep - ...
 *   Part 5 - One Method, Four Disguises  Teacher's Companion (tear off)
 *
 * so it printed "Part 1 ... Part 10": every box off by one against the page it
 * named, and the last pointing at a section that is torn off before the packet
 * is handed out. A.1 and A.2 shipped with the same mismatch.
 *
 * These cases compile the real shipped program against a real orchestrator
 * payload and read the text back out of the SVG, following
 * typst-activity-header.test.ts. Asserting on the template source would pass
 * just as happily with a mistyped key that rendered nothing.
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

function renderHeadings(headings: string[]): string {
  const draft = {
    title: "Products of Linear Expressions",
    subtitle: "Unit B.4",
    instructions: ["Complete all questions."],
    sections: headings.map((heading, i) => ({
      heading,
      questions: [{ prompt: `Question ${i + 1}.`, marks: 2 }],
    })),
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

/** The ten sections of the shipped B.4 packet, verbatim. */
const B4_SECTIONS = [
  "Part 0 — Warming the Engine",
  "Part 1 — How Many Terms, What Move",
  "Part 2 — The Machine Rerun: Multiplying Two Brackets",
  "Part 3 — Running It in Reverse",
  "Part 4 — Splitting the Middle: Grouping as the General Method",
  "Part 5 — One Method, Four Disguises",
  "Reflection",
  "Optional Extension",
  "B.5 Pre-Class Prep — What Happens When a Product Is Zero",
  "Teacher's Companion (tear off)",
];

describe("the progress tracker names the sections it tracks", () => {
  const svg = () => renderHeadings(B4_SECTIONS);

  it("labels the box with the section's own name, not a running count", () => {
    const text = svg();
    // "Part 0" is the give-away: a counting tracker starts at Part 1 and this
    // packet's first section is Part 0.
    expect(text).toContain("Part 0");
  });

  it("names the sections that are not called Part anything", () => {
    const text = svg();
    expect(text).toContain("Reflection");
    expect(text).toContain("Optional Extension");
    expect(text).toContain("B.5 Pre-Class Prep");
  });

  it("does not invent a Part beyond the ones that exist", () => {
    // Ten sections previously produced a "Part 10" box; the packet's highest
    // real Part is 5.
    const text = svg();
    expect(text).not.toContain("Part 10");
    expect(text).not.toContain("Part 6");
    expect(text).not.toContain("Part 7");
  });

  // The SVG carries the WHOLE document's text, so a name cannot be located by
  // slicing to a "tracker region" -- every section heading is in there too.
  // Counting occurrences is the assertion that actually discriminates: a name
  // the tracker prints appears twice (tracker + heading), one it omits
  // appears once (heading only).
  const occurrences = (haystack: string, needle: string) =>
    haystack.split(needle).length - 1;

  it("omits the Teacher's Companion, which is torn off before hand-out", () => {
    // Once, as its own section heading. A second would be a tracker box for a
    // page the student never holds.
    expect(occurrences(svg(), "Companion")).toBe(1);
  });

  it("uses the leading name only, not the full heading", () => {
    // "Part 4 - Splitting the Middle: Grouping as the General Method" is a
    // title; ten of those would not fit on the tracker line. Each of these
    // appears once, as its heading, and never in the tracker.
    const text = svg();
    expect(occurrences(text, "Splitting the Middle")).toBe(1);
    expect(occurrences(text, "One Method, Four Disguises")).toBe(1);
    expect(occurrences(text, "Warming the Engine")).toBe(1);
    // ...while the short name it DOES print appears twice: tracker + heading.
    expect(occurrences(text, "Part 0")).toBe(2);
  });
});

describe("the progress tracker survives headings it was not designed for", () => {
  it("handles a heading with no em dash by using the whole thing", () => {
    const text = renderHeadings(["Warm Up", "Reflection"]);
    expect(text).toContain("Warm Up");
  });

  it("renders when every section is a Companion and none is trackable", () => {
    // The filter can empty the list; an empty #for must not leave a dangling
    // label or fail to compile.
    expect(() => renderHeadings(["Teacher's Companion (tear off)"])).not.toThrow();
  });

  it("compiles for A.1's headings, which have the same eight-section shape", () => {
    const text = renderHeadings([
      "Part 0 — Warming the Engine",
      "Part 1 — The Anatomy of an Expression",
      "Part 2 — One Situation, Four Languages",
      "Part 3 — From Words to Symbols, and Back",
      "Part 4 — Two Expressions, One Truth",
      "Part 5 — Running the Machine Backwards",
      "Reflection",
      "Optional Extension",
    ]);
    expect(text).toContain("Part 0");
    expect(text).toContain("Reflection");
    expect(text).not.toContain("Part 8");
  });
});
