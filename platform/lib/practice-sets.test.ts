import { describe, it, expect } from "vitest";
import {
  buildPracticeSetView,
  calculatorAllowed,
  groupItemsByTier,
  isPracticeTier,
  selectQuestionImagePaths,
  summarisePracticeSet,
  TIER_ORDER,
  type PracticeItem,
  type PracticeTier,
} from "./practice-sets";

function item(overrides: Partial<PracticeItem> & { position: number; tier: PracticeTier }): PracticeItem {
  return {
    // Derived from position so each fixture item has a distinct, stable id
    // without every call site having to invent one.
    id: `item-${overrides.position}`,
    marks: 5,
    subtopics: [],
    paper: 1,
    imageUrls: [],
    questionLatex: null,
    questionCode: null,
    ...overrides,
  };
}

describe("selectQuestionImagePaths", () => {
  // The bank's per-code folders contain other questions' images and pages of
  // blank answer lines, so "everything for this code" is not servable. The
  // curated list is what the teacher verified; `available` is the only list
  // that has been filtered to image_type = 'question'.
  it("keeps the curated paths, in the curated order", () => {
    expect(
      selectQuestionImagePaths(
        ["q/question/04.png", "q/question/01.png"],
        ["q/question/01.png", "q/question/02.png", "q/question/04.png"]
      )
    ).toEqual(["q/question/04.png", "q/question/01.png"]);
  });

  it("drops a curated path that is not an available question image", () => {
    // This is the case that matters: a mark scheme path hand-typed into the
    // curated column must not survive into something that gets signed.
    expect(
      selectQuestionImagePaths(
        ["q/question/01.png", "q/markscheme/01.png"],
        ["q/question/01.png", "q/question/02.png"]
      )
    ).toEqual(["q/question/01.png"]);
  });

  it("serves a trimmed derivative stored beside the bank's own question images", () => {
    // The trimmed copies deliberately have no question_images row, so they are
    // never in `available`; they are allowed because they share the directory.
    expect(
      selectQuestionImagePaths(
        ["q/question/practice-trimmed-02.png"],
        ["q/question/01.png", "q/question/02.png"]
      )
    ).toEqual(["q/question/practice-trimmed-02.png"]);
  });

  it("does not let the directory rule reach a mark scheme or another question", () => {
    expect(
      selectQuestionImagePaths(
        [
          "q/markscheme/practice-trimmed-01.png",
          "q/markscheme/01.png",
          "other-code/question/01.png",
          "2017_past_papers_ms_paper_1_markscheme/pages/04.png",
        ],
        ["q/question/01.png"]
      )
      // Nothing matched, so this is the fall-back to every question image --
      // never any of the paths above.
    ).toEqual(["q/question/01.png"]);
  });

  it("never returns a mark scheme path even when every curated path is one", () => {
    const chosen = selectQuestionImagePaths(
      ["q/markscheme/01.png", "q/markscheme/02.png"],
      ["q/question/01.png"]
    );
    expect(chosen.some((p) => p.includes("markscheme"))).toBe(false);
  });

  it("falls back to every question image when the curated list matches nothing", () => {
    // A re-import that moves paths should degrade to some clutter, not to a
    // question that renders as an empty box.
    expect(
      selectQuestionImagePaths(["old/question/01.png"], ["q/question/01.png", "q/question/02.png"])
    ).toEqual(["q/question/01.png", "q/question/02.png"]);
  });

  it("treats an empty curated list as 'all question images'", () => {
    expect(selectQuestionImagePaths([], ["q/question/01.png"])).toEqual(["q/question/01.png"]);
  });

  it("returns nothing when the bank has no question image for the code", () => {
    expect(selectQuestionImagePaths(["q/question/01.png"], [])).toEqual([]);
    expect(selectQuestionImagePaths([], [])).toEqual([]);
  });
});

