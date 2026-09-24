import { describe, it, expect } from "vitest";
import {
  BOUNDARY_SUGGESTION_MODEL,
  GRADE_BOUNDARY_PRINCIPLES,
  MAX_GENERAL_RULES,
  MAX_GUIDANCE_CHARS,
  anonymiseScores,
  buildBoundarySystemPrompt,
  buildBoundaryUserPrompt,
  checkSuggestion,
  orderGuidance,
  type BoundarySuggestion,
  type GuidanceNote,
  type SuggestionInput,
} from "./boundary-suggestion";
import { mergeSubjectScores, scoreSummary } from "./boundary-scores";

describe("the boundary suggestion request", () => {
  it("uses Opus 5", () => {
    expect(BOUNDARY_SUGGESTION_MODEL).toBe("claude-opus-5");
  });

  it("loads the policy file and puts it, then the fixed rules, in the system prompt", () => {
    expect(GRADE_BOUNDARY_PRINCIPLES).toContain("# Grade Boundary Principles");
    const system = buildBoundarySystemPrompt();
    expect(system).toContain(GRADE_BOUNDARY_PRINCIPLES.trim());
    expect(system.indexOf("=== FIXED RULES")).toBeGreaterThan(system.indexOf("Grade Boundary Principles"));
    expect(system).toContain("never award, change, recompute or question a student's marks");
    // byte-identical across calls, so the system block caches
    expect(buildBoundarySystemPrompt()).toBe(system);
  });
});

describe("what the model is told about students", () => {
  const items = [
    { id: "p1", maxMarks: 3, sectionIndex: 0, label: "1.1" },
    { id: "p2", maxMarks: 2, sectionIndex: 1, label: "2.1" },
  ];
  const scores = mergeSubjectScores(items, 2, [
    {
      subjectId: "invited-4b1f0c2e-aaaa-bbbb-cccc-1234567890ab",
      name: "Imaginary Pupil-One",
      className: "9Z",
      absent: false,
      accepted: new Map([["p1", 3]]),
      suggested: new Map([["p2", 1]]),
    },
    {
      subjectId: "0f0f0f0f-1111-2222-3333-444444444444",
      name: "Fictional Learner-Two",
      className: "9Y",
      absent: false,
      accepted: new Map([["p1", 2], ["p2", 2]]),
      suggested: null,
    },
    {
      subjectId: "absent-one",
      name: "Absent Person-Three",
      className: "9Z",
      absent: true,
      accepted: new Map(),
      suggested: null,
    },
  ]);

  const input: SuggestionInput = {
    assessment: {
      name: "Key Assessment 1",
      course: "Grade 9 Extended",
      kind: "summative",
      totalMarks: 5,
      standardsPaper: false,
      sections: [
        { label: "L1", title: "LEVEL 1 -- READ THE STRUCTURE", maxMarks: 3 },
        { label: "L2", title: "LEVEL 2 -- TRANSLATE", maxMarks: 2 },
      ],
    },
    current: { label: "Grade 9 preset (shared, not decided yet)", cutoffs: { 7: 5, 6: 4, 5: 4, 4: 3, 3: 3, 2: 2 }, decided: null },
    presets: [],
    otherAssessments: [],
    scores: { summary: scoreSummary(scores), students: anonymiseScores(scores) },
    guidance: [{ id: "g1", scope: "all", note: "A 7 needs at least 88% in Grade 9.", createdAt: "2026-09-24T10:00:00Z" }],
  };

  it("sends totals, status and section subtotals, highest first, and nothing about absent students", () => {
    expect(input.scores.students).toEqual([
      { total: 4, final: false, pendingParts: 1, neverMarkedMarks: 0, sections: [3, 1] },
      { total: 4, final: true, pendingParts: 0, neverMarkedMarks: 0, sections: [2, 2] },
    ]);
  });

  it("carries no names, ids or classes", () => {
    const prompt = buildBoundaryUserPrompt(input);
    for (const secret of ["Imaginary", "Fictional", "Absent Person", "invited-", "4b1f0c2e", "0f0f0f0f", "absent-one", "9Z", "9Y"]) {
      expect(prompt).not.toContain(secret);
    }
    expect(prompt).toContain("4 | provisional | 1 | 0 | 3 1");
    expect(prompt).toContain("[g1] GENERAL RULE, all assessments: A 7 needs at least 88% in Grade 9.");
  });
});

