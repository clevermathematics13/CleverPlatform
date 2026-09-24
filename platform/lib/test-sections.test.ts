import { describe, it, expect } from "vitest";
import {
  IB_SECTIONS,
  inSection,
  paperSections,
  sectionsFromCustomContent,
  shortSectionLabel,
} from "./test-sections";
import { KA1_UNIT1_ITEMS, KA1_UNIT1_RUBRIC, KA1_UNIT1_TOTAL_MARKS } from "./fixtures/g9-standard-ka1-unit1";

/**
 * Grade 9 Extended Key Assessment 1 as authored: four LEVEL sections holding
 * 4, 3, 3 and 4 questions (36 parts, 50 marks). Only the shape matters here.
 */
const KA1_EXTENDED_CONTENT = {
  sections: [
    { heading: "LEVEL 1 -- READ THE STRUCTURE", questions: [{}, {}, {}, {}] },
    { heading: "LEVEL 2 -- TRANSLATE AND INTERPRET", questions: [{}, {}, {}] },
    { heading: "LEVEL 3 -- SOLVE AND REARRANGE", questions: [{}, {}, {}] },
    { heading: "LEVEL 4 -- PROVE, CRITIQUE AND MODEL", questions: [{}, {}, {}, {}] },
  ],
};

describe("section ranges", () => {
  it("labels LEVEL headings L1..L4 and gives each a contiguous run of questions", () => {
    expect(sectionsFromCustomContent(KA1_EXTENDED_CONTENT)).toEqual([
      { label: "L1", title: "LEVEL 1 -- READ THE STRUCTURE", fromQ: 1, toQ: 4 },
      { label: "L2", title: "LEVEL 2 -- TRANSLATE AND INTERPRET", fromQ: 5, toQ: 7 },
      { label: "L3", title: "LEVEL 3 -- SOLVE AND REARRANGE", fromQ: 8, toQ: 10 },
      { label: "L4", title: "LEVEL 4 -- PROVE, CRITIQUE AND MODEL", fromQ: 11, toQ: 14 },
    ]);
  });

  it("skips a section with no questions without consuming question numbers", () => {
    const out = sectionsFromCustomContent({
      sections: [
        { heading: "LEVEL 1", questions: [{}] },
        { heading: "LEVEL 2", questions: [] },
        { heading: "LEVEL 3", questions: [{}, {}] },
      ],
    });
    expect(out?.map((s) => [s.label, s.fromQ, s.toQ])).toEqual([
      ["L1", 1, 1],
      ["L3", 2, 3],
    ]);
  });

  it("is null for a paper with no authored sections", () => {
    expect(sectionsFromCustomContent(null)).toBeNull();
    expect(sectionsFromCustomContent({ sections: [] })).toBeNull();
  });

  it("shortens other headings to a word or a number", () => {
    expect(shortSectionLabel("Warm up", 0)).toBe("Warm");
    expect(shortSectionLabel("Extraordinarily long", 2)).toBe("S3");
  });

  it("keeps the IB split open-ended", () => {
    expect(inSection(8, IB_SECTIONS[0])).toBe(true);
    expect(inSection(9, IB_SECTIONS[0])).toBe(false);
    expect(inSection(40, IB_SECTIONS[1])).toBe(true);
  });
});

describe("paperSections", () => {
  it("places every part of a creator paper under its LEVEL heading", () => {
    const items = [
      { id: "a", question_number: 1, part_label: "a", max_marks: 1 },
      { id: "b", question_number: 4, part_label: "", max_marks: 2 },
      { id: "c", question_number: 10, part_label: "c", max_marks: 1 },
      { id: "d", question_number: 14, part_label: "b", max_marks: 1 },
    ];
    const out = paperSections({ customContent: KA1_EXTENDED_CONTENT, standardsRubric: null, items });
    expect(out.sections.map((s) => [s.label, s.maxMarks])).toEqual([
      ["L1", 3],
      ["L3", 1],
      ["L4", 1],
    ]);
    expect(out.sectionIndexByItemId.get("b")).toBe(0);
    expect(out.sectionIndexByItemId.get("c")).toBe(1);
    expect(out.sectionIndexByItemId.get("d")).toBe(2);
  });

  it("falls back to Section A / Section B for a paper with no structure of its own", () => {
    const items = [
      { id: "q1", question_number: 1, part_label: "", max_marks: 5 },
      { id: "q9", question_number: 9, part_label: "a", max_marks: 7 },
    ];
    const out = paperSections({ customContent: null, standardsRubric: null, items });
    expect(out.sections.map((s) => s.label)).toEqual(["Sec A", "Sec B"]);
    expect(out.sectionIndexByItemId.get("q9")).toBe(1);
  });

  it("groups a Standard paper by strand, and every part lands in exactly one", () => {
    const items = KA1_UNIT1_ITEMS.map((it) => ({
      id: `item-${it.questionNumber}${it.partLabel}`,
      question_number: it.questionNumber,
      part_label: it.partLabel,
      max_marks: it.maxMarks,
    }));
    const out = paperSections({ customContent: null, standardsRubric: KA1_UNIT1_RUBRIC, items });
    expect(out.sections.map((s) => s.label)).toEqual(KA1_UNIT1_RUBRIC.strands.map((s) => s.code));
    expect(out.sections.reduce((sum, s) => sum + s.maxMarks, 0)).toBe(KA1_UNIT1_TOTAL_MARKS);
    expect(out.sectionIndexByItemId.size).toBe(items.length);
  });

  it("puts a Standard part that is in no strand under Other", () => {
    const items = [
      ...KA1_UNIT1_ITEMS.map((it) => ({
        id: `item-${it.questionNumber}${it.partLabel}`,
        question_number: it.questionNumber,
        part_label: it.partLabel,
        max_marks: it.maxMarks,
      })),
      { id: "bonus", question_number: 99, part_label: "", max_marks: 2 },
    ];
    const out = paperSections({ customContent: null, standardsRubric: KA1_UNIT1_RUBRIC, items });
    const other = out.sections.length - 1;
    expect(out.sections[other]).toEqual({ label: "Other", title: "Parts in no strand", maxMarks: 2 });
    expect(out.sectionIndexByItemId.get("bonus")).toBe(other);
  });
});
