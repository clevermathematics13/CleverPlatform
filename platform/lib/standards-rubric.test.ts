import { describe, expect, it } from "vitest";
import {
  DEFAULT_LEVEL_BANDS,
  StandardsRubricSchema,
  buildStandardsReport,
  buildStandardsReportCsv,
  checkRubricAgainstItems,
  levelForMarks,
  levelRanges,
  levelThresholds,
  minMarksForBand,
  normalisePartRef,
  parsePartRef,
  parseStandardsRubric,
  partRefForItem,
  partRefLabel,
  strandForItem,
  type RubricItem,
  type StandardsRubric,
} from "./standards-rubric";
import {
  KA1_UNIT1_ITEMS,
  KA1_UNIT1_RUBRIC,
  KA1_UNIT1_TOTAL_MARKS,
} from "./fixtures/g9-standard-ka1-unit1";

/** The fixture's parts as test_items rows, with ids the report can be keyed on. */
const KA1_ITEMS: RubricItem[] = KA1_UNIT1_ITEMS.map((it) => ({
  id: `item-${it.questionNumber}${it.partLabel}`,
  question_number: it.questionNumber,
  part_label: it.partLabel,
  max_marks: it.maxMarks,
}));

const itemId = (ref: string) => `item-${ref}`;

describe("part references", () => {
  it("normalises brackets, spaces and case away", () => {
    expect(normalisePartRef("2(d)")).toBe("2d");
    expect(normalisePartRef("2 D")).toBe("2d");
    expect(normalisePartRef("3b(ii)")).toBe("3bii");
    expect(normalisePartRef("5")).toBe("5");
  });

  it("matches a test_items row by question number and part label", () => {
    expect(partRefForItem({ question_number: 2, part_label: "d" })).toBe("2d");
    expect(partRefForItem({ question_number: 5, part_label: "" })).toBe("5");
    expect(partRefForItem({ question_number: 5, part_label: null })).toBe("5");
    expect(partRefForItem({ question_number: 3, part_label: "(b)(ii)" })).toBe("3bii");
  });

  it("splits a ref into the two columns", () => {
    expect(parsePartRef("2d")).toEqual({ questionNumber: 2, partLabel: "d" });
    expect(parsePartRef("5")).toEqual({ questionNumber: 5, partLabel: "" });
    expect(parsePartRef("12(a)")).toEqual({ questionNumber: 12, partLabel: "a" });
    expect(parsePartRef("Q2")).toBeNull();
    expect(parsePartRef("")).toBeNull();
  });

  it("labels a ref the way the review UI does", () => {
    expect(partRefLabel("2d")).toBe("Q2(d)");
    expect(partRefLabel("5")).toBe("Q5");
  });
});

