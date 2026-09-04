import { describe, it, expect } from "vitest";
import { buildRubricItemsFromSections } from "./na-rubric-bridge";
import type { AssignmentSection } from "./assignments";

function section(overrides: Partial<AssignmentSection> = {}): AssignmentSection {
  return { heading: "Part 0", questions: [], ...overrides };
}

describe("buildRubricItemsFromSections", () => {
  it("numbers questions globally across sections, not per section", () => {
    const rows = buildRubricItemsFromSections("na-1", [
      section({ questions: [{ prompt: "Q1 prompt", marks: 2, answer: "42" }] }),
      section({ questions: [{ prompt: "Q2 prompt", marks: 3, answer: "7" }] }),
    ]);

    expect(rows.map((r) => r.qid)).toEqual(["Q1", "Q2"]);
    expect(rows[1].question_number).toBe(2);
  });

  it("emits one row per subpart, sharing base_qid and question_marks", () => {
    const rows = buildRubricItemsFromSections("na-1", [
      section({
        questions: [
          {
            prompt: "Solve the system",
            marks: 4,
            answer: "parent answer (unused when subparts answer their own)",
            subparts: [
              { prompt: "(a) find x", marks: 1, answer: "x = 1" },
              { prompt: "(b) find y", marks: 3, answer: "y = 2" },
            ],
          },
        ],
      }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0].qid).toBe("Q1(a)");
    expect(rows[1].qid).toBe("Q1(b)");
    expect(rows.every((r) => r.base_qid === "Q1")).toBe(true);
    expect(rows.every((r) => r.question_marks === 4)).toBe(true);
    expect(rows[0].marks).toBe(1);
    expect(rows[0].answer_key).toBe("x = 1");
    expect(rows[1].marks).toBe(3);
  });

  it("falls back to the parent's answer when a subpart has none of its own", () => {
    const rows = buildRubricItemsFromSections("na-1", [
      section({
        questions: [
          {
            prompt: "Solve the system",
            marks: 4,
            answer: "shared parent answer",
            subparts: [{ prompt: "(a) find x", marks: 4 }],
          },
        ],
      }),
    ]);

    expect(rows[0].answer_key).toBe("shared parent answer");
  });

  it("treats a question with no marks as nullable, not zero", () => {
    const rows = buildRubricItemsFromSections("na-1", [
      section({ questions: [{ prompt: "Untiered reflection prompt" }] }),
    ]);

    expect(rows[0].marks).toBeNull();
    expect(rows[0].question_marks).toBeNull();
  });

  it("is idempotent: the same sections always produce the same rows", () => {
    const sections: AssignmentSection[] = [
      section({ questions: [{ prompt: "Q1 prompt", marks: 2, answer: "42" }] }),
    ];

    expect(buildRubricItemsFromSections("na-1", sections)).toEqual(
      buildRubricItemsFromSections("na-1", sections),
    );
  });

  it("leaves command_term, open_rubric, and misconception_context null", () => {
    const rows = buildRubricItemsFromSections("na-1", [
      section({ questions: [{ prompt: "Q1 prompt", marks: 2, answer: "42" }] }),
    ]);

    expect(rows[0].command_term).toBeNull();
    expect(rows[0].open_rubric).toBeNull();
    expect(rows[0].misconception_context).toBeNull();
  });
});
