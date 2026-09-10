import { describe, it, expect } from "vitest";
import {
  convertNuancedAnalysisToDraft,
  countQuestions,
  type NuancedAnalysisRow,
} from "./nuanced-analysis-bridge";

/**
 * The three `parts` encodings below are taken from the shapes actually
 * present in public.nuanced_analyses, not invented for the test:
 *
 *   A "generated" - part_number/title/content + questions{q_number,text},
 *                   ARRAY teacher_companion.   (1 packet)
 *   B "legacy"    - part_number/title/micro_box/geometric_reading +
 *                   questions{number,stem}, OBJECT teacher_companion.
 *                                                 (2 packets)
 *   C "sections"  - heading/spotlight/prerequisiteBox +
 *                   questions{prompt,answer}, OBJECT teacher_companion.
 *                                                 (3 packets)
 *
 * Shapes B and C both used to throw "teacherCompanion is not iterable"
 * before reaching any of the field mapping, which is what made the Manage
 * tab's "Open" button 500 for 5 of the 6 saved packets.
 */

function baseRow(overrides: Partial<NuancedAnalysisRow>): NuancedAnalysisRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    slug: "test-packet",
    title: "Test Packet",
    subtitle: null,
    course: null,
    syllabus_topics: null,
    prerequisites: null,
    materials: null,
    vocabulary: null,
    atl_statement: null,
    tok_provocations: null,
    parts: null,
    teacher_companion: null,
    ...overrides,
  };
}

