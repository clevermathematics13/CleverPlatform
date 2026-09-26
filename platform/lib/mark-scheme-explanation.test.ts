import { describe, it, expect } from "vitest";
import {
  MarkSchemeExplanationSchema,
  canExplain,
  checkExplanation,
  currentExplanations,
  explanationPartSources,
  explanationSourceHash,
  explanationState,
  parseStoredExplanation,
  type ExplanationDiagram,
  type MarkSchemeExplanation,
  type StoredExplanation,
} from "./mark-scheme-explanation";
import { EXPLANATION_EXAMPLE } from "./mark-scheme-explanation-prompt";
import { EXPLANATION_FIXTURES } from "./fixtures/mark-scheme-explanations";

function withStep(diagram: ExplanationDiagram | null, base: MarkSchemeExplanation = EXPLANATION_EXAMPLE): MarkSchemeExplanation {
  return {
    ...base,
    steps: [{ ...base.steps[0], diagram }, ...base.steps.slice(1)],
  };
}

describe("checkExplanation", () => {
  it("passes the prompt's own worked example -- an example that failed would teach failing", () => {
    expect(MarkSchemeExplanationSchema.safeParse(EXPLANATION_EXAMPLE).success).toBe(true);
    expect(checkExplanation(EXPLANATION_EXAMPLE, 3)).toEqual([]);
  });

  it("insists how the marks work adds up to the part, since students count their marks from it", () => {
    const problems = checkExplanation(EXPLANATION_EXAMPLE, 4);
    expect(problems.join(" ")).toMatch(/adds up to 3 marks, but this part is worth 4/);
  });

  it("refuses maths KaTeX cannot typeset, and a stray dollar", () => {
    const broken = { ...EXPLANATION_EXAMPLE, answer: "$\\frac{1}{2$" };
    expect(checkExplanation(broken, 3).join(" ")).toMatch(/KaTeX cannot typeset/);
    const stray = { ...EXPLANATION_EXAMPLE, watch: ["It costs $5 each"] };
    expect(checkExplanation(stray, 3).join(" ")).toMatch(/does not open or close maths/);
    const price = { ...EXPLANATION_EXAMPLE, watch: ["It costs \\$5 each, so $5n$ in all."] };
    expect(checkExplanation(price, 3)).toEqual([]);
  });

  it("accepts the highlight colours and the maths a worked step needs", () => {
    const rich = {
      ...EXPLANATION_EXAMPLE,
      answer: "$\\underbrace{-9k^{2}}_{\\text{term}} + \\cancel{5k} \\neq \\boxed{\\blue{x}} \\orange{1} \\green{2} \\pink{3}$",
    };
    expect(checkExplanation(rich, 3)).toEqual([]);
  });

  it("refuses marking codes in what a student reads, but not a letter and digit inside maths", () => {
    const coded = { ...EXPLANATION_EXAMPLE, marks: [{ marks: 3, text: "M1A1R1 for the working" }] };
    expect(checkExplanation(coded, 3).join(" ")).toMatch(/marking code/);
    const matrix = { ...EXPLANATION_EXAMPLE, marks: [{ marks: 3, text: "Find $A1$ and $B2$ in the grid" }] };
    expect(checkExplanation(matrix, 3)).toEqual([]);
  });

  it("refuses any mention of how it was written", () => {
    for (const phrase of ["This was written by AI.", "Claude says so.", "A language model wrote this."]) {
      const leaked = { ...EXPLANATION_EXAMPLE, watch: [phrase] };
      expect(checkExplanation(leaked, 3).join(" ")).toMatch(/Students must never see that/);
    }
  });

  it("holds the number of steps and the lengths to what a student can take in", () => {
    const oneStep = { ...EXPLANATION_EXAMPLE, steps: EXPLANATION_EXAMPLE.steps.slice(0, 1) };
    expect(checkExplanation(oneStep, 3).join(" ")).toMatch(/steps/);
    const long = { ...EXPLANATION_EXAMPLE, answer: "a".repeat(400) };
    expect(checkExplanation(long, 3).join(" ")).toMatch(/keep it under 300/);
  });

  describe("diagrams", () => {
    it("checks an area model's grid against its headings", () => {
      const ok: ExplanationDiagram = {
        kind: "area_model",
        rowHeads: ["5", "-x"],
        colHeads: ["x", "-3"],
        cells: [["5x", "-15"], ["-x^{2}", "3x"]],
        caption: "A grid multiplying (5 - x) by (x - 3).",
      };
      expect(checkExplanation(withStep(ok), 3)).toEqual([]);
      const ragged = { ...ok, cells: [["5x", "-15"], ["-x^{2}"]] };
      expect(checkExplanation(withStep(ragged), 3).join(" ")).toMatch(/one cell for each/);
    });

    it("keeps a number line's marks on the line", () => {
      const line: ExplanationDiagram = {
        kind: "number_line",
        min: 0,
        max: 10,
        step: 1,
        points: [{ value: 3, label: "3", open: true }],
        jumps: [{ from: 4, to: 8, label: "+4" }],
        ranges: [{ from: 5, to: null, includeFrom: false, includeTo: false }],
        caption: "A number line from 0 to 10.",
      };
      expect(checkExplanation(withStep(line), 3)).toEqual([]);
      const off = { ...line, points: [{ value: 12, label: "12", open: false }] };
      expect(checkExplanation(withStep(off), 3).join(" ")).toMatch(/outside 0 to 10/);
      const dense = { ...line, step: 0.1 };
      expect(checkExplanation(withStep(dense), 3).join(" ")).toMatch(/tick marks/);
    });

    it("refuses a graph whose curve cannot be read, rather than drawing nothing", () => {
      const graph: ExplanationDiagram = {
        kind: "graph",
        xMin: -5,
        xMax: 5,
        yMin: -5,
        yMax: 10,
        curves: [{ expr: "x^2 - 4", label: "y = x^2 - 4" }],
        points: [{ x: 2, y: 0, label: "(2, 0)", open: false }],
        caption: "The parabola y = x squared minus 4 crossing the x-axis at 2 and -2.",
      };
      expect(checkExplanation(withStep(graph), 3)).toEqual([]);
      const unreadable = { ...graph, curves: [{ expr: "Math.random()", label: "" }] };
      expect(checkExplanation(withStep(unreadable), 3).join(" ")).toMatch(/cannot be read/);
    });

    it("needs one jump between each pair of terms in a sequence", () => {
      const seq: ExplanationDiagram = {
        kind: "sequence",
        terms: ["88", "82", "76"],
        jumps: ["-6", "-6"],
        caption: "The sequence goes down by 6 each time.",
      };
      expect(checkExplanation(withStep(seq), 3)).toEqual([]);
      const short = { ...seq, jumps: ["-6"] };
      expect(checkExplanation(withStep(short), 3).join(" ")).toMatch(/one jump between each pair/);
    });

    it("refuses LaTeX-only fields that carry dollar signs", () => {
      const working: ExplanationDiagram = {
        kind: "working",
        lines: [
          { math: "$7x = 70$", note: "" },
          { math: "x = 10", note: "divide both sides by $7$" },
        ],
        caption: "Two lines of working.",
      };
      expect(checkExplanation(withStep(working), 3).join(" ")).toMatch(/must not contain dollar signs/);
    });

    it("refuses two tiles in one place", () => {
      const tiles: ExplanationDiagram = {
        kind: "tiles",
        figures: [
          {
            label: "Figure 1",
            tiles: [
              { row: 0, col: 0, isNew: false },
              { row: 0, col: 0, isNew: true },
            ],
          },
        ],
        caption: "One figure.",
      };
      expect(checkExplanation(withStep(tiles), 3).join(" ")).toMatch(/two tiles in the same place/);
    });
  });
});