describe("level bands", () => {
  it("reproduces every threshold printed on the KA1 rubric", () => {
    // Strand A, 11 marks: 10-11 / 8-9 / 5-7 / 0-4
    expect(levelThresholds(11, DEFAULT_LEVEL_BANDS)).toEqual({ exceeding: 10, meeting: 8, approaching: 5 });
    // Strand B, 13 marks: 12-13 / 9-11 / 6-8 / 0-5
    expect(levelThresholds(13, DEFAULT_LEVEL_BANDS)).toEqual({ exceeding: 12, meeting: 9, approaching: 6 });
    // Strands C and D, 9 marks: 8-9 / 6-7 / 4-5 / 0-3
    expect(levelThresholds(9, DEFAULT_LEVEL_BANDS)).toEqual({ exceeding: 8, meeting: 6, approaching: 4 });
    // Overall, 42 marks: 36-42 / 28-35 / 17-27 / 0-16
    expect(levelThresholds(42, DEFAULT_LEVEL_BANDS)).toEqual({ exceeding: 36, meeting: 28, approaching: 17 });
  });

  it("prints the ranges the rubric prints", () => {
    expect(levelRanges(11, DEFAULT_LEVEL_BANDS)).toEqual({
      exceeding: "10-11",
      meeting: "8-9",
      approaching: "5-7",
      beginning: "0-4",
    });
    expect(levelRanges(42, DEFAULT_LEVEL_BANDS)).toEqual({
      exceeding: "36-42",
      meeting: "28-35",
      approaching: "17-27",
      beginning: "0-16",
    });
  });

  it("ceils rather than rounds, and survives floating point", () => {
    expect(minMarksForBand(0.85, 11)).toBe(10); // 9.35 -> 10, not 9
    expect(minMarksForBand(0.4, 10)).toBe(4); // 4.000000000000001 must not become 5
    expect(minMarksForBand(0.65, 20)).toBe(13);
    expect(minMarksForBand(0.85, 0)).toBe(0);
  });

  it("places marks at the boundaries on the right side", () => {
    expect(levelForMarks(10, 11, DEFAULT_LEVEL_BANDS)).toBe("exceeding");
    expect(levelForMarks(9, 11, DEFAULT_LEVEL_BANDS)).toBe("meeting");
    expect(levelForMarks(8, 11, DEFAULT_LEVEL_BANDS)).toBe("meeting");
    expect(levelForMarks(7, 11, DEFAULT_LEVEL_BANDS)).toBe("approaching");
    expect(levelForMarks(5, 11, DEFAULT_LEVEL_BANDS)).toBe("approaching");
    expect(levelForMarks(4, 11, DEFAULT_LEVEL_BANDS)).toBe("beginning");
    expect(levelForMarks(0, 11, DEFAULT_LEVEL_BANDS)).toBe("beginning");
    expect(levelForMarks(3, 0, DEFAULT_LEVEL_BANDS)).toBeNull();
  });

  it("a one-mark strand is exceeding at 1 and beginning at 0", () => {
    expect(levelThresholds(1, DEFAULT_LEVEL_BANDS)).toEqual({ exceeding: 1, meeting: 1, approaching: 1 });
    expect(levelForMarks(1, 1, DEFAULT_LEVEL_BANDS)).toBe("exceeding");
    expect(levelForMarks(0, 1, DEFAULT_LEVEL_BANDS)).toBe("beginning");
    expect(levelRanges(1, DEFAULT_LEVEL_BANDS)).toEqual({
      exceeding: "1",
      meeting: "-",
      approaching: "-",
      beginning: "0",
    });
  });
});

describe("the KA1 Unit 1 fixture", () => {
  it("is a valid rubric", () => {
    expect(StandardsRubricSchema.safeParse(KA1_UNIT1_RUBRIC).success).toBe(true);
  });

  it("has 26 parts worth 42 marks", () => {
    expect(KA1_UNIT1_ITEMS).toHaveLength(26);
    expect(KA1_UNIT1_ITEMS.reduce((s, i) => s + i.maxMarks, 0)).toBe(KA1_UNIT1_TOTAL_MARKS);
  });

  it("covers every part exactly once, with the strand totals the rubric prints", () => {
    expect(checkRubricAgainstItems(KA1_UNIT1_RUBRIC, KA1_ITEMS)).toEqual([]);
    const report = buildStandardsReport(KA1_UNIT1_RUBRIC, KA1_ITEMS, new Map());
    expect(report.strands.map((s) => [s.code, s.max])).toEqual([
      ["A", 11],
      ["B", 13],
      ["C", 9],
      ["D", 9],
    ]);
    expect(report.overall.max).toBe(42);
  });

  it("every part has a question and a mark scheme", () => {
    for (const item of KA1_UNIT1_ITEMS) {
      expect(item.questionText.trim().length, `${item.questionNumber}${item.partLabel}`).toBeGreaterThan(20);
      expect(item.markschemeText.trim().length, `${item.questionNumber}${item.partLabel}`).toBeGreaterThan(20);
    }
  });

  it("uses no Unicode box-drawing characters anywhere (Turbopack rule)", () => {
    const text = JSON.stringify(KA1_UNIT1_ITEMS) + JSON.stringify(KA1_UNIT1_RUBRIC);
    expect(new RegExp("[\\u2500-\\u257F]").test(text)).toBe(false);
  });
});

