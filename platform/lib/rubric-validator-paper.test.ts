/**
 * Rules 10-14: the paper as a student reads it.
 *
 * Every case here comes from a teacher reading a generated summative front to
 * back before giving it. None is a mathematical error; each costs a student
 * time they were not given.
 */
import { describe, it, expect } from "vitest";
import { validateRubric } from "./rubric-validator";
import type { AssignmentDraft } from "./assignments";

const codes = (d: AssignmentDraft, ctx = {}) => validateRubric(d, ctx).map((f) => f.code);
const find = (d: AssignmentDraft, code: string, ctx = {}) =>
  validateRubric(d, ctx).find((f) => f.code === code);

function paper(over: Partial<AssignmentDraft> = {}): AssignmentDraft {
  return {
    title: "T",
    subtitle: "S",
    instructions: ["Answer every part."],
    sections: [
      {
        heading: "LEVEL 1",
        estimatedMinutes: 10,
        questions: [
          { prompt: "Simplify $2x + 3x$.", marks: 1, answer: "$5x$", markScheme: "A1 for 5x. '6x' earns 0." },
        ],
      },
    ],
    markingPrinciples: [],
    reteachGuide: [],
    ...over,
  } as AssignmentDraft;
}

describe("rule 10 -- a question that numbers itself", () => {
  it("catches a context block naming a question number the paper does not print", () => {
    const d = paper({
      sections: [
        { heading: "LEVEL 1", estimatedMinutes: 5, questions: [{ prompt: "A", marks: 1, answer: "a", markScheme: "A1 for a. Else 0." }] },
        { heading: "LEVEL 2", estimatedMinutes: 5, questions: [
          { prompt: "Context for Q6. A stall sells melons.", marks: 1, answer: "b", markScheme: "A1 for b. Else 0." },
        ] },
      ],
    });
    const f = find(d, "question-numbers-itself");
    expect(f?.severity).toBe("block");
    // The label must be the one on the page, not the bridge's global number.
    expect(f?.part).toBe("Q2");          // the list keeps one convention
    expect(f?.message).toContain("2.1");   // ... and the message says where to look
  });

  it("leaves a reference to a part letter alone", () => {
    const d = paper({
      sections: [{ heading: "L", estimatedMinutes: 5, questions: [
        { prompt: "Hence use your expression from part (a).", marks: 1, answer: "x", markScheme: "A1 for x. Else 0." },
      ] }],
    });
    expect(codes(d)).not.toContain("question-numbers-itself");
  });
});

describe("rule 11 -- a subpart that numbers itself", () => {
  it("catches a prompt that opens with its own letter", () => {
    const d = paper({
      sections: [{ heading: "L", estimatedMinutes: 5, questions: [
        { prompt: "Look at the expression.", marks: 2, subparts: [
          { prompt: "(a) Write the number of terms.", marks: 1, answer: "3", markScheme: "A1 for 3. Else 0." },
          { prompt: "Write the variable.", marks: 1, answer: "k", markScheme: "A1 for k. Else 0." },
        ] },
      ] }],
    });
    const f = find(d, "subpart-numbers-itself");
    expect(f?.severity).toBe("block");
    expect(f?.part).toBe("Q1(a)");
  });
});

describe("rule 12 -- an Answer line the parts do not have", () => {
  const instructions = ["Write your final answer on the line marked Answer."];

  it("catches the promise when parts render no Answer line", () => {
    const f = find(paper({ instructions }), "instruction-promises-missing-answer-line");
    expect(f?.severity).toBe("block");
    expect(f?.message).toContain("1 of 1 parts");
  });

  it("stays quiet when every part requires working", () => {
    const d = paper({
      instructions,
      sections: [{ heading: "L", estimatedMinutes: 5, questions: [
        { prompt: "Solve it.", marks: 1, answer: "5", markScheme: "A1 for 5. A bare answer with no working earns 0.", requiresWorking: true },
      ] }],
    });
    expect(codes(d)).not.toContain("instruction-promises-missing-answer-line");
  });

  it("stays quiet when the instructions make no such promise", () => {
    expect(codes(paper())).not.toContain("instruction-promises-missing-answer-line");
  });
});

describe("rule 13 -- the paper has to fit the time", () => {
  const timed = (mins: number) =>
    paper({ sections: [{ heading: "L", estimatedMinutes: mins, questions: [
      { prompt: "Do it.", marks: 1, answer: "x", markScheme: "A1 for x. Else 0." },
    ] }] });

  it("blocks a paper that cannot be finished in its own time allowance", () => {
    const f = find(timed(60), "time-budget-exceeded", { timeAllowedMinutes: 50 });
    expect(f?.severity).toBe("block");
    expect(f?.message).toContain("60 minutes of work in a 50-minute paper");
  });

  it("warns when there is no room left to check", () => {
    const f = find(timed(46), "time-budget-tight", { timeAllowedMinutes: 50 });
    expect(f?.severity).toBe("warn");
    expect(f?.message).toContain("4 minutes");
  });

  it("accepts a paper that leaves the usual fifth of the time", () => {
    expect(codes(timed(40), { timeAllowedMinutes: 50 })).not.toContain("time-budget-tight");
  });

  it("says nothing at all without a time allowed -- a formative has none", () => {
    const out = codes(timed(46));
    expect(out).not.toContain("time-budget-tight");
    expect(out).not.toContain("time-budget-exceeded");
  });
});

describe("rule 14 -- an expression asked for right after a substitution", () => {
  const q = (subparts: Array<{ prompt: string; marks: number; answer: string; markScheme: string }>) =>
    paper({ sections: [{ heading: "L", estimatedMinutes: 5, questions: [{ prompt: "Context.", marks: 3, subparts }] }] });

  it("catches the ambiguity", () => {
    const d = q([
      { prompt: "Calculate the total when $x = 5$ and $y = 7$.", marks: 1, answer: "83", markScheme: "A1 for 83. Else 0." },
      { prompt: "The stall takes 10% off. Write an expression for the discounted total.", marks: 1, answer: "0.9", markScheme: "A1. Else 0." },
    ]);
    const f = find(d, "expression-after-substitution");
    expect(f?.severity).toBe("warn");
    expect(f?.part).toBe("Q1(b)");
  });

  it("is satisfied by three words", () => {
    const d = q([
      { prompt: "Calculate the total when $x = 5$ and $y = 7$.", marks: 1, answer: "83", markScheme: "A1 for 83. Else 0." },
      { prompt: "In terms of $x$ and $y$, write an expression for the discounted total.", marks: 1, answer: "0.9", markScheme: "A1. Else 0." },
    ]);
    expect(codes(d)).not.toContain("expression-after-substitution");
  });

  it("does not fire across a question boundary", () => {
    const d = paper({
      sections: [{ heading: "L", estimatedMinutes: 5, questions: [
        { prompt: "Evaluate when $x = 2$.", marks: 1, answer: "4", markScheme: "A1 for 4. Else 0." },
        { prompt: "Write an expression for the perimeter.", marks: 1, answer: "2l", markScheme: "A1. Else 0." },
      ] }],
    });
    expect(codes(d)).not.toContain("expression-after-substitution");
  });
});

describe("rule 12 -- the wording that fixes it is not itself flagged", () => {
  it("accepts a promise that is qualified", () => {
    // The fix for the defect must not trip the rule that found it, or authors
    // are pushed straight back to the wording that was wrong.
    const d = paper({
      instructions: [
        "Write your final answer in the space provided, and on the line marked Answer where one is given.",
      ],
    });
    expect(codes(d)).not.toContain("instruction-promises-missing-answer-line");
  });
});
