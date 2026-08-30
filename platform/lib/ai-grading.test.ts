import { describe, expect, it } from "vitest";
import {
  AA_HL_PAPER_2_NUMERICAL_ACCURACY_POLICY,
  GRADING_SYSTEM_PROMPT,
  buildGradingSystemPrompt,
  isAaHlPaper2,
  matchSegmentsToRoster,
  validateGradeResponse,
  type GradingUnit,
  type RosterEntry,
} from "./ai-grading";

function unit(overrides: Partial<GradingUnit> = {}): GradingUnit {
  return {
    testItemId: "item-1",
    questionNumber: 1,
    partLabel: "",
    maxMarks: 7,
    questionCode: "Q1",
    questionLatex: "",
    markscheme: "M1 A1 A1 M1 A1 R1 A1",
    markschemeSource: "part_latex",
    commandTerms: [],
    subtopicCodes: [],
    curriculum: [],
    level: null,
    paper: null,
    ...overrides,
  };
}

function segment(label: string) {
  return { label, pages: [1], confidence: "high" as const, note: "" };
}

describe("matchSegmentsToRoster", () => {
  it("matches a cover-page name that differs only by a nickname/full-name split", () => {
    const roster: RosterEntry[] = [{ profileId: "s1", displayName: "Luciana" }];
    const [result] = matchSegmentsToRoster([segment("Luciana Rojas More")], roster);
    expect(result.matchedStudentId).toBe("s1");
  });

  it("matches a single-edit handwriting misread of the last name even with an unrelated first name", () => {
    const roster: RosterEntry[] = [{ profileId: "s1", displayName: "Salim Fellah" }];
    const [result] = matchSegmentsToRoster([segment("John Felloh")], roster);
    expect(result.matchedStudentId).toBe("s1");
  });

  it("matches a two-edit misread of a 6-letter surname when it's the only candidate", () => {
    const roster: RosterEntry[] = [{ profileId: "s1", displayName: "Salim Fellah" }];
    const [result] = matchSegmentsToRoster([segment("John Kelloh")], roster);
    expect(result.matchedStudentId).toBe("s1");
  });

  it("matches a single-edit misread within a name that also matches exactly on the other token", () => {
    const roster: RosterEntry[] = [{ profileId: "s1", displayName: "Seungjun Lee" }];
    const [result] = matchSegmentsToRoster([segment("Seungjin Lee")], roster);
    expect(result.matchedStudentId).toBe("s1");
  });

  it("does not propose a match when two roster entries tie on a shared first name", () => {
    const roster: RosterEntry[] = [
      { profileId: "s1", displayName: "Maria Lopez" },
      { profileId: "s2", displayName: "Maria Garcia" },
    ];
    const [result] = matchSegmentsToRoster([segment("Maria")], roster);
    expect(result.matchedStudentId).toBeNull();
  });

  it("prefers the fuzzy first-name match over a generic shared-last-name-only candidate", () => {
    const roster: RosterEntry[] = [
      { profileId: "s1", displayName: "Seungjun Lee" },
      { profileId: "s2", displayName: "David Lee" },
    ];
    const [result] = matchSegmentsToRoster([segment("Seungjin Lee")], roster);
    expect(result.matchedStudentId).toBe("s1");
  });

  it("uses an exact short-token match (a last-initial) to disambiguate, without fuzzing short tokens", () => {
    const roster: RosterEntry[] = [
      { profileId: "s1", displayName: "Nicolas B" },
      { profileId: "s2", displayName: "Nicolas C" },
    ];
    const [result] = matchSegmentsToRoster([segment("Nicolas C")], roster);
    expect(result.matchedStudentId).toBe("s2");
  });

  it("still matches on an exact full-name equal string", () => {
    const roster: RosterEntry[] = [{ profileId: "s1", displayName: "Camilla Fernandez" }];
    const [result] = matchSegmentsToRoster([segment("Camilla Fernandez")], roster);
    expect(result.matchedStudentId).toBe("s1");
  });

  it("returns no match when nothing overlaps", () => {
    const roster: RosterEntry[] = [{ profileId: "s1", displayName: "Alejandro Rosell" }];
    const [result] = matchSegmentsToRoster([segment("Totally Different")], roster);
    expect(result.matchedStudentId).toBeNull();
  });

  // Regression coverage against a real class roster (13 students, names
  // changed) where the earlier scoring formula produced both false
  // negatives (Luciana, Seungjun, Fellah) and — the risk cutting the other
  // way — a shared surname ("Rojas", held by two different students) that
  // a looser matcher could confuse.
  describe("against a real 13-student roster", () => {
    const roster: RosterEntry[] = [
      { profileId: "1", displayName: "Alejandro Rosell" },
      { profileId: "2", displayName: "Camilla Cohen" },
      { profileId: "3", displayName: "Carlos Rojas" },
      { profileId: "4", displayName: "Gael Castrillon" },
      { profileId: "5", displayName: "Gustavo Sui" },
      { profileId: "6", displayName: "Julio Bravo" },
      { profileId: "7", displayName: "Luciana Rojas" },
      { profileId: "8", displayName: "Minjun Choi" },
      { profileId: "9", displayName: "Nicolas Carriquiry" },
      { profileId: "10", displayName: "Pedro Costa" },
      { profileId: "11", displayName: "Salim Fellah" },
      { profileId: "12", displayName: "Seungjun Lee" },
      { profileId: "13", displayName: "Wyatt Hawes" },
    ];

    it("every student's own full name self-matches", () => {
      for (const target of roster) {
        const [result] = matchSegmentsToRoster([segment(target.displayName)], roster);
        expect(result.matchedStudentId).toBe(target.profileId);
      }
    });

    it("does not guess when only the shared surname 'Rojas' is legible", () => {
      const [result] = matchSegmentsToRoster([segment("Rojas")], roster);
      expect(result.matchedStudentId).toBeNull();
    });

    it("resolves real OCR misreads seen in production", () => {
      const [kelloh] = matchSegmentsToRoster([segment("John Kelloh")], roster);
      expect(kelloh.matchedStudentId).toBe("11"); // Salim Fellah

      const [castrillon] = matchSegmentsToRoster([segment("Paul Castrillon")], roster);
      expect(castrillon.matchedStudentId).toBe("4"); // Gael Castrillon
    });
  });
});

