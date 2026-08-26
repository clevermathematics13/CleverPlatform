import { describe, expect, it } from "vitest";
import { matchSegmentsToRoster, validateGradeResponse, type GradingUnit, type RosterEntry } from "./ai-grading";

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
});