describe("rubric schema", () => {
  const base = (): StandardsRubric => JSON.parse(JSON.stringify(KA1_UNIT1_RUBRIC));

  it("rejects a part listed in two strands", () => {
    const r = base();
    r.strands[1].parts.push("1a");
    const parsed = StandardsRubricSchema.safeParse(r);
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain("exactly one strand");
  });

  it("rejects duplicate strand codes, case-insensitively", () => {
    const r = base();
    r.strands[1].code = "a";
    expect(StandardsRubricSchema.safeParse(r).success).toBe(false);
  });

  it("rejects bands that do not descend", () => {
    const r = base();
    r.bands = { exceeding: 0.6, meeting: 0.65, approaching: 0.4 };
    expect(StandardsRubricSchema.safeParse(r).success).toBe(false);
  });

  it("rejects a part ref that is not a part", () => {
    const r = base();
    r.strands[0].parts.push("Question 3");
    expect(StandardsRubricSchema.safeParse(r).success).toBe(false);
  });

  it("rejects a strand citing a standard code from a domain that does not exist", () => {
    const r = base();
    r.strands[0].standards.push("Z-FAKE.A.1 Not a real standard.");
    const parsed = StandardsRubricSchema.safeParse(r);
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain("Strand A:");
  });

  it("rejects a Grade 9 standard code -- CCSS has no grade-9-specific domains", () => {
    const r = base();
    r.strands[0].standards.push("9.EE.A.1 Made up.");
    expect(StandardsRubricSchema.safeParse(r).success).toBe(false);
  });

  it("accepts the fixture's real standards[] entries unchanged", () => {
    expect(StandardsRubricSchema.safeParse(base()).success).toBe(true);
  });

  it("parseStandardsRubric treats null as no rubric and reports bad input", () => {
    expect(parseStandardsRubric(null)).toEqual({ ok: true, rubric: null });
    expect(parseStandardsRubric(undefined)).toEqual({ ok: true, rubric: null });
    const bad = parseStandardsRubric({ version: 2 });
    expect(bad.ok).toBe(false);
    const good = parseStandardsRubric(KA1_UNIT1_RUBRIC);
    expect(good.ok && good.rubric?.strands.length).toBe(4);
  });
});

describe("checkRubricAgainstItems", () => {
  it("blocks on a part the test does not have", () => {
    const r: StandardsRubric = JSON.parse(JSON.stringify(KA1_UNIT1_RUBRIC));
    r.strands[0].parts.push("10a");
    const findings = checkRubricAgainstItems(r, KA1_ITEMS);
    expect(findings).toEqual([
      { severity: "block", message: "Strand A lists Q10(a), which is not a part of this test" },
    ]);
  });

  it("warns on a test part outside every strand", () => {
    const items = [...KA1_ITEMS, { id: "item-bonus", question_number: 10, part_label: "", max_marks: 2 }];
    const findings = checkRubricAgainstItems(KA1_UNIT1_RUBRIC, items);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warn");
    expect(findings[0].message).toContain("Q10 (2 marks) is in no strand");
  });

  it("matches refs written with brackets against bare labels", () => {
    const r: StandardsRubric = JSON.parse(JSON.stringify(KA1_UNIT1_RUBRIC));
    r.strands[3].parts = ["2(d)", "6 (d)", "7D", "9c"];
    expect(checkRubricAgainstItems(r, KA1_ITEMS)).toEqual([]);
  });
});

describe("strandForItem", () => {
  it("finds the strand a part feeds", () => {
    expect(strandForItem(KA1_UNIT1_RUBRIC, { question_number: 8, part_label: "" })?.code).toBe("A");
    expect(strandForItem(KA1_UNIT1_RUBRIC, { question_number: 9, part_label: "b" })?.code).toBe("B");
    expect(strandForItem(KA1_UNIT1_RUBRIC, { question_number: 9, part_label: "c" })?.code).toBe("D");
    expect(strandForItem(KA1_UNIT1_RUBRIC, { question_number: 10, part_label: "" })).toBeNull();
  });
});

