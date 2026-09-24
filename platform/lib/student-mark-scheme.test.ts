import { describe, it, expect } from "vitest";
import {
  stripMarkCodes,
  buildStudentMarkSchemeHtml,
  buildStudentMarkSchemeHtmlFromItems,
  renderStudentMarkSchemePart,
  releasesStudentMarkScheme,
  studentMarkSchemeParts,
  studentMarkSchemePath,
  type StudentMarkSchemeItem,
} from "./student-mark-scheme";
import { paperQuestionPrefixes, type AssignmentSection } from "./assignments";
import { buildTestItemsFromSections } from "./formative-assessment-bridge";
import { KA1_UNIT1_ITEMS, KA1_UNIT1_NAME, KA1_UNIT1_TOTAL_MARKS } from "./fixtures/g9-standard-ka1-unit1";

describe("stripMarkCodes", () => {
  it("names the mark a leading code is for", () => {
    expect(stripMarkCodes("A1 for 3 (accept '3 terms').")).toBe("Answer mark for 3 (accept '3 terms').");
    expect(stripMarkCodes("R1 for naming addition AND linking it to the distinction.")).toBe(
      "Reasoning mark for naming addition AND linking it to the distinction."
    );
    expect(stripMarkCodes("M1A1 for x = 3.")).toBe("Method mark and answer mark for x = 3.");
    expect(stripMarkCodes("M1 A1 for x = 3.")).toBe("Method mark and answer mark for x = 3.");
    expect(stripMarkCodes("For reference: M1 for the factors.")).toBe("For reference: method mark for the factors.");
  });

  it("puts a code used as a noun into words instead of leaving a hole", () => {
    expect(stripMarkCodes("A correct x=6 with no working scores M0M0A1.")).toBe(
      "A correct x=6 with no working scores the answer mark only."
    );
    expect(stripMarkCodes("Multiplying only some terms earns M0 for that line, but FT through the rest.")).toBe(
      "Multiplying only some terms earns no method mark for that line, but follow-through applies to the rest."
    );
    expect(stripMarkCodes("'96/6 - v' earns M0A0 -- the grouping was not formed.")).toBe(
      "'96/6 - v' earns no marks -- the grouping was not formed."
    );
    expect(stripMarkCodes("Award M1A0 for '96 - v / 6' written without brackets.")).toBe(
      "Award the method mark only for '96 - v / 6' written without brackets."
    );
    expect(stripMarkCodes("Two correct lines earn M1M1A0.")).toBe("Two correct lines earn both method marks only.");
  });

  // Key Assessment 1, 3.3(a), as its students read it before this: "X =" for
  // the teacher's "x =", and two sentences run together where "earns M1M0A0."
  // and "earns A1 only" lost their objects.
  it("reads a real multi-mark scheme as the teacher wrote it", () => {
    const scheme =
      "M1 for collecting the x-terms on one side and the constants on the other: px - rx = s - q. " +
      "M1 for factoring x out: x(p - r) = s - q. A1 for x = (s - q)/(p - r). " +
      "Accept the equivalent x = (q - s)/(r - p). Dividing by p or by r alone, without factoring, earns M1M0A0. " +
      "A bare 'x = (s - q)/(p - r)' with no working earns A1 only: the command term requires visible steps, " +
      "so the two method marks are not available retrospectively.";
    expect(stripMarkCodes(scheme)).toBe(
      "Method mark for collecting the x-terms on one side and the constants on the other: px - rx = s - q. " +
        "Method mark for factoring x out: x(p - r) = s - q. Answer mark for x = (s - q)/(p - r). " +
        "Accept the equivalent x = (q - s)/(r - p). Dividing by p or by r alone, without factoring, earns the first method mark only. " +
        "A bare 'x = (s - q)/(p - r)' with no working earns the answer mark only: the command term requires visible steps, " +
        "so the two method marks are not available retrospectively."
    );
  });

  it("names a mark after a determiner, and chooses the article by how many the note labels", () => {
    expect(
      stripMarkCodes(
        "M1 for collecting. R1 for a stated conclusion (the R1 is for the conclusion -- " +
          "no closing statement earns M1R0)."
      )
    ).toBe(
      "Method mark for collecting. Reasoning mark for a stated conclusion (the reasoning mark is for the conclusion -- " +
        "no closing statement earns the method mark only)."
    );
    expect(stripMarkCodes("M1 for one step. M1 for another. A1 for 5. A slip earns M1; a bare 5 earns A1.")).toBe(
      "Method mark for one step. Method mark for another. Answer mark for 5. " +
        "A slip earns a method mark; a bare 5 earns the answer mark."
    );
    expect(stripMarkCodes("A1 for 6. A chain without = signs forfeits the second M.")).toBe(
      "Answer mark for 6. A chain without = signs forfeits the second method mark."
    );
    expect(stripMarkCodes("Withhold the A mark; keep any M marks. An R mark needs a reason. A mark is lost for units.")).toBe(
      "Withhold the answer mark; keep any method marks. A reasoning mark needs a reason. A mark is lost for units."
    );
    expect(stripMarkCodes("Any valid method earns an M1, and a correct value an A1.")).toBe(
      "Any valid method earns a method mark, and a correct value an answer mark."
    );
  });

  it("drops a code that only labels the part, and never recapitalises the teacher's words", () => {
    expect(stripMarkCodes("A1. The sign is part of the answer.")).toBe("The sign is part of the answer.");
    // A variable stays the variable it is.
    expect(stripMarkCodes("A1. u^2 - v^2 or (u-v)*2 earns 0.")).toBe("u^2 - v^2 or (u-v)*2 earns 0.");
    expect(stripMarkCodes("M1 for 2A = bh. A1 for h = 2A/b. Accept any valid order, e.g. dividing by b first.")).toBe(
      "Method mark for 2A = bh. Answer mark for h = 2A/b. Accept any valid order, e.g. dividing by b first."
    );
    expect(stripMarkCodes("M1 for testing j=0,1,2,... and rejecting non-integer cases.")).toBe(
      "Method mark for testing j=0,1,2,... and rejecting non-integer cases."
    );
    // A label the sentence carries on from: its first plain word is capitalised.
    expect(stripMarkCodes("A1 -- the whole expression is a sum of 14q and 9(q+5).")).toBe(
      "The whole expression is a sum of 14q and 9(q+5)."
    );
    expect(stripMarkCodes("A1.")).toBe("");
  });

  it("puts follow-through into words", () => {
    expect(stripMarkCodes("A bare '$69' earns 0. FT applies: substitution into an incorrect (a).")).toBe(
      "A bare '$69' earns 0. Follow-through applies: substitution into an incorrect (a)."
    );
    expect(stripMarkCodes("A1. Requires the student's own (b). FT: a wrong (b) still earns the mark.")).toBe(
      "Requires the student's own (b). Follow-through: a wrong (b) still earns the mark."
    );
    expect(stripMarkCodes("-- 0 for (a), but FT through (b).")).toBe("-- 0 for (a), but follow-through applies to (b).");
  });

  it("leaves plain prose with no codes unchanged", () => {
    expect(stripMarkCodes("Accept any equivalent correct form.")).toBe("Accept any equivalent correct form.");
    expect(stripMarkCodes("A full-mark response shows the structure. A mark is lost for units.")).toBe(
      "A full-mark response shows the structure. A mark is lost for units."
    );
  });
});

