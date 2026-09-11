import { describe, it, expect } from "vitest";
import {
  extractAnswerOnly,
  answerForRow,
  answerLabel,
  buildAnswerList,
  type RubricAnswerRow,
} from "./na-answer-extract";

/** Strings below are taken verbatim from live na_rubric_items / na_anchors rows. */
const BINOMIAL_Q1 =
  "Answer: $16x^4 - 96x^3 + 216x^2 - 216x + 81$\n\nMark scheme: (M1) for correct use of $\\binom{4}{r}$ or Pascal row 1,4,6,4,1; (A1) for each correctly simplified term\n\nCommon error: Students often forget that $(-3)^r$ alternates sign.";
const A1_Q1_KEY =
  "(a) 420. (b) 330. (c) 750. (d) 30 x 25 = 750. (e) Accept any observation that (c) and (d) agree.";
const A1_Q1_SKETCH = "(a) 420 (b) 330 (c) 750 (d) 750";
/** A.1 Q4: no answer_key, and a sketch written to the marker rather than the student. */
const A1_Q4_SKETCH =
  "Student's own definitions of variable/constant/term/factor/coefficient, self-marked against the reference definitions given on the page.";

function row(over: Partial<RubricAnswerRow> & { qid: string }): RubricAnswerRow {
  return {
    base_qid: over.qid.replace(/\(.*\)$/, ""),
    question_number: 1,
    answer_key: null,
    open_rubric: null,
    marks: null,
    ...over,
  };
}

describe("extractAnswerOnly", () => {
  it("lifts the answer out of a labelled key", () => {
    expect(extractAnswerOnly(BINOMIAL_Q1)).toBe("$16x^4 - 96x^3 + 216x^2 - 216x + 81$");
  });

  it("cuts at each teacher-facing section label", () => {
    expect(extractAnswerOnly("Answer: 42 Mark scheme: (M1) for method")).toBe("42");
    expect(extractAnswerOnly("Answer: 42 Common error: sign slips")).toBe("42");
    expect(extractAnswerOnly("Answer: 42 Marking note: accept equivalents")).toBe("42");
    expect(extractAnswerOnly("Answer: 42 Misconception tested: order of operations")).toBe("42");
  });

  it("passes an unlabelled key through whole rather than guessing", () => {
    // A.1's keys have no marker saying where the answer stops. Trimming them
    // on a heuristic would hand a student a marking instruction as an answer.
    expect(extractAnswerOnly(A1_Q1_KEY)).toBe(A1_Q1_KEY);
  });

  it("collapses whitespace so a multi-line key reads as one line", () => {
    expect(extractAnswerOnly("Answer:  7.\n\n   Then 8.")).toBe("7. Then 8.");
  });

  it("returns null for absent or empty keys", () => {
    expect(extractAnswerOnly(null)).toBeNull();
    expect(extractAnswerOnly(undefined)).toBeNull();
    expect(extractAnswerOnly("")).toBeNull();
    expect(extractAnswerOnly("   ")).toBeNull();
    expect(extractAnswerOnly("Answer:   ")).toBeNull();
  });

  it("is case-insensitive about the labels", () => {
    expect(extractAnswerOnly("answer: 42 MARK SCHEME: whatever")).toBe("42");
  });
});

describe("answerForRow", () => {
  it("prefers the per-box sketch to the whole question's key", () => {
    const line = answerForRow(row({ qid: "Q1", answer_key: A1_Q1_KEY, answer_sketch: A1_Q1_SKETCH }));
    expect(line).toBe(A1_Q1_SKETCH);
  });

  it("falls back to the key where the packet has no sketches", () => {
    // Every A.2 anchor has answer_sketch NULL; its keys carry the answer.
    expect(answerForRow(row({ qid: "Q4", answer_key: "Answer: 672 Mark scheme: ..." }))).toBe("672");
  });

  it("refuses a sketch on a row with no answer_key — it is marker guidance", () => {
    // The load-bearing rule. On A.1, every box with no key carries a sketch
    // addressed to the marker, and showing it would read as an answer.
    expect(answerForRow(row({ qid: "Q4", answer_key: null, answer_sketch: A1_Q4_SKETCH }))).toBeNull();
  });

  it("falls back to the key when the sketch is blank rather than absent", () => {
    expect(answerForRow(row({ qid: "Q2", answer_key: "Answer: 7", answer_sketch: "   " }))).toBe("7");
  });

  it("collapses whitespace inside a sketch", () => {
    expect(answerForRow(row({ qid: "Q2", answer_key: "x", answer_sketch: "(a) 1\n(b) 2" }))).toBe("(a) 1 (b) 2");
  });
});

