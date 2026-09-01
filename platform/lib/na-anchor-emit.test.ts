import { describe, it, expect } from "vitest";
import { pairAnchorMarkers, parsePt, mmToPt, type AnchorMarkerRow } from "./na-anchor-emit";
import {
  TypstRenderService,
  getActivityTypstSource,
  buildTypstPayload,
  type ActivityPayload,
} from "./typst-render.service";
import { DEFAULT_NUANCED_ANALYSIS_TEMPLATE } from "./template-ast-defaults";

function row(qid: string, kind: "start" | "end" | "doc-end", page: number, y: number): AnchorMarkerRow {
  return { value: { qid, kind, pos: { page, x: "51.02pt", y: `${y}pt` } } };
}

describe("pairAnchorMarkers", () => {
  it("pairs start/end markers into whole-block anchors with measured-neighbour caps", () => {
    const { anchors, pageCount } = pairAnchorMarkers([
      row("Q1", "start", 1, 100),
      row("Q1", "end", 1, 250),
      row("Q2", "start", 1, 300),
      row("Q2", "end", 1, 500),
      row("Q3", "start", 2, 80),
      row("Q3", "end", 2, 400),
      row("", "doc-end", 3, 700),
    ]);
    expect(pageCount).toBe(3);
    expect(anchors).toHaveLength(3);
    const [q1, q2, q3] = anchors;
    expect(q1.pageIndex).toBe(0);
    expect(q1.y0Pt).toBe(97); // start minus 3pt pad
    expect(q1.y1Pt).toBe(253); // end plus 3pt pad
    // Q1's cap stops just above Q2's MEASURED start, never a guess.
    expect(q1.expandMaxY1Pt).toBe(q2.y0Pt - 4);
    // Last block on its page caps at the bottom content edge.
    expect(q2.expandMaxY1Pt).toBe(842 - 12);
    expect(q3.pageIndex).toBe(1);
    expect(anchors.map((a) => a.sortOrder)).toEqual([0, 1, 2]);
  });

  it("refuses a question block that broke across pages", () => {
    expect(() =>
      pairAnchorMarkers([row("Q1", "start", 1, 700), row("Q1", "end", 2, 100)])
    ).toThrow(/spans pages/);
  });

  it("refuses missing or duplicate end markers", () => {
    expect(() => pairAnchorMarkers([row("Q1", "start", 1, 100)])).toThrow(/No end marker/);
    expect(() =>
      pairAnchorMarkers([
        row("Q1", "start", 1, 100),
        row("Q1", "end", 1, 200),
        row("Q1", "end", 1, 300),
      ])
    ).toThrow(/Duplicate end/);
  });

  it("parses Typst pt strings and mm conversion", () => {
    expect(parsePt("51.02pt")).toBeCloseTo(51.02);
    expect(mmToPt(25.4)).toBeCloseTo(72);
    expect(() => parsePt("abc")).toThrow();
  });
});

// -- Compile round-trip against the real embedded template --------------------

const SAMPLE: ActivityPayload = {
  template: DEFAULT_NUANCED_ANALYSIS_TEMPLATE,
  content: {
    title: "Anchor Emission Test",
    course: "Test 9",
    sections: [
      {
        id: "s1",
        heading: "Part 1",
        partNumber: 1,
        questions: [
          {
            id: "q1",
            globalNumber: 1,
            marks: 3,
            estimatedMinutes: 3,
            tier: 1,
            prompt: "State whether $2x + 1$ is an expression.",
            answerBox: { kind: "lined", heightMm: 40, lineSpacingMm: 7, continuation: { enabled: false, label: "" } },
          },
          {
            id: "q2",
            globalNumber: 2,
            marks: 5,
            estimatedMinutes: 5,
            tier: 2,
            prompt: "Determine every whole number that works.",
            answerBox: { kind: "lined", heightMm: 120, lineSpacingMm: 7, continuation: { enabled: false, label: "" } },
          },
        ],
      },
    ],
  },
  metadata: { versionLabel: "TEST v1" },
};

describe("TypstRenderService anchor emission (compile round-trip)", () => {
  it("emits one whole-block anchor per question with sane geometry", async () => {
    const result = await TypstRenderService.render(SAMPLE);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
    expect(result.anchors).toBeDefined();
    const anchors = result.anchors!;
    expect(anchors.map((a) => a.qid)).toEqual(["Q1", "Q2"]);
    for (const a of anchors) {
      expect(a.y1Pt).toBeGreaterThan(a.y0Pt);
      expect(a.x1Pt).toBeGreaterThan(a.x0Pt);
      expect(a.expandMaxY1Pt).toBeGreaterThanOrEqual(a.y1Pt);
      expect(a.pageIndex).toBeGreaterThanOrEqual(0);
    }
    // The block spans prompt AND box: Q2's 120mm box alone is ~340pt tall.
    const q2 = anchors[1];
    expect(q2.y1Pt - q2.y0Pt).toBeGreaterThan(mmToPt(120));
  });

  it("markers are layout-neutral: stripping them leaves the PDF byte-identical", async () => {
    const src = getActivityTypstSource();
    const stripped = src
      .split("\n")
      .filter((line) => !line.includes("<na-anchor>"))
      .join("\n");
    expect(stripped).not.toBe(src);

    const mod = await import("@myriaddreamin/typst-ts-node-compiler");
    const compiler = mod.NodeCompiler.create();
    const payloadJson = JSON.stringify(buildTypstPayload(SAMPLE));
    const withMarkers = compiler.pdf({ mainFileContent: src, inputs: { payload: payloadJson } });
    const withoutMarkers = compiler.pdf({ mainFileContent: stripped, inputs: { payload: payloadJson } });
    expect(Buffer.compare(withMarkers, withoutMarkers)).toBe(0);
  });
});