describe("validateGradeResponse", () => {
  // Regression: a real production result had suggestedMarks: 6 while its own
  // mark_breakdown awarded only 5 tokens (M1, A1, A1, R1, A1 -- the part (c)
  // M1/A1 pair was correctly marked not-awarded in the breakdown, but
  // suggestedMarks wasn't updated to match). 20 of 267 stored results had
  // this same self-inconsistency. The model is told in the system prompt
  // that awarded tokens must sum to suggestedMarks; this is the check that
  // catches it when the model doesn't follow that instruction.
  it("corrects suggestedMarks to the mark breakdown's awarded count when they disagree", () => {
    const raw = JSON.stringify({
      items: [
        {
          testItemId: "item-1",
          suggestedMarks: 6,
          confidence: "high",
          workFound: true,
          markBreakdown: [
            { token: "M1", awarded: true, note: "" },
            { token: "A1", awarded: true, note: "" },
            { token: "A1", awarded: true, note: "" },
            { token: "M1", awarded: false, note: "" },
            { token: "A1", awarded: false, note: "" },
            { token: "R1", awarded: true, note: "" },
            { token: "A1", awarded: true, note: "" },
          ],
          reasoning: "",
          evidence: "",
        },
      ],
    });

    const result = validateGradeResponse(raw, [unit()]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.outcome.grades).toHaveLength(1);
    expect(result.outcome.grades[0].clampedMarks).toBe(5);
    expect(result.outcome.grades[0].confidence).toBe("low");
    expect(result.outcome.warnings.some((w) => w.includes("its own breakdown only awards"))).toBe(true);
  });

  it("leaves suggestedMarks untouched when it already matches the breakdown", () => {
    const raw = JSON.stringify({
      items: [
        {
          testItemId: "item-1",
          suggestedMarks: 2,
          confidence: "high",
          workFound: true,
          markBreakdown: [
            { token: "M1", awarded: true, note: "" },
            { token: "A1", awarded: true, note: "" },
          ],
          reasoning: "",
          evidence: "",
        },
      ],
    });

    const result = validateGradeResponse(raw, [unit({ maxMarks: 2 })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.outcome.grades[0].clampedMarks).toBe(2);
    expect(result.outcome.grades[0].confidence).toBe("high");
    expect(result.outcome.warnings).toHaveLength(0);
  });

  // Case 13: a question-specific accepted alternative overrides the general
  // rule -- validateGradeResponse never re-derives the mark scheme's own
  // required precision itself, only checks the model's own numericCheck
  // report against it, so a mark scheme that accepts a different value is
  // reflected by the model reporting a different (correct) referenceValue,
  // not by anything in this function needing special-case logic.
  it("corrects an awarded numeric accuracy token when the deterministic check disagrees", () => {
    const raw = JSON.stringify({
      items: [
        {
          testItemId: "item-1",
          suggestedMarks: 3,
          confidence: "high",
          workFound: true,
          markBreakdown: [
            { token: "M1", awarded: true, note: "" },
            {
              token: "A1",
              awarded: true,
              note: "a = 0.81 (acceptable rounding of 0.805)",
              numericCheck: {
                reportedValue: "0.81",
                referenceValue: "0.805084",
                precisionType: "sf",
                precisionDigits: 3,
              },
            },
            { token: "A1", awarded: true, note: "" },
          ],
          reasoning: "",
          evidence: "",
        },
      ],
    });

    const result = validateGradeResponse(raw, [unit({ maxMarks: 3 })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The Pedro Costa regression: a=0.81 (2 s.f.) against a required a=0.805
    // (3 s.f.) is a real precision error the model called "acceptable
    // rounding" across five separate production grading runs even after
    // being told not to invent that tolerance -- this is the backstop that
    // catches it regardless of what the model's own note claims.
    expect(result.outcome.grades[0].clampedMarks).toBe(2);
    expect(result.outcome.grades[0].confidence).toBe("low");
    expect(result.outcome.warnings.some((w) => w.includes("deterministic accuracy re-check"))).toBe(true);
  });

  it("leaves an awarded numeric accuracy token alone when the deterministic check agrees", () => {
    const raw = JSON.stringify({
      items: [
        {
          testItemId: "item-1",
          suggestedMarks: 1,
          confidence: "high",
          workFound: true,
          markBreakdown: [
            {
              token: "A1",
              awarded: true,
              note: "",
              numericCheck: {
                reportedValue: "8.52",
                referenceValue: "8.51693",
                precisionType: "sf",
                precisionDigits: 3,
              },
            },
          ],
          reasoning: "",
          evidence: "",
        },
      ],
    });

    const result = validateGradeResponse(raw, [unit({ maxMarks: 1 })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.outcome.grades[0].clampedMarks).toBe(1);
    expect(result.outcome.grades[0].confidence).toBe("high");
  });

  // The Luciana Q4(b) regression: the mark scheme accepted two different
  // final values from two valid rounding paths ("y = 261, (y = 260 from
  // 3sf)"). The student's reported "260" matched one of them, but the
  // model reported only the OTHER path's value as referenceValue, which
  // made a genuinely correct answer fail the deterministic re-check and
  // get silently withheld. alternativeReferenceValues fixes this by
  // letting the model list every accepted value.
  it("leaves an awarded numeric accuracy token alone when it matches an alternative reference value", () => {
    const raw = JSON.stringify({
      items: [
        {
          testItemId: "item-1",
          suggestedMarks: 1,
          confidence: "high",
          workFound: true,
          markBreakdown: [
            {
              token: "A1",
              awarded: true,
              note: "y = 260 is accepted per mark scheme (260 from 3sf values)",
              numericCheck: {
                reportedValue: "260",
                referenceValue: "261.083",
                alternativeReferenceValues: ["260.409"],
                precisionType: "sf",
                precisionDigits: 3,
              },
            },
          ],
          reasoning: "",
          evidence: "",
        },
      ],
    });

    const result = validateGradeResponse(raw, [unit({ maxMarks: 1 })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.outcome.grades[0].clampedMarks).toBe(1);
    expect(result.outcome.grades[0].confidence).toBe("high");
    expect(result.outcome.warnings).toHaveLength(0);
  });
});

describe("isAaHlPaper2", () => {
  it("matches only the AA / AHL / paper 2 combination", () => {
    expect(isAaHlPaper2({ curriculum: ["AA"], level: "AHL", paper: 2 })).toBe(true);
    expect(isAaHlPaper2({ curriculum: ["AA"], level: "AHL", paper: 1 })).toBe(false);
    expect(isAaHlPaper2({ curriculum: ["AA"], level: "SL", paper: 2 })).toBe(false);
    expect(isAaHlPaper2({ curriculum: ["AI"], level: "AHL", paper: 2 })).toBe(false);
    expect(isAaHlPaper2({ curriculum: [], level: null, paper: null })).toBe(false);
  });
});

describe("buildGradingSystemPrompt", () => {
  it("returns the base prompt unchanged when no unit is AA HL Paper 2", () => {
    const prompt = buildGradingSystemPrompt([unit({ curriculum: ["AA"], level: "SL", paper: 2 })]);
    expect(prompt).toBe(GRADING_SYSTEM_PROMPT);
  });

  it("appends the numerical-accuracy policy when any unit is AA HL Paper 2", () => {
    const prompt = buildGradingSystemPrompt([
      unit({ testItemId: "item-1", curriculum: ["AA"], level: "SL", paper: 2 }),
      unit({ testItemId: "item-2", curriculum: ["AA"], level: "AHL", paper: 2 }),
    ]);
    expect(prompt.startsWith(GRADING_SYSTEM_PROMPT)).toBe(true);
    expect(prompt).toContain(AA_HL_PAPER_2_NUMERICAL_ACCURACY_POLICY);
    expect(AA_HL_PAPER_2_NUMERICAL_ACCURACY_POLICY.length).toBeGreaterThan(0);
  });

  it("policy content is actually loaded from grading_policies/, not empty", () => {
    expect(AA_HL_PAPER_2_NUMERICAL_ACCURACY_POLICY).toContain("three significant figures");
    expect(AA_HL_PAPER_2_NUMERICAL_ACCURACY_POLICY).toContain("numericCheck");
  });
});