describe("orderGuidance", () => {
  const note = (id: string, scope: "all" | "test", createdAt: string, text = `note ${id}`): GuidanceNote => ({
    id,
    scope,
    note: text,
    createdAt,
  });

  it("puts general rules before this assessment's notes, each oldest first", () => {
    const out = orderGuidance([
      note("t2", "test", "2026-09-24T12:00:00Z"),
      note("a2", "all", "2026-09-22T00:00:00Z"),
      note("t1", "test", "2026-09-24T11:00:00Z"),
      note("a1", "all", "2026-09-21T00:00:00Z"),
    ]);
    expect(out.map((n) => n.id)).toEqual(["a1", "a2", "t1", "t2"]);
  });

  it("keeps the newest rules when there are too many, and trims and caps each note", () => {
    const many = Array.from({ length: MAX_GENERAL_RULES + 2 }, (_, i) =>
      note(`a${String(i).padStart(2, "0")}`, "all", `2026-09-${String(1 + i).padStart(2, "0")}T00:00:00Z`)
    );
    const out = orderGuidance([...many, note("long", "test", "2026-10-01T00:00:00Z", `  ${"x".repeat(MAX_GUIDANCE_CHARS + 50)}  `)]);
    expect(out.filter((n) => n.scope === "all")).toHaveLength(MAX_GENERAL_RULES);
    expect(out[0].id).toBe("a02");
    expect(out[out.length - 1].note).toHaveLength(MAX_GUIDANCE_CHARS);
    expect(orderGuidance([note("blank", "test", "2026-09-01T00:00:00Z", "   ")])).toEqual([]);
  });
});

describe("checkSuggestion", () => {
  const good: BoundarySuggestion = {
    cutoffs: { grade7: 45, grade6: 40, grade5: 35, grade4: 28, grade3: 23, grade2: 18 },
    rationale: "Kept 45/40/35; moved 4 and 3 onto empty scores.",
    levelNotes: [{ grade: 4, note: "28 keeps the five students on 29 with those on 30-34." }],
    guidanceApplied: [{ guidanceId: "g1", applied: true, how: "The 7 stays at 90%." }],
    cautions: [],
    statementDraft: "Moved the 4 to 28 and the 3 to 23.",
  };

  it("accepts a sound suggestion and returns its cut-offs", () => {
    expect(checkSuggestion(good, 50, ["g1"])).toEqual({ ok: true, cutoffs: { 7: 45, 6: 40, 5: 35, 4: 28, 3: 23, 2: 18 } });
  });

  it("rejects lines out of range or out of order", () => {
    const bad = { ...good, cutoffs: { ...good.cutoffs, grade7: 51, grade3: 28 } };
    const out = checkSuggestion(bad, 50, ["g1"]);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.problems).toEqual(["Level 7 must start between 1 and 50 marks."]);
    const unordered = checkSuggestion({ ...good, cutoffs: { ...good.cutoffs, grade3: 28 } }, 50, ["g1"]);
    expect(unordered.ok).toBe(false);
    if (!unordered.ok) expect(unordered.problems).toEqual(["Level 4 must need more marks than level 3."]);
  });

  it("insists every guidance note is reported once and none is invented", () => {
    const out = checkSuggestion(
      { ...good, guidanceApplied: [...good.guidanceApplied, { guidanceId: "g9", applied: false, how: "?" }] },
      50,
      ["g1", "g2"]
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.problems).toEqual(["Guidance note g2 was not reported.", "Guidance note g9 does not exist."]);
    }
  });

  it("needs a rationale and a statement to show the teacher", () => {
    const out = checkSuggestion({ ...good, rationale: " ", statementDraft: "" }, 50, ["g1"]);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.problems).toEqual(["The rationale is empty.", "The statement draft is empty."]);
  });
});