describe("renderStudentMarkSchemePart", () => {
  it("shows no empty box for a note that was only a label", () => {
    expect(renderStudentMarkSchemePart({ markScheme: "A1." })).toBeNull();
    const part = renderStudentMarkSchemePart({ answer: "$-9$", markScheme: "A1." });
    expect(part?.answer_html).toContain('class="katex"');
    expect(part?.how_marked_html).toBeNull();
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

// The same content, part by part, for the self-grade form: each part's scheme
// sits under its label there instead of in a panel laid over the form.
describe("studentMarkSchemeParts", () => {
  const draftSections = [
    {
      heading: "LEVEL 1",
      questions: [
        { prompt: "Q one.", marks: 1, answer: "5x", markScheme: "A1 for 5x." },
        {
          prompt: "Q two.",
          marks: 2,
          subparts: [
            { prompt: "Find x.", marks: 1, answer: "x = 3", markScheme: "A1. Accept 3." },
            { prompt: "Find y.", marks: 1, answer: "y = 4", markScheme: "M1 for the method." },
          ],
        },
      ],
    },
    {
      heading: "LEVEL 2",
      questions: [{ prompt: "Q three.", marks: 2, answer: "$\\frac{1}{2}$", markScheme: "R1 for the reason." }],
    },
  ];

  it("gives each item of a creator paper its own part's scheme, matched the way the items were built", () => {
    // The real bridge that writes a creator paper's test_items, so the
    // pairing is checked against the sort_order it actually assigns.
    const built = buildTestItemsFromSections("t", draftSections as unknown as AssignmentSection[]);
    const items = built.map((row, i) => ({ id: `item-${i}`, sort_order: row.sort_order, markscheme_text: row.markscheme_text }));
    const parts = studentMarkSchemeParts({ sections: draftSections }, items);

    expect(parts.size).toBe(4);
    expect(parts.get("item-0")?.answer_html).toContain("5x");
    expect(parts.get("item-1")?.answer_html).toContain("x = 3");
    expect(parts.get("item-2")?.answer_html).toContain("y = 4");
    expect(parts.get("item-2")?.how_marked_html).toContain("Method mark for the method.");
    expect(parts.get("item-3")?.answer_html).toContain('class="katex"');
    // No marking codes survive on any of them.
    for (const part of parts.values()) {
      expect(part.how_marked_html ?? "").not.toMatch(/\b[MAR]1\b/);
    }
  });

  it("uses each item's own mark scheme text when the paper has no draft", () => {
    const items = KA1_UNIT1_ITEMS.map((item, i) => ({
      id: `ka1-${i}`,
      sort_order: i,
      markscheme_text: item.markschemeText,
    }));
    const parts = studentMarkSchemeParts(null, items);

    expect(parts.size).toBe(26);
    for (const [id, part] of parts) {
      // Each part's text is ITS item's scheme: check for that scheme's own
      // opening words (before any maths, which renders as KaTeX markup),
      // not for a phrase every scheme happens to share. Q8's scheme opens
      // "The question asks for..." since 20260918210444, and it is a scheme
      // like the others.
      const item = KA1_UNIT1_ITEMS[Number(id.replace("ka1-", ""))];
      const lead = item.markschemeText.split("$")[0].slice(0, 40);
      expect(lead.length).toBeGreaterThan(10);
      expect(part.answer_html).toBeNull();
      expect(part.how_marked_html).toContain(lead);
    }
    expect(parts.get("ka1-0")?.how_marked_html).toContain('class="katex"');
  });

  it("leaves out a part with nothing to show", () => {
    const parts = studentMarkSchemeParts(null, [
      { id: "a", sort_order: 0, markscheme_text: "Answer: 8." },
      { id: "b", sort_order: 1, markscheme_text: null },
      { id: "c", sort_order: 2, markscheme_text: "   " },
    ]);
    expect([...parts.keys()]).toEqual(["a"]);
  });

  it("renders a part the same way the full page does", () => {
    const part = renderStudentMarkSchemePart({ markScheme: "A full-mark response gives $-12$. Answer: \\$1050." });
    const page = buildStudentMarkSchemeHtmlFromItems({
      title: "KA",
      items: [{ question_number: 1, part_label: "b", max_marks: 1, markscheme_text: "A full-mark response gives $-12$. Answer: \\$1050." }],
    });
    expect(part?.how_marked_html).toBeTruthy();
    expect(page).toContain(part!.how_marked_html!);
    expect(part?.how_marked_html).toContain("Answer: $1050.");
  });

  it("names the page a released test points its mark_scheme_url at", () => {
    // What the two migrations that released a scheme wrote.
    expect(studentMarkSchemePath("a1c0f4e2-9d00-4b7e-8c21-000000000001")).toBe(
      "/api/tests/a1c0f4e2-9d00-4b7e-8c21-000000000001/mark-scheme",
    );
  });
});

describe("releasesStudentMarkScheme", () => {
  const id = "ccfa0456-a7f7-4835-81d4-7983df021022";

  it("is true when the test's released mark scheme is this platform's own page", () => {
    expect(releasesStudentMarkScheme({ id, mark_scheme_url: studentMarkSchemePath(id) })).toBe(true);
  });

  it("is false when no mark scheme is released", () => {
    // Formative Assessment 1: a draft with a full mark scheme, never released.
    expect(releasesStudentMarkScheme({ id, mark_scheme_url: null })).toBe(false);
  });

  it("is false for another test's page, or a mark scheme released as a link elsewhere", () => {
    expect(
      releasesStudentMarkScheme({ id, mark_scheme_url: studentMarkSchemePath("a1c0f4e2-9d00-4b7e-8c21-000000000001") }),
    ).toBe(false);
    expect(releasesStudentMarkScheme({ id, mark_scheme_url: "https://drive.google.com/file/d/abc/view" })).toBe(false);
  });
});