describe("buildStandardsReport", () => {
  it("bands a fully marked paper, strand by strand and overall", () => {
    // Full marks everywhere except: 8 -> 3/5 (A = 9, Meeting), 5 -> 2/4 and
    // 2b -> 1/2 (B = 10, Meeting), 6d -> 1/3 and 9c -> 1/2 (D = 6, Meeting).
    const marks = new Map<string, number>();
    for (const it of KA1_UNIT1_ITEMS) marks.set(itemId(`${it.questionNumber}${it.partLabel}`), it.maxMarks);
    marks.set(itemId("8"), 3);
    marks.set(itemId("5"), 2);
    marks.set(itemId("2b"), 1);
    marks.set(itemId("6d"), 1);
    marks.set(itemId("9c"), 1);

    const report = buildStandardsReport(KA1_UNIT1_RUBRIC, KA1_ITEMS, marks);
    expect(report.complete).toBe(true);
    expect(report.strands.map((s) => [s.code, s.marks, s.max, s.level])).toEqual([
      ["A", 9, 11, "meeting"],
      ["B", 10, 13, "meeting"],
      ["C", 9, 9, "exceeding"],
      ["D", 6, 9, "meeting"],
    ]);
    expect(report.overall).toMatchObject({ marks: 34, max: 42, level: "meeting", markedParts: 26, totalParts: 26 });
  });

  it("gives null levels for a student with no marks, and provisional ones for a half-marked paper", () => {
    const empty = buildStandardsReport(KA1_UNIT1_RUBRIC, KA1_ITEMS, {});
    expect(empty.complete).toBe(false);
    expect(empty.strands.every((s) => s.level === null && s.markedParts === 0)).toBe(true);
    expect(empty.overall.level).toBeNull();

    const partial = buildStandardsReport(KA1_UNIT1_RUBRIC, KA1_ITEMS, { [itemId("1a")]: 1, [itemId("1b")]: 1 });
    expect(partial.complete).toBe(false);
    const a = partial.strands[0];
    expect(a).toMatchObject({ code: "A", marks: 2, max: 11, level: "beginning", markedParts: 2, totalParts: 7 });
    expect(partial.strands[1].level).toBeNull();
  });

  it("ignores null and non-numeric marks rather than counting them as zero", () => {
    const report = buildStandardsReport(KA1_UNIT1_RUBRIC, KA1_ITEMS, {
      [itemId("1a")]: 1,
      [itemId("1b")]: null,
      [itemId("1c")]: undefined,
    });
    expect(report.strands[0]).toMatchObject({ marks: 1, markedParts: 1 });
  });

  it("counts a part outside every strand in the overall total only", () => {
    const items = [...KA1_ITEMS, { id: "item-bonus", question_number: 10, part_label: "", max_marks: 2 }];
    const marks: Record<string, number> = { "item-bonus": 2 };
    for (const it of KA1_UNIT1_ITEMS) marks[itemId(`${it.questionNumber}${it.partLabel}`)] = 0;
    const report = buildStandardsReport(KA1_UNIT1_RUBRIC, items, marks);
    expect(report.overall).toMatchObject({ marks: 2, max: 44 });
    expect(report.strands.reduce((s, x) => s + x.max, 0)).toBe(42);
  });
});

describe("buildStandardsReportCsv", () => {
  it("writes one row per student with marks and level per strand", () => {
    const full = new Map<string, number>();
    for (const it of KA1_UNIT1_ITEMS) full.set(itemId(`${it.questionNumber}${it.partLabel}`), it.maxMarks);
    const csv = buildStandardsReportCsv(KA1_UNIT1_RUBRIC, [
      { name: "Ada Lovelace", className: "9D", report: buildStandardsReport(KA1_UNIT1_RUBRIC, KA1_ITEMS, full), absent: false },
      { name: "Absent, Student", className: "9D", report: null, absent: true },
      { name: "Nobody Marked", className: null, report: buildStandardsReport(KA1_UNIT1_RUBRIC, KA1_ITEMS, {}), absent: false },
    ]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Student,Class,A marks,A level,B marks,B level,C marks,C level,D marks,D level,Total,Overall level");
    expect(lines[1]).toBe("Ada Lovelace,9D,11/11,E,13/13,E,9/9,E,9/9,E,42/42,E");
    expect(lines[2]).toBe('"Absent, Student",9D,ABS,ABS,ABS,ABS,ABS,ABS,ABS,ABS,ABS,ABS');
    expect(lines[3]).toBe("Nobody Marked,,,,,,,,,,,");
    expect(lines[4]).toBe("");
  });
});
