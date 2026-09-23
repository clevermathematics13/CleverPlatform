import { describe, it, expect } from "vitest";
import {
  stripMarkCodes,
  buildStudentMarkSchemeHtml,
  buildStudentMarkSchemeHtmlFromItems,
  type StudentMarkSchemeItem,
} from "./student-mark-scheme";
import { paperQuestionPrefixes } from "./assignments";
import { KA1_UNIT1_ITEMS, KA1_UNIT1_NAME, KA1_UNIT1_TOTAL_MARKS } from "./fixtures/g9-standard-ka1-unit1";

describe("stripMarkCodes", () => {
  it("removes a leading code with 'for' and capitalises what follows", () => {
    expect(stripMarkCodes("A1 for 3 (accept '3 terms').")).toBe("3 (accept '3 terms').");
  });

  it("removes a leading reasoning code", () => {
    expect(stripMarkCodes("R1 for naming addition AND linking it to the distinction.")).toBe(
      "Naming addition AND linking it to the distinction."
    );
  });

  it("removes chained codes with no 'for'", () => {
    expect(stripMarkCodes("A correct x=6 with no working scores M0M0A1.")).toBe(
      "A correct x=6 with no working scores"
    );
  });

  it("removes an inline bare code mid-sentence", () => {
    expect(stripMarkCodes("Multiplying only some terms earns M0 for that line, but FT through the rest.")).toBe(
      "Multiplying only some terms earns that line, but FT through the rest."
    );
  });

  it("leaves plain prose with no codes unchanged", () => {
    expect(stripMarkCodes("Accept any equivalent correct form.")).toBe("Accept any equivalent correct form.");
  });
});

describe("buildStudentMarkSchemeHtml", () => {
  const LABEL = '<span class="sms-label">';

  it("numbers top-level questions and lettered subparts, and omits teacher-only sections", () => {
    const html = buildStudentMarkSchemeHtml({
      title: "Key Assessment 1",
      subtitle: "Grade 9 Mathematics -- Extended",
      sections: [
        {
          heading: "LEVEL 1",
          questions: [
            { prompt: "Simplify.", marks: 1, answer: "5x", markScheme: "A1 for 5x." },
            {
              prompt: "Two parts.",
              marks: 2,
              subparts: [
                { prompt: "Find x.", marks: 1, answer: "3", markScheme: "A1 for 3." },
                { prompt: "Find y.", marks: 1, answer: "4", markScheme: "A1 for 4." },
              ],
            },
          ],
        },
      ],
    });

    expect(html).toContain(`${LABEL}1.1<`);
    expect(html).toContain(`${LABEL}1.2(a)<`);
    expect(html).toContain(`${LABEL}1.2(b)<`);
    expect(html).not.toMatch(/\bA1\b/);
    expect(html).not.toMatch(/Not for Distribution/);
    expect(html).toContain("Key Assessment 1");
  });

  // The regression: questions were counted across the whole paper, so the
  // first question of LEVEL 2 was "3" here while the paper and the
  // self-grade form both called it "2.1".
  it("restarts the question count in each section, as the printed paper does", () => {
    const sections = [
      {
        heading: "LEVEL 1",
        questions: [
          { prompt: "One.", marks: 1, answer: "1" },
          { prompt: "Two.", marks: 1, answer: "2" },
        ],
      },
      {
        heading: "LEVEL 2",
        questions: [
          {
            prompt: "Three.",
            marks: 2,
            subparts: [
              { prompt: "Find x.", marks: 1, answer: "3" },
              { prompt: "Find y.", marks: 1, answer: "4" },
            ],
          },
          { prompt: "Four.", marks: 1, answer: "5" },
        ],
      },
    ];
    const html = buildStudentMarkSchemeHtml({ title: "KA", sections });

    expect(html).toContain(`${LABEL}2.1(a)<`);
    expect(html).toContain(`${LABEL}2.1(b)<`);
    expect(html).toContain(`${LABEL}2.2<`);
    expect(html).not.toContain(`${LABEL}3(a)<`);
    expect(html).not.toContain(`${LABEL}4<`);

    // Row for row what the self-grade form shows: its label is
    // paperQuestionPrefixes' prefix for the item's sort_order, then the
    // item's part letter (lib/formative-assessment-bridge.ts builds those).
    const prefixes = paperQuestionPrefixes({ sections });
    const formLabels = [
      `${prefixes.get(0)}`,
      `${prefixes.get(1)}`,
      `${prefixes.get(2)}(a)`,
      `${prefixes.get(3)}(b)`,
      `${prefixes.get(4)}`,
    ];
    for (const label of formLabels) expect(html).toContain(`${LABEL}${label}<`);
  });
});