describe("explanationPartSources", () => {
  const sections = [
    {
      heading: "LEVEL 3",
      questions: [
        {
          prompt: "Consider the equation $\\frac{w + 1}{w - 3} + 4 = \\frac{2w + 7}{w - 3}$.",
          subparts: [
            { prompt: "State the undefined value.", marks: 1, answer: "$w = 3$", markScheme: "A1 for w = 3." },
            { prompt: "Solve the equation.", marks: 3, answer: "$w = 6$", markScheme: "M1 M1 A1." },
          ],
        },
        { prompt: "Expand $(5 - x)(x - 3)$.", marks: 2, answer: "$-x^2 + 8x - 15$", markScheme: "M1 A1." },
      ],
    },
  ];
  const items = [
    { id: "i0", question_number: 1, part_label: "a", max_marks: 1, sort_order: 0, markscheme_text: "A1 for w = 3." },
    { id: "i1", question_number: 1, part_label: "b", max_marks: 3, sort_order: 1, markscheme_text: "M1 M1 A1." },
    { id: "i2", question_number: 2, part_label: "", max_marks: 2, sort_order: 2, markscheme_text: "M1 A1." },
  ];

  it("reads a creator paper's parts from its draft, with the stem and the paper's own labels", () => {
    const sources = explanationPartSources({ sections }, items);
    expect(sources.map((s) => s.label)).toEqual(["1.1(a)", "1.1(b)", "1.2"]);
    expect(sources[1]).toMatchObject({
      key: "1|b",
      stem: sections[0].questions[0].prompt,
      prompt: "Solve the equation.",
      answer: "$w = 6$",
      maxMarks: 3,
      sectionHeading: "LEVEL 3",
    });
    expect(sources[2].stem).toBe("");
  });

  it("reads a paper with no draft from its items", () => {
    const sources = explanationPartSources(null, [
      { id: "x", question_number: 7, part_label: "c", max_marks: 1, sort_order: 0, stem_text: "84 students.", question_text: "Write an expression.", markscheme_text: "A full-mark response writes $(84 - x) \\div 5$." },
    ]);
    expect(sources[0]).toMatchObject({ label: "7(c)", stem: "84 students.", prompt: "Write an expression.", answer: "", key: "7|c" });
    expect(canExplain(sources[0])).toBe(true);
    expect(canExplain({ ...sources[0], markScheme: "  " })).toBe(false);
  });

  it("hashes what an explanation is written from, and nothing about where the part sits", () => {
    const [a] = explanationPartSources({ sections }, items);
    const moved = { ...a, itemId: "new-id", sortOrder: 9, label: "9.9" };
    expect(explanationSourceHash(a)).toBe(explanationSourceHash(moved));
    expect(explanationSourceHash(a)).not.toBe(explanationSourceHash({ ...a, markScheme: "A1 for w = 3 only." }));
    expect(explanationSourceHash(a)).not.toBe(explanationSourceHash({ ...a, maxMarks: 2 }));
  });

  it("shows a stored explanation only while it still matches the part", () => {
    const sources = explanationPartSources({ sections }, items);
    const row = (hash: string, content: MarkSchemeExplanation | null = EXPLANATION_EXAMPLE): StoredExplanation => ({
      key: sources[0].key,
      sourceHash: hash,
      content,
      model: "m",
      promptVersion: 1,
      updatedAt: "",
    });
    expect(explanationState(sources[0], undefined)).toBe("missing");
    expect(explanationState(sources[0], row("stale"))).toBe("outdated");
    expect(explanationState(sources[0], row(explanationSourceHash(sources[0]), null))).toBe("missing");
    expect(explanationState(sources[0], row(explanationSourceHash(sources[0])))).toBe("current");

    const current = currentExplanations(sources, new Map([[sources[0].key, row(explanationSourceHash(sources[0]))]]));
    expect([...current.keys()]).toEqual(["i0"]);
  });
});

describe("parseStoredExplanation", () => {
  it("reads a well-formed row and refuses anything else", () => {
    expect(parseStoredExplanation(EXPLANATION_EXAMPLE)).toEqual(EXPLANATION_EXAMPLE);
    expect(parseStoredExplanation({ answer: "x" })).toBeNull();
    expect(parseStoredExplanation(null)).toBeNull();
  });
});

describe("realistic explanations", () => {
  it.each(EXPLANATION_FIXTURES.map((f) => [f.label, f] as const))("%s passes every check", (_label, fixture) => {
    expect(MarkSchemeExplanationSchema.safeParse(fixture.explanation).success).toBe(true);
    expect(checkExplanation(fixture.explanation, fixture.maxMarks)).toEqual([]);
  });

  it("between them use every kind of diagram, so each kind's checks run on real content", () => {
    const kinds = new Set(EXPLANATION_FIXTURES.flatMap((f) => f.explanation.steps.flatMap((s) => (s.diagram ? [s.diagram.kind] : []))));
    expect([...kinds].sort()).toEqual(["area_model", "bar_model", "graph", "number_line", "sequence", "table", "tiles", "working"]);
  });
});
