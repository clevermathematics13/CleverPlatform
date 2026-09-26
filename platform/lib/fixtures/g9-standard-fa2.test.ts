import { describe, expect, it } from "vitest";
import {
  G9_FORMATIVE_ASSESSMENT_MARKING_PRINCIPLES,
  G9_STANDARD_LEVEL_MARKING_PRINCIPLES,
  buildGradingSystemPrompt,
  buildGradingUserPrompt,
  buildStandardsRubricBlock,
  composeQuestionText,
  type GradingUnit,
} from "../ai-grading";
import { StandardsAssessmentDraftSchema, validateStandardsDraft } from "../standards-import";
import {
  StandardsRubricSchema,
  buildStandardsReport,
  checkRubricAgainstItems,
  levelRanges,
  partRefForItem,
  strandForItem,
  type RubricItem,
} from "../standards-rubric";
import { stripMarkCodes, studentMarkSchemeRows } from "../student-mark-scheme";
import {
  FA2_ITEMS,
  FA2_NAME,
  FA2_PRINTED_QUESTION_MARKS,
  FA2_RUBRIC,
  FA2_TOTAL_MARKS,
} from "./g9-standard-fa2";

const ref = (it: { questionNumber: number; partLabel: string }) => `${it.questionNumber}${it.partLabel}`;

const ITEMS: RubricItem[] = FA2_ITEMS.map((it) => ({
  id: `item-${ref(it)}`,
  question_number: it.questionNumber,
  part_label: it.partLabel,
  max_marks: it.maxMarks,
}));

/** Every piece of text on the paper a renderer or the marker will read. */
const allTexts = () =>
  FA2_ITEMS.flatMap((it) => [it.stemText ?? "", it.questionText, it.markschemeText]);

describe("Formative Assessment 2 as printed", () => {
  it("has the paper's 14 parts, in order, adding up to its 36 marks", () => {
    expect(FA2_ITEMS.map(ref)).toEqual([
      "1a", "1b", "1c", "2a", "2b", "3a", "3b", "3c", "3d", "4a", "4b", "5", "6a", "6b",
    ]);
    expect(FA2_ITEMS.reduce((s, it) => s + it.maxMarks, 0)).toBe(FA2_TOTAL_MARKS);
  });

  it("matches every question total the paper prints", () => {
    const byQuestion: Record<number, number> = {};
    for (const it of FA2_ITEMS) byQuestion[it.questionNumber] = (byQuestion[it.questionNumber] ?? 0) + it.maxMarks;
    expect(byQuestion).toEqual(FA2_PRINTED_QUESTION_MARKS);
  });

  it("gives each question's lettered parts one shared stem, and Q3(a) none", () => {
    const stems = (q: number) => new Set(FA2_ITEMS.filter((it) => it.questionNumber === q).map((it) => it.stemText));
    expect(stems(1)).toEqual(new Set([null]));
    for (const q of [2, 4, 6]) {
      expect(stems(q).size).toBe(1);
      expect([...stems(q)][0]).toBeTruthy();
    }
    // Q3(a) is a different sequence; (b)-(d) share the printed table and graph.
    const q3 = FA2_ITEMS.filter((it) => it.questionNumber === 3);
    expect(q3[0].stemText).toBeNull();
    expect(new Set(q3.slice(1).map((it) => it.stemText)).size).toBe(1);
    expect(q3[1].stemText).toContain("$(1, 45)$, $(2, 30)$ and $(4, 0)$");
  });

  it("puts the demand a part's reason mark depends on in that part, not only in the stem", () => {
    // Q4's stem says "explain your reasoning in each case"; rule A6 of
    // lib/ask-what-you-mark.ts says the part has to say it too.
    for (const it of FA2_ITEMS.filter((i) => i.questionNumber === 4)) {
      expect(it.questionText).toContain("explain your reasoning");
    }
  });

  it("keeps every dollar paired, so nothing prints as raw LaTeX", () => {
    for (const text of allTexts()) {
      const unescaped = text.replace(/\\\$/g, "").split("$").length - 1;
      expect(unescaped % 2, text.slice(0, 60)).toBe(0);
    }
  });
});

describe("the strand rubric", () => {
  it("is a valid rubric that fits the paper's parts, every part in exactly one strand", () => {
    expect(StandardsRubricSchema.safeParse(FA2_RUBRIC).success).toBe(true);
    expect(checkRubricAgainstItems(FA2_RUBRIC, ITEMS)).toEqual([]);
    const claimed = FA2_RUBRIC.strands.flatMap((s) => s.parts);
    expect(claimed.sort()).toEqual(ITEMS.map(partRefForItem).sort());
  });

  it("passes the Standard Level importer's own validator, as a draft would on save", () => {
    const draft = StandardsAssessmentDraftSchema.parse({
      name: FA2_NAME,
      testDate: null,
      statedTotalMarks: FA2_TOTAL_MARKS,
      items: FA2_ITEMS,
      rubric: FA2_RUBRIC,
    });
    expect(validateStandardsDraft(draft)).toEqual([]);
  });

  it("puts 13, 12, 7 and 4 marks in strands A-D, with these level ranges", () => {
    const full = Object.fromEntries(ITEMS.map((i) => [i.id, i.max_marks]));
    const report = buildStandardsReport(FA2_RUBRIC, ITEMS, full);
    expect(report.strands.map((s) => [s.code, s.max, s.level])).toEqual([
      ["A", 13, "exceeding"],
      ["B", 12, "exceeding"],
      ["C", 7, "exceeding"],
      ["D", 4, "exceeding"],
    ]);
    expect(report.overall).toMatchObject({ marks: 36, max: 36, level: "exceeding", markedParts: 14 });

    const bands = FA2_RUBRIC.bands;
    expect(levelRanges(13, bands)).toEqual({ exceeding: "12-13", meeting: "9-11", approaching: "6-8", beginning: "0-5" });
    expect(levelRanges(12, bands)).toEqual({ exceeding: "11-12", meeting: "8-10", approaching: "5-7", beginning: "0-4" });
    expect(levelRanges(7, bands)).toEqual({ exceeding: "6-7", meeting: "5", approaching: "3-4", beginning: "0-2" });
    expect(levelRanges(4, bands)).toEqual({ exceeding: "4", meeting: "3", approaching: "2", beginning: "0-1" });
    expect(levelRanges(36, bands)).toEqual({ exceeding: "31-36", meeting: "24-30", approaching: "15-23", beginning: "0-14" });
  });
});