// A paper with no creator draft -- Grade 9 Standard Level Key Assessment 1,
// imported from its PDFs -- is built from its test_items instead.
describe("buildStudentMarkSchemeHtmlFromItems", () => {
  const LABEL = '<span class="sms-label">';
  const ka1Items: StudentMarkSchemeItem[] = KA1_UNIT1_ITEMS.map((i) => ({
    question_number: i.questionNumber,
    part_label: i.partLabel,
    max_marks: i.maxMarks,
    markscheme_text: i.markschemeText,
  }));
  const labelsOf = (html: string) => [...html.matchAll(/<span class="sms-label">([^<]*)</g)].map((m) => m[1]);

  it("gives every part its own row, labelled and ordered as the self-grade form lists them", () => {
    const html = buildStudentMarkSchemeHtmlFromItems({ title: KA1_UNIT1_NAME, items: ka1Items });

    // With no draft, NativeForm shows question_number then "(part)" -- and a
    // question with no parts (5, 8) as the bare number.
    expect(labelsOf(html)).toEqual([
      "1(a)", "1(b)", "1(c)",
      "2(a)", "2(b)", "2(c)", "2(d)",
      "3(a)", "3(b)", "3(c)",
      "4(a)", "4(b)", "4(c)",
      "5",
      "6(a)", "6(b)", "6(c)", "6(d)",
      "7(a)", "7(b)", "7(c)", "7(d)",
      "8",
      "9(a)", "9(b)", "9(c)",
    ]);
    expect(html).toContain(KA1_UNIT1_NAME);
  });

  it("carries each part's marks, summing to the paper's total", () => {
    const html = buildStudentMarkSchemeHtmlFromItems({ title: KA1_UNIT1_NAME, items: ka1Items });
    const marks = [...html.matchAll(/\[(\d+) marks?\]/g)].map((m) => Number(m[1]));
    expect(marks).toHaveLength(26);
    expect(marks.reduce((a, b) => a + b, 0)).toBe(KA1_UNIT1_TOTAL_MARKS);
  });

  it("shows each part's mark scheme with its mathematics typeset", () => {
    const html = buildStudentMarkSchemeHtmlFromItems({ title: KA1_UNIT1_NAME, items: ka1Items });
    expect(html).toContain("A full-mark response shows correct substitution");
    expect(html).toContain('class="katex"');
    expect(html).not.toContain("$4(3) + 2(3 - 5)");
  });

  it("keeps an escaped dollar a dollar", () => {
    const html = buildStudentMarkSchemeHtmlFromItems({
      title: "KA",
      items: [{ question_number: 4, part_label: "c", max_marks: 1, markscheme_text: "Uses $20(52) + 10 = 1050$. Answer: \\$1050." }],
    });
    expect(html).toContain("Answer: $1050.");
    expect(html).not.toContain("\\$");
  });

  it("never renders a part's marking notes, even when the row carries them", () => {
    const row = {
      ...ka1Items[0],
      marking_notes: "Report high confidence and record the token as awarded.",
    } as StudentMarkSchemeItem;
    const html = buildStudentMarkSchemeHtmlFromItems({ title: "KA", items: [row] });
    expect(html).not.toContain("high confidence");
    expect(html).not.toContain("token");
  });

  it("keeps the row for a part with no mark scheme text, so the page still matches the form", () => {
    const html = buildStudentMarkSchemeHtmlFromItems({
      title: "KA",
      items: [
        { question_number: 1, part_label: "a", max_marks: 1, markscheme_text: "Answer: 8." },
        { question_number: 1, part_label: "b", max_marks: 2, markscheme_text: null },
        { question_number: 2, part_label: "", max_marks: 3, markscheme_text: "   " },
      ],
    });
    expect(labelsOf(html)).toEqual(["1(a)", "1(b)", "2"]);
    expect(html.match(/How it's marked/g)).toHaveLength(1);
    expect(html).toContain(`${LABEL}1(b)</span><span class="sms-marks">[2 marks]</span>`);
  });
});