describe("groupItemsByTier", () => {
  it("orders groups basic, medium, challenging whatever order the rows arrive in", () => {
    const groups = groupItemsByTier([
      item({ position: 3, tier: "challenging" }),
      item({ position: 1, tier: "medium" }),
      item({ position: 2, tier: "basic" }),
    ]);
    expect(groups.map((g) => g.tier)).toEqual(["basic", "medium", "challenging"]);
  });

  it("keeps each tier's items in their stored order", () => {
    const groups = groupItemsByTier([
      item({ position: 1, tier: "basic" }),
      item({ position: 2, tier: "basic", marks: 9 }),
      item({ position: 3, tier: "basic", marks: 2 }),
    ]);
    // Not re-sorted by marks: a tier often opens with its gentlest question
    // on purpose, and that is the teacher's call, not the renderer's.
    expect(groups[0].items.map((i) => i.position)).toEqual([1, 2, 3]);
  });

  it("drops tiers the set does not use", () => {
    const groups = groupItemsByTier([item({ position: 1, tier: "medium" })]);
    expect(groups.map((g) => g.tier)).toEqual(["medium"]);
  });

  it("totals marks per tier", () => {
    const groups = groupItemsByTier([
      item({ position: 1, tier: "basic", marks: 5 }),
      item({ position: 2, tier: "basic", marks: 6 }),
      item({ position: 3, tier: "challenging", marks: 19 }),
    ]);
    expect(groups.map((g) => [g.tier, g.marks])).toEqual([
      ["basic", 11],
      ["challenging", 19],
    ]);
  });

  it("returns no groups for an empty set", () => {
    expect(groupItemsByTier([])).toEqual([]);
  });
});

describe("summarisePracticeSet", () => {
  it("counts questions and sums marks", () => {
    expect(
      summarisePracticeSet([
        item({ position: 1, tier: "basic", marks: 5 }),
        item({ position: 2, tier: "challenging", marks: 19 }),
      ])
    ).toEqual({ questionCount: 2, totalMarks: 24 });
  });

  it("is zero for an empty set rather than NaN", () => {
    expect(summarisePracticeSet([])).toEqual({ questionCount: 0, totalMarks: 0 });
  });
});

describe("calculatorAllowed", () => {
  it("allows the GDC on Paper 2 only", () => {
    expect(calculatorAllowed(2)).toBe(true);
    expect(calculatorAllowed(1)).toBe(false);
  });

  it("defaults to no calculator when the bank has no paper recorded", () => {
    // Failing closed is the safer default: telling a student they may use a
    // GDC when they may not practises the wrong exam.
    expect(calculatorAllowed(null)).toBe(false);
    expect(calculatorAllowed(3)).toBe(false);
  });
});

describe("isPracticeTier", () => {
  it("accepts exactly the three tiers", () => {
    for (const tier of TIER_ORDER) expect(isPracticeTier(tier)).toBe(true);
    expect(isPracticeTier("hard")).toBe(false);
    expect(isPracticeTier("")).toBe(false);
  });
});

describe("buildPracticeSetView", () => {
  const items = [
    item({ position: 1, tier: "basic", marks: 5 }),
    item({ position: 2, tier: "medium", marks: 8 }),
    item({ position: 3, tier: "challenging", marks: 19 }),
  ];

  it("carries the mark scheme gate through untouched", () => {
    expect(
      buildPracticeSetView({
        id: "s",
        name: "Integration",
        description: null,
        markschemeReleased: false,
        items,
      }).markschemeReleased
    ).toBe(false);

    expect(
      buildPracticeSetView({
        id: "s",
        name: "Integration",
        description: null,
        markschemeReleased: true,
        items,
      }).markschemeReleased
    ).toBe(true);
  });

  it("summarises and groups in one pass", () => {
    const view = buildPracticeSetView({
      id: "s",
      name: "Integration",
      description: "Thirteen questions",
      markschemeReleased: false,
      items,
    });
    expect(view.questionCount).toBe(3);
    expect(view.totalMarks).toBe(32);
    expect(view.groups.map((g) => g.tier)).toEqual(["basic", "medium", "challenging"]);
    expect(view.description).toBe("Thirteen questions");
  });

  it("builds a coherent empty view rather than throwing", () => {
    const view = buildPracticeSetView({
      id: "s",
      name: "Integration",
      description: null,
      markschemeReleased: false,
      items: [],
    });
    expect(view.groups).toEqual([]);
    expect(view.totalMarks).toBe(0);
  });
});