/** The paper as the grader builds it: each part with its strand, stem joined to part. */
function fa2Units(): GradingUnit[] {
  return FA2_ITEMS.map((it) => {
    const strand = strandForItem(FA2_RUBRIC, { question_number: it.questionNumber, part_label: it.partLabel })!;
    return {
      testItemId: `item-${ref(it)}`,
      questionNumber: it.questionNumber,
      partLabel: it.partLabel,
      maxMarks: it.maxMarks,
      questionCode: "",
      questionLatex: composeQuestionText(it.stemText, it.questionText),
      markscheme: it.markschemeText,
      markschemeSource: "custom",
      commandTerms: [],
      subtopicCodes: [],
      curriculum: [],
      level: null,
      paper: null,
      standards: { strand: { code: strand.code, name: strand.name, standards: strand.standards }, rubric: FA2_RUBRIC },
    };
  });
}

describe("what the marker is given", () => {
  it("the Standard Level policy and this paper's strands, not the Formative principles", () => {
    const prompt = buildGradingSystemPrompt(fa2Units());
    expect(prompt).toContain(G9_STANDARD_LEVEL_MARKING_PRINCIPLES);
    expect(prompt).not.toContain(G9_FORMATIVE_ASSESSMENT_MARKING_PRINCIPLES);

    const block = buildStandardsRubricBlock(FA2_RUBRIC, fa2Units());
    expect(block).toContain("Strand A: Expressions: evaluate, write and rewrite (13 marks)");
    expect(block).toContain("Parts: 1(a), 1(b), 1(c), 2(a), 2(b)");
    expect(block).toContain("Strand C: Arithmetic and geometric sequences (7 marks)");
    expect(block).toContain("Parts: 4(a), 4(b), 5");
    expect(block).toContain("Exceeding 4 / Meeting 3 / Approaching 2 / Beginning 0-1");
  });

  it("each part's own question, with the printed table and graph wherever a part is about them", () => {
    const prompt = buildGradingUserPrompt(fa2Units(), { testName: FA2_NAME });
    expect(prompt).toContain("Total marks available: 36");
    const block = (label: string) => {
      const start = prompt.indexOf(`=== ${label} ===`);
      return prompt.slice(start, prompt.indexOf("\n=== ", start + 1));
    };
    expect(block("3(a)")).not.toContain("Marker's note");
    for (const label of ["3(b)", "3(c)", "3(d)"]) expect(block(label)).toContain("three points printed");
    expect(block("6(b)")).toContain("at least one pack of each");
    expect(block("5")).toContain("Strand: C -- Arithmetic and geometric sequences");
  });

  it("every part worth more than one mark says what each mark is for", () => {
    for (const it of FA2_ITEMS) {
      expect(it.markschemeText.startsWith("A full-mark response"), ref(it)).toBe(true);
      if (it.maxMarks > 1) expect(it.markschemeText, ref(it)).toContain(`${it.maxMarks} marks`);
    }
  });

  it("refuses a bare answer a mark only for a demand the paper makes", () => {
    // The paper says "Show all work" once, on the cover. A scheme that
    // withholds a mark from a bare answer names that instruction, or a demand
    // the part itself makes -- see the fixture's header on rule A6.
    for (const it of FA2_ITEMS.filter((i) => /\bbare\b/.test(i.markschemeText))) {
      const cites =
        it.markschemeText.includes('The paper\'s instructions say "Show all work"') ||
        /explain your reasoning|Use your rule/.test(it.questionText);
      expect(cites, ref(it)).toBe(true);
    }
  });
});

describe("what a student would read, if the scheme is released", () => {
  it("every scheme reads as written: no marking codes to put into words", () => {
    for (const it of FA2_ITEMS) expect(stripMarkCodes(it.markschemeText), ref(it)).toBe(it.markschemeText);
  });

  it("builds one typeset row per part, carrying the paper's 36 marks", () => {
    // The page's rows (app/mark-scheme/[id]), built from the items as the
    // seed writes them, in order.
    const rows = studentMarkSchemeRows(
      null,
      FA2_ITEMS.map((it, i) => ({
        id: `fa2-${i}`,
        question_number: it.questionNumber,
        part_label: it.partLabel,
        max_marks: it.maxMarks,
        sort_order: i,
        stem_text: it.stemText,
        question_text: it.questionText,
        markscheme_text: it.markschemeText,
      })),
    );
    expect(rows).toHaveLength(14);
    expect(rows.reduce((sum, r) => sum + r.maxMarks, 0)).toBe(FA2_TOTAL_MARKS);
    expect(rows.every((r) => r.scheme?.how_marked_html)).toBe(true);
    const html = rows.map((r) => r.scheme?.how_marked_html ?? "").join("");
    expect(html).toContain('class="katex"');
    expect(html).not.toMatch(/\$\d|\$\\frac|\$-/);
  });
});