describe("answerLabel", () => {
  it("is the bare qid when the box has no part label", () => {
    expect(answerLabel(row({ qid: "Q13(b)" }))).toBe("Q13(b)");
  });

  it("appends the anchor's part label, matching the detailed view", () => {
    // A.1's Q9 box is labelled "Q9 (Part 2)" on the feedback page.
    expect(answerLabel(row({ qid: "Q9", part_label: "Part 2" }))).toBe("Q9 (Part 2)");
  });
});

describe("buildAnswerList", () => {
  it("collapses A.1's repeated subpart sketches into one line", () => {
    // Q6 and Q6(f) carry identical answer_sketch text in the live A.1 anchors.
    const sketch = "(a)-(e) same structure as Q5. (f) pi is a constant.";
    const lines = buildAnswerList([
      row({ qid: "Q6", base_qid: "Q6", answer_key: "k", answer_sketch: sketch, marks: 5 }),
      row({ qid: "Q6(f)", base_qid: "Q6", answer_key: "k", answer_sketch: sketch, marks: 2 }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].label).toBe("Q6");
  });

  it("keeps A.1's Q1 and Q1(e), whose sketches genuinely differ", () => {
    const lines = buildAnswerList([
      row({ qid: "Q1", base_qid: "Q1", answer_key: A1_Q1_KEY, answer_sketch: A1_Q1_SKETCH }),
      row({
        qid: "Q1(e)",
        base_qid: "Q1",
        answer_key: A1_Q1_KEY,
        answer_sketch: "(c) 750 (d) 750 (e) they agree.",
      }),
    ]);
    expect(lines.map((l) => l.label)).toEqual(["Q1", "Q1(e)"]);
  });

  it("does not collapse identical answers across different base questions", () => {
    const lines = buildAnswerList([
      row({ qid: "Q1", base_qid: "Q1", answer_key: "7" }),
      row({ qid: "Q2", base_qid: "Q2", answer_key: "7" }),
    ]);
    expect(lines).toHaveLength(2);
  });

  it("only collapses against the row immediately before", () => {
    const lines = buildAnswerList([
      row({ qid: "Q1", base_qid: "Q1", answer_key: "same" }),
      row({ qid: "Q1(b)", base_qid: "Q1", answer_key: "different" }),
      row({ qid: "Q1(c)", base_qid: "Q1", answer_key: "same" }),
    ]);
    expect(lines.map((l) => l.label)).toEqual(["Q1", "Q1(b)", "Q1(c)"]);
  });

  it("marks an open-rubric row as open, not as a missing answer", () => {
    const lines = buildAnswerList([
      row({ qid: "Q28", open_rubric: "Any reasoned answer.", marks: 6 }),
    ]);
    expect(lines[0]).toMatchObject({ label: "Q28", answer: null, kind: "open" });
  });

  it("marks thinking space as unmarked", () => {
    // A.1's Desmos sandbox box: no marks, no key, no open rubric.
    const lines = buildAnswerList([
      row({ qid: "ACTIVITY[MY NOTICINGS FROM THE SANDBOX]", marks: 0 }),
    ]);
    expect(lines[0]).toMatchObject({ answer: null, kind: "unmarked" });
  });

  it("never shows a marker-facing sketch as an answer", () => {
    // A.1 Q4 end to end: sketch present, key absent.
    const lines = buildAnswerList([row({ qid: "Q4", answer_sketch: A1_Q4_SKETCH, marks: 5 })]);
    expect(lines[0].answer).toBeNull();
    expect(JSON.stringify(lines)).not.toContain("self-marked");
  });

  it("carries marks through for display", () => {
    const lines = buildAnswerList([row({ qid: "Q4", answer_key: "672", marks: 5 })]);
    expect(lines[0].marks).toBe(5);
  });

  it("returns an empty list for no rows", () => {
    expect(buildAnswerList([])).toEqual([]);
  });
});