describe("convertNuancedAnalysisToDraft", () => {
  describe("shape A — generated (part_number/title/content, array companion)", () => {
    const row = baseRow({
      title: "The Binomial Theorem",
      parts: [
        {
          part_number: 1,
          title: "From Pascal's Triangle",
          content: "For any positive integer n...",
          questions: [
            { q_number: "1", text: "Expand and fully simplify $(2x-3)^4$.", marks: 4 },
            { q_number: "2", text: "Write down row 8 of Pascal's Triangle.", marks: 2 },
          ],
        },
      ],
      teacher_companion: [
        {
          q_number: "1",
          answer: "$16x^4 - 96x^3 + ...$",
          mark_scheme: "(M1) for correct use of binom",
          pedagogy_note: "Students forget $(-3)^r$ alternates sign",
        },
      ],
    });

    it("builds a numbered heading from part_number and title", () => {
      const draft = convertNuancedAnalysisToDraft(row);
      expect(draft.sections[0].heading).toBe("Part 1 — From Pascal's Triangle");
    });

    it("reads the prompt from `text`", () => {
      const draft = convertNuancedAnalysisToDraft(row);
      expect(draft.sections[0].questions[0].prompt).toBe(
        "Expand and fully simplify $(2x-3)^4$."
      );
    });

    it("collapses the companion's three fields into one answer string", () => {
      const draft = convertNuancedAnalysisToDraft(row);
      const answer = draft.sections[0].questions[0].answer;
      expect(answer).toContain("Answer: $16x^4 - 96x^3 + ...$");
      expect(answer).toContain("Mark scheme: (M1) for correct use of binom");
      expect(answer).toContain("Common error: Students forget $(-3)^r$ alternates sign");
    });

    it("leaves a question with no companion entry unanswered", () => {
      const draft = convertNuancedAnalysisToDraft(row);
      expect(draft.sections[0].questions[1].answer).toBeUndefined();
    });

    it("maps `content` to the section spotlight", () => {
      const draft = convertNuancedAnalysisToDraft(row);
      expect(draft.sections[0].spotlight).toEqual({
        title: "Overview",
        body: "For any positive integer n...",
      });
    });
  });

  describe("shape B — legacy (micro_box/geometric_reading, questions{number,stem})", () => {
    const row = baseRow({
      title: "Polynomial Analysis",
      parts: [
        {
          part_number: 2,
          title: "Roots and Multiplicity",
          micro_box: [
            "A root of a polynomial is a value of x where P(x)=0.",
            "The multiplicity of a root is the power of its linear factor.",
          ],
          geometric_reading: "Even-multiplicity roots produce U-shaped contact.",
          questions: [
            { number: 1, stem: "State the multiplicity of each root.", marks: 3, command_term: "State" },
            { number: 2, stem: "Sketch the curve.", marks: 4, tier: 2 },
          ],
        },
      ],
      // Packet-level Teacher's Companion — no per-question entries at all.
      teacher_companion: {
        design_note: "...",
        planted_errors: ["..."],
        compulsory_core: "...",
      },
    });

    it("does not throw on an object-shaped teacher_companion", () => {
      expect(() => convertNuancedAnalysisToDraft(row)).not.toThrow();
    });

    it("reads the prompt from `stem`", () => {
      const draft = convertNuancedAnalysisToDraft(row);
      expect(draft.sections[0].questions[0].prompt).toBe("State the multiplicity of each root.");
      expect(draft.sections[0].questions[1].prompt).toBe("Sketch the curve.");
    });

    it("joins micro_box bullets into the spotlight body", () => {
      const draft = convertNuancedAnalysisToDraft(row);
      expect(draft.sections[0].spotlight?.body).toBe(
        "A root of a polynomial is a value of x where P(x)=0.\n" +
          "The multiplicity of a root is the power of its linear factor."
      );
    });

    it("maps geometric_reading to geometricReading", () => {
      const draft = convertNuancedAnalysisToDraft(row);
      expect(draft.sections[0].geometricReading).toEqual({
        body: "Even-multiplicity roots produce U-shaped contact.",
      });
    });

    it("carries marks and tier through", () => {
      const draft = convertNuancedAnalysisToDraft(row);
      expect(draft.sections[0].questions[0].marks).toBe(3);
      expect(draft.sections[0].questions[1].tier).toBe(2);
    });

    it("contributes no answers — a packet-level companion has no per-question mapping", () => {
      const draft = convertNuancedAnalysisToDraft(row);
      expect(draft.sections[0].questions.every((q) => q.answer === undefined)).toBe(true);
    });
  });

  describe("shape C — sections (parts IS AssignmentSection[])", () => {
    const row = baseRow({
      title: "Sixty Times a Person",
      parts: [
        {
          heading: "Part 1 — What a Letter Stands For",
          spotlight: { title: "Overview", body: "A variable is a placeholder." },
          prerequisiteBox: { items: ["Times tables to 12"] },
          questions: [
            {
              prompt: "Write an expression for six times a number.",
              marks: 4,
              answer: "6n",
              tier: 1,
              hint: "Start from the phrase.",
            },
          ],
        },
        {
          heading: "Part 2 — Substitution",
          questions: [{ prompt: "Evaluate 60a when a = 7.", marks: 2, answer: "420" }],
        },
      ],
      teacher_companion: {
        designNote: "...",
        answerSketches: ["Q1. (a) 420 (b) 330"],
        integrationMap: "...",
      },
    });

    it("does not throw on an object-shaped teacher_companion", () => {
      expect(() => convertNuancedAnalysisToDraft(row)).not.toThrow();
    });

    it("keeps the section heading verbatim rather than rebuilding it", () => {
      const draft = convertNuancedAnalysisToDraft(row);
      expect(draft.sections[0].heading).toBe("Part 1 — What a Letter Stands For");
      expect(draft.sections[1].heading).toBe("Part 2 — Substitution");
    });

    it("preserves array order when no part_number is present", () => {
      const draft = convertNuancedAnalysisToDraft(row);
      expect(draft.sections.map((s) => s.heading)).toEqual([
        "Part 1 — What a Letter Stands For",
        "Part 2 — Substitution",
      ]);
    });

    it("keeps the answer already on the question — this is what the answer key prints", () => {
      const draft = convertNuancedAnalysisToDraft(row);
      expect(draft.sections[0].questions[0].answer).toBe("6n");
      expect(draft.sections[1].questions[0].answer).toBe("420");
    });

    it("carries section enrichments through untouched", () => {
      const draft = convertNuancedAnalysisToDraft(row);
      expect(draft.sections[0].spotlight).toEqual({
        title: "Overview",
        body: "A variable is a placeholder.",
      });
      expect(draft.sections[0].prerequisiteBox).toEqual({ items: ["Times tables to 12"] });
    });

    it("carries per-question enrichments through", () => {
      const draft = convertNuancedAnalysisToDraft(row);
      expect(draft.sections[0].questions[0].tier).toBe(1);
      expect(draft.sections[0].questions[0].hint).toBe("Start from the phrase.");
    });
  });

  describe("vocabulary", () => {
    it("maps {student_speak, ib_rigor} pairs onto the first section", () => {
      const draft = convertNuancedAnalysisToDraft(
        baseRow({
          parts: [{ heading: "One", questions: [] }, { heading: "Two", questions: [] }],
          vocabulary: [{ student_speak: "top choose bottom", ib_rigor: "$\\binom{n}{r}$" }],
        })
      );
      expect(draft.sections[0].translationTable).toEqual({
        caption: "Key Vocabulary",
        rows: [{ informal: "top choose bottom", formal: "$\\binom{n}{r}$" }],
      });
      // Attached once, not duplicated across every section.
      expect(draft.sections[1].translationTable).toBeUndefined();
    });

    it("maps {term, definition} pairs, the shape a sandbox save writes", () => {
      const draft = convertNuancedAnalysisToDraft(
        baseRow({
          parts: [{ heading: "One", questions: [] }],
          vocabulary: [{ term: "Prove", definition: "Establish truth by rigorous reasoning." }],
        })
      );
      expect(draft.sections[0].translationTable?.rows).toEqual([
        { informal: "Prove", formal: "Establish truth by rigorous reasoning." },
      ]);
    });

    it("drops bare-string vocabulary — there is no second column to fill", () => {
      const draft = convertNuancedAnalysisToDraft(
        baseRow({
          parts: [{ heading: "One", questions: [] }],
          vocabulary: ["variable", "coefficient"],
        })
      );
      expect(draft.sections[0].translationTable).toBeUndefined();
    });

    it("does not overwrite a translationTable the section already carries", () => {
      const existing = { caption: "Its own", rows: [{ informal: "a", formal: "b" }] };
      const draft = convertNuancedAnalysisToDraft(
        baseRow({
          parts: [{ heading: "One", questions: [], translationTable: existing }],
          vocabulary: [{ student_speak: "x", ib_rigor: "y" }],
        })
      );
      expect(draft.sections[0].translationTable).toEqual(existing);
    });
  });

  describe("tok_provocations", () => {
    it("wraps bare strings, the shape every stored row uses", () => {
      const draft = convertNuancedAnalysisToDraft(
        baseRow({ tok_provocations: ["Does 60a contain meaning?", "Second one."] })
      );
      expect(draft.tokProvocations).toEqual([
        { id: "tok-1", body: "Does 60a contain meaning?" },
        { id: "tok-2", body: "Second one." },
      ]);
    });

    it("passes {id, body} objects through instead of stringifying them", () => {
      const draft = convertNuancedAnalysisToDraft(
        baseRow({ tok_provocations: [{ id: "tok-a", body: "Already an object." }] })
      );
      expect(draft.tokProvocations).toEqual([{ id: "tok-a", body: "Already an object." }]);
    });
  });

  describe("row-level fields", () => {
    it("joins array columns into the target's single-string fields", () => {
      const draft = convertNuancedAnalysisToDraft(
        baseRow({
          subtitle: "Grade 9 Extended",
          course: "Grade 9 Mathematics",
          syllabus_topics: ["Unit 1 A.1", "Unit 1 A.2"],
          prerequisites: ["Times tables", "Order of operations"],
          materials: "Pencil, ruler",
          atl_statement: "Critical thinking",
        })
      );
      expect(draft.subtitle).toBe("Grade 9 Extended");
      expect(draft.course).toBe("Grade 9 Mathematics");
      expect(draft.syllabusTopics).toBe("Unit 1 A.1, Unit 1 A.2");
      expect(draft.prerequisites).toBe("Times tables; Order of operations");
      expect(draft.materials).toBe("Pencil, ruler");
      expect(draft.atl).toBe("Critical thinking");
    });

    it("produces an empty draft rather than throwing on a row with no parts", () => {
      const draft = convertNuancedAnalysisToDraft(baseRow({}));
      expect(draft.sections).toEqual([]);
      expect(draft.title).toBe("Test Packet");
      expect(draft.subtitle).toBe("");
    });
  });
});

describe("countQuestions", () => {
  it("sums questions across every part shape", () => {
    const row = baseRow({
      parts: [
        { part_number: 1, title: "A", questions: [{ q_number: "1", text: "x" }] },
        { heading: "B", questions: [{ prompt: "y" }, { prompt: "z" }] },
        { heading: "C (no questions key)" },
      ],
    });
    expect(countQuestions(row)).toBe(3);
  });

  it("is 0 for a row with no parts", () => {
    expect(countQuestions(baseRow({}))).toBe(0);
  });
});
