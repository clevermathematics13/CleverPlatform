import { describe, it, expect } from "vitest";
import {
  buildTestItemsFromSections,
  computeTotalMarks,
  syncTestItems,
} from "./formative-assessment-bridge";
import type { AssignmentSection } from "./assignments";

function section(overrides: Partial<AssignmentSection> = {}): AssignmentSection {
  return { heading: "LEVEL 1", questions: [], ...overrides };
}

describe("buildTestItemsFromSections", () => {
  it("numbers questions globally across sections, not per section", () => {
    const rows = buildTestItemsFromSections("test-1", [
      section({ questions: [{ prompt: "Q1 prompt", marks: 2, markScheme: "A2" }] }),
      section({ questions: [{ prompt: "Q2 prompt", marks: 3, markScheme: "M1A2" }] }),
    ]);

    expect(rows.map((r) => r.question_number)).toEqual([1, 2]);
    expect(rows.every((r) => r.test_id === "test-1")).toBe(true);
    expect(rows.every((r) => r.source === "custom")).toBe(true);
  });

  it("emits one row per subpart, with lettered part_label", () => {
    const rows = buildTestItemsFromSections("test-1", [
      section({
        questions: [
          {
            prompt: "Solve the system",
            marks: 4,
            subparts: [
              { prompt: "(a) find x", marks: 1, markScheme: "A1" },
              { prompt: "(b) find y", marks: 3, markScheme: "M2A1" },
            ],
          },
        ],
      }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0].part_label).toBe("a");
    expect(rows[1].part_label).toBe("b");
    expect(rows.every((r) => r.question_number === 1)).toBe(true);
    expect(rows[0].max_marks).toBe(1);
    expect(rows[1].max_marks).toBe(3);
    expect(rows[0].markscheme_text).toBe("A1");
  });

  it("carries the question's stem onto every subpart row", () => {
    const rows = buildTestItemsFromSections("test-1", [
      section({
        questions: [
          {
            prompt: "Consider the formula $px + q = rx + s$.",
            marks: 4,
            subparts: [
              { prompt: "Rearrange the formula to make $x$ the subject.", marks: 3, markScheme: "M1M1A1" },
              { prompt: "Write down the condition your answer requires.", marks: 1, markScheme: "A1" },
            ],
          },
        ],
      }),
    ]);

    expect(rows.map((r) => r.stem_text)).toEqual([
      "Consider the formula $px + q = rx + s$.",
      "Consider the formula $px + q = rx + s$.",
    ]);
    // The part's own words stay its own -- the validator reads this field.
    expect(rows[0].question_text).toBe("Rearrange the formula to make $x$ the subject.");
  });

  it("leaves stem_text null on a whole-question row rather than repeating the prompt", () => {
    const rows = buildTestItemsFromSections("test-1", [
      section({ questions: [{ prompt: "Q1 prompt", marks: 2, markScheme: "A2" }] }),
    ]);

    expect(rows[0].stem_text).toBeNull();
    expect(rows[0].question_text).toBe("Q1 prompt");
  });

  it("stores a blank stem as no stem", () => {
    const rows = buildTestItemsFromSections("test-1", [
      section({
        questions: [
          { prompt: "   ", marks: 1, subparts: [{ prompt: "find x", marks: 1, markScheme: "A1" }] },
        ],
      }),
    ]);

    expect(rows[0].stem_text).toBeNull();
  });

  it("does not let a stem displace the start of a subpart prompt", () => {
    // rubric-validator's rule 10 matches a self-numbered prompt with /^.../,
    // so question_text has to still BEGIN with the subpart's own first word.
    const rows = buildTestItemsFromSections("test-1", [
      section({
        questions: [
          { prompt: "A stem", marks: 1, subparts: [{ prompt: "(a) find x", marks: 1, markScheme: "A1" }] },
        ],
      }),
    ]);

    expect(rows[0].question_text.startsWith("(a)")).toBe(true);
  });

  it("uses an empty part_label for a question with no subparts", () => {
    const rows = buildTestItemsFromSections("test-1", [
      section({ questions: [{ prompt: "Q1 prompt", marks: 2, markScheme: "A2" }] }),
    ]);

    expect(rows[0].part_label).toBe("");
    expect(rows[0].max_marks).toBe(2);
    expect(rows[0].question_text).toBe("Q1 prompt");
    expect(rows[0].markscheme_text).toBe("A2");
  });

  it("falls back to empty strings/zero marks when unset, never undefined", () => {
    const rows = buildTestItemsFromSections("test-1", [
      section({ questions: [{ prompt: "Untiered prompt" }] }),
    ]);

    expect(rows[0].max_marks).toBe(0);
    expect(rows[0].markscheme_text).toBe("");
  });

  it("is idempotent: the same sections always produce the same rows", () => {
    const sections: AssignmentSection[] = [
      section({ questions: [{ prompt: "Q1 prompt", marks: 2, markScheme: "A2" }] }),
    ];

    expect(buildTestItemsFromSections("test-1", sections)).toEqual(
      buildTestItemsFromSections("test-1", sections),
    );
  });
});

describe("computeTotalMarks", () => {
  it("sums question marks directly when there are no subparts", () => {
    const total = computeTotalMarks([
      section({ questions: [{ prompt: "Q1", marks: 2 }, { prompt: "Q2", marks: 3 }] }),
    ]);
    expect(total).toBe(5);
  });

  it("sums subpart marks instead of the parent's when subparts are present", () => {
    const total = computeTotalMarks([
      section({
        questions: [
          { prompt: "Q1", marks: 4, subparts: [{ prompt: "a", marks: 1 }, { prompt: "b", marks: 3 }] },
        ],
      }),
    ]);
    expect(total).toBe(4);
  });
});

// ---- syncTestItems -------------------------------------------------------
// The guarantee under test is a negative one -- that a row carrying student
// work is never deleted -- so the double records every write and refuses the
// delete-by-test_id call the destructive version used to make.

type Row = Record<string, unknown>;

function fakeDb(seed: {
  test_items: Row[];
  student_marks?: Row[];
  ai_grade_results?: Row[];
  mark_changes?: Row[];
  remark_requests?: Row[];
  student_self_scores?: Row[];
}) {
  const tables: Record<string, Row[]> = {
    ai_grade_results: [],
    mark_changes: [],
    remark_requests: [],
    student_marks: [],
    student_self_scores: [],
    ...seed,
  };
  const calls = {
    upserts: 0,
    upserted: [] as Row[],
    onConflict: undefined as string | undefined,
    deletedIds: [] as string[],
  };

  function query(table: string) {
    const filters: Array<(r: Row) => boolean> = [];
    const self = {
      select() {
        return self;
      },
      eq(col: string, val: unknown) {
        filters.push((r) => r[col] === val);
        return self;
      },
      in(col: string, vals: unknown[]) {
        filters.push((r) => vals.includes(r[col]));
        return self;
      },
      then<T>(resolve: (v: { data: Row[]; error: null }) => T) {
        const data = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return self;
  }

  const supabase = {
    from(table: string) {
      return {
        select: () => query(table),
        upsert(rows: Row[], opts?: { onConflict?: string }) {
          calls.upserts++;
          calls.upserted = rows;
          calls.onConflict = opts?.onConflict;
          return Promise.resolve({ error: null });
        },
        delete() {
          return {
            in(col: string, vals: string[]) {
              calls.deletedIds.push(...vals);
              tables[table] = (tables[table] ?? []).filter((r) => !vals.includes(r[col] as string));
              return Promise.resolve({ error: null });
            },
            eq() {
              throw new Error(
                "delete().eq() -- the whole-test wipe this module must never do again",
              );
            },
          };
        },
      };
    },
  };

  return { supabase: supabase as unknown as Parameters<typeof syncTestItems>[0], calls, tables };
}

/** A stored row as the bridge would have written it. */
function storedItem(id: string, questionNumber: number, partLabel: string, text: string): Row {
  return {
    id,
    test_id: "test-1",
    question_number: questionNumber,
    part_label: partLabel,
    question_text: text,
    source: "custom",
  };
}

const TWO_PARTER: AssignmentSection[] = [
  section({
    questions: [
      {
        prompt: "Consider $px + q = rx + s$.",
        marks: 4,
        subparts: [
          { prompt: "Make $x$ the subject.", marks: 3, markScheme: "M1M1A1" },
          { prompt: "State the condition.", marks: 1, markScheme: "A1" },
        ],
      },
    ],
  }),
];

describe("syncTestItems", () => {
  it("updates a marked paper in place, deleting nothing", async () => {
    const db = fakeDb({
      test_items: [
        storedItem("item-a", 1, "a", "Make $x$ the subject."),
        storedItem("item-b", 1, "b", "State the condition."),
      ],
      student_marks: [{ test_item_id: "item-a" }, { test_item_id: "item-b" }],
    });

    const result = await syncTestItems(db.supabase, "test-1", TWO_PARTER);

    expect(result).toMatchObject({ ok: true, synced: 2, removed: 0 });
    expect(db.calls.deletedIds).toEqual([]);
    expect(db.calls.onConflict).toBe("test_id,question_number,part_label");
  });

  it("refuses when a part that carries marks has gone from the draft", async () => {
    const db = fakeDb({
      test_items: [
        storedItem("item-a", 1, "a", "Make $x$ the subject."),
        storedItem("item-b", 1, "b", "State the condition."),
        storedItem("item-c", 2, "", "A question the teacher just deleted."),
      ],
      student_marks: [{ test_item_id: "item-c" }],
    });

    const result = await syncTestItems(db.supabase, "test-1", TWO_PARTER);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Q2");
    // Refused means nothing happened at all, not "happened but reported".
    expect(db.calls.upserts).toBe(0);
    expect(db.calls.deletedIds).toEqual([]);
    expect(db.tables.test_items).toHaveLength(3);
  });

  it("checks every table that cascades, not just student_marks", async () => {
    for (const table of [
      "ai_grade_results",
      "mark_changes",
      "remark_requests",
      "student_self_scores",
    ] as const) {
      const db = fakeDb({
        test_items: [
          storedItem("item-a", 1, "a", "Make $x$ the subject."),
          storedItem("item-b", 1, "b", "State the condition."),
          storedItem("item-c", 2, "", "Deleted question."),
        ],
        [table]: [{ test_item_id: "item-c" }],
      });

      const result = await syncTestItems(db.supabase, "test-1", TWO_PARTER);
      expect(result.ok, `${table} did not protect the row`).toBe(false);
    }
  });

  it("removes a part that has gone and has nothing against it", async () => {
    const db = fakeDb({
      test_items: [
        storedItem("item-a", 1, "a", "Make $x$ the subject."),
        storedItem("item-b", 1, "b", "State the condition."),
        storedItem("item-c", 2, "", "An unmarked question the teacher cut."),
      ],
    });

    const result = await syncTestItems(db.supabase, "test-1", TWO_PARTER);

    expect(result).toMatchObject({ ok: true, removed: 1 });
    expect(db.calls.deletedIds).toEqual(["item-c"]);
  });

  it("allows a reworded part to keep its marks, and says which", async () => {
    const db = fakeDb({
      test_items: [
        storedItem("item-a", 1, "a", "Rearrange to make x the subject."),
        storedItem("item-b", 1, "b", "State the condition."),
      ],
      ai_grade_results: [{ test_item_id: "item-a" }],
    });

    const result = await syncTestItems(db.supabase, "test-1", TWO_PARTER);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rewordedUnderStudentWork).toEqual(["Q1(a)"]);
    expect(db.calls.deletedIds).toEqual([]);
  });

  it("says nothing about rewording when the part carries no marks", async () => {
    const db = fakeDb({
      test_items: [
        storedItem("item-a", 1, "a", "Rearrange to make x the subject."),
        storedItem("item-b", 1, "b", "State the condition."),
      ],
    });

    const result = await syncTestItems(db.supabase, "test-1", TWO_PARTER);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rewordedUnderStudentWork).toEqual([]);
  });

  it("will not overwrite a question-bank row sitting on a derived key", async () => {
    const db = fakeDb({
      test_items: [
        { ...storedItem("item-a", 1, "a", "An IB part"), source: "ib" },
        storedItem("item-b", 1, "b", "State the condition."),
      ],
    });

    const result = await syncTestItems(db.supabase, "test-1", TWO_PARTER);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("question bank");
    expect(db.calls.upserts).toBe(0);
  });
});
