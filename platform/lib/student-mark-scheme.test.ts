import { describe, it, expect } from "vitest";
import { stripMarkCodes, buildStudentMarkSchemeHtml } from "./student-mark-scheme";
import { paperQuestionPrefixes } from "./assignments";

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
