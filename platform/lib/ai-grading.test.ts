import { describe, expect, it } from "vitest";
import {
  rematchUnmatchedSegments,
  AA_HL_PAPER_2_NUMERICAL_ACCURACY_POLICY,
  G9_FORMATIVE_ASSESSMENT_MARKING_PRINCIPLES,
  G9_STANDARD_LEVEL_MARKING_PRINCIPLES,
  GRADING_SYSTEM_PROMPT,
  MATHMEDIC_ACTIVITY_MARKING_PRINCIPLES,
  buildActivityRubricBlock,
  buildGradingSystemPrompt,
  buildGradingUserPrompt,
  buildStandardsRubricBlock,
  composeQuestionText,
  isActivity,
  isStandardsReferenced,
  isAaHlPaper2,
  isCustomAssessment,
  isImpliedToken,
  matchSegmentsToRoster,
  summarizeCoverage,
  validateGradeResponse,
  type GradingUnit,
  type RosterEntry,
} from "./ai-grading";
import { KA1_UNIT1_ITEMS, KA1_UNIT1_RUBRIC } from "./fixtures/g9-standard-ka1-unit1";
import { EXPLORATION_1_1_ITEMS, EXPLORATION_1_1_RUBRIC } from "./fixtures/mathmedic-exploration-1-1";
import { strandForItem } from "./standards-rubric";
import { targetsForItem } from "./activity-rubric";

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

describe("rematchUnmatchedSegments", () => {
  const proposed = (label: string, matchedStudentId: string | null = null) => ({
    label,
    pages: [1],
    confidence: "high" as const,
    note: "",
    matchedStudentId,
    matchedStudentName: matchedStudentId ? "Someone" : null,
  });

  it("fills in matches that a newly recorded alias now makes possible, leaving matched rows alone", () => {
    const roster: RosterEntry[] = [
      { profileId: "s1", displayName: "Gyuwon Kim", aliases: ["Nicole Kum"] },
      { profileId: "s2", displayName: "Liam Seminario" },
    ];
    const { segments, changed } = rematchUnmatchedSegments(
      [proposed("Nicole Kum"), proposed("Liam Seminario", "s2"), proposed("Nobody Here")],
      roster
    );
    expect(changed).toBe(true);
    expect(segments[0]).toMatchObject({ matchedStudentId: "s1", matchedStudentName: "Gyuwon Kim" });
    expect(segments[1]).toMatchObject({ matchedStudentId: "s2", matchedStudentName: "Someone" });
    expect(segments[2].matchedStudentId).toBeNull();
  });

  it("reports no change when nothing new matches", () => {
    const { segments, changed } = rematchUnmatchedSegments([proposed("Nobody Here")], [
      { profileId: "s1", displayName: "Gyuwon Kim" },
    ]);
    expect(changed).toBe(false);
    expect(segments[0].matchedStudentId).toBeNull();
  });
});

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

  it("matches a teacher-confirmed alias exactly, beating another student who ties on the first name", () => {
    const roster: RosterEntry[] = [
      { profileId: "s1", displayName: "Arianna Cortes", aliases: ["Arianna C"] },
      { profileId: "s2", displayName: "Arianna Bonfil" },
    ];
    const [result] = matchSegmentsToRoster([segment("Arianna C")], roster);
    expect(result.matchedStudentId).toBe("s1");
    expect(result.matchedStudentName).toBe("Arianna Cortes");
  });

  it("matches a misread surname recorded as an alias that fuzzy matching alone would not reach", () => {
    const roster: RosterEntry[] = [
      { profileId: "s1", displayName: "Galo Masias", aliases: ["Galo Mafiol"] },
      { profileId: "s2", displayName: "Galo Perez" },
    ];
    const [result] = matchSegmentsToRoster([segment("Galo Mafiol")], roster);
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

  // Regression: a real cover page. Vicente wrote his name with a looped V
  // and an n whose arch opened; Haiku read it as "Nicolite", which plain
  // Levenshtein puts four edits from "vicente" (two allowed for an
  // eight-letter word). Every one of those edits is a known handwriting
  // confusion (n/v, o/e, li/n), so the handwriting-aware distance fits
  // it inside the budget -- against the whole class, not just Vicente.
  describe("handwriting-aware misreads against a real 9-student roster (names changed)", () => {
    const roster: RosterEntry[] = [
      { profileId: "1", displayName: "Diego Figueroa" },
      { profileId: "2", displayName: "Yani Shi" },
      { profileId: "3", displayName: "Vicente Alarcon" },
      { profileId: "4", displayName: "Karolina Ferguson" },
      { profileId: "5", displayName: "Benjamin Arias" },
      { profileId: "6", displayName: "Arianna Bonfil" },
      { profileId: "7", displayName: "Vania De Los Heros" },
      { profileId: "8", displayName: "Emilia Duarte" },
      { profileId: "9", displayName: "Agustina Fernandez" },
    ];

    it("matches 'Nicolite' to Vicente", () => {
      const [result] = matchSegmentsToRoster([segment("Nicolite")], roster);
      expect(result.matchedStudentId).toBe("3");
    });

    it("matches a first name whose n was read as u", () => {
      const [result] = matchSegmentsToRoster([segment("Beujamin Arias")], roster);
      expect(result.matchedStudentId).toBe("5");
    });

    it("does not stretch to a different name of the same length", () => {
      // "nicolas" is still four edits from "vicente" -- l/n, a/t and s/e
      // are not confusions -- and matches nobody here.
      const [result] = matchSegmentsToRoster([segment("Nicolas")], roster);
      expect(result.matchedStudentId).toBeNull();
    });

    it("does not let the discount confuse Vania with Vicente", () => {
      const [vania] = matchSegmentsToRoster([segment("Vania")], roster);
      expect(vania.matchedStudentId).toBe("7");
      const [vicente] = matchSegmentsToRoster([segment("Vicente")], roster);
      expect(vicente.matchedStudentId).toBe("3");
    });

    it("every student's own full name still self-matches", () => {
      for (const target of roster) {
        const [result] = matchSegmentsToRoster([segment(target.displayName)], roster);
        expect(result.matchedStudentId).toBe(target.profileId);
      }
    });
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

  // The disagreement is not symmetric. A token wrongly flagged awarded
  // INVENTS a mark; a token wrongly flagged not-awarded merely withholds one.
  // Measured over a full class the rule fired 21 times, and both of the two
  // upward corrections were wrong -- in each the model's own suggestedMarks
  // was right and a breakdown token was not, with the prose reasoning siding
  // with suggestedMarks. Both put unearned marks into Clev's Marks.
  it("never raises a mark to match a breakdown that awards more than the model proposed", () => {
    const raw = JSON.stringify({
      items: [
        {
          testItemId: "item-1",
          suggestedMarks: 1,
          confidence: "high",
          workFound: true,
          markBreakdown: [
            { token: "M1", awarded: true, note: "Both expressions substituted" },
            { token: "A1", awarded: true, note: "Correct values: 108 and 156" },
          ],
          reasoning: "The student made an arithmetic error on the first expression.",
          evidence: "",
        },
      ],
    });

    const result = validateGradeResponse(raw, [unit({ maxMarks: 2 })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The model's own number stands; the breakdown does not get to add a mark.
    expect(result.outcome.grades[0].clampedMarks).toBe(1);
    expect(result.outcome.grades[0].confidence).toBe("low");
    expect(
      result.outcome.warnings.some((w) => w.includes("never used to raise a mark"))
    ).toBe(true);
    // It must not report the downward correction's wording, which would read
    // as "only awards 2" for a breakdown that awards MORE than was proposed.
    expect(
      result.outcome.warnings.some((w) => w.includes("its own breakdown only awards"))
    ).toBe(false);
  });

  // The two upward paths can collide in one breakdown: a token this pass
  // granted deterministically (legitimate, +1) alongside a token the model
  // itself wrongly flagged awarded (phantom). The grant must still land and
  // the phantom must not.
  it("raises only by what it granted when a real grant and a phantom token collide", () => {
    const raw = JSON.stringify({
      items: [
        {
          testItemId: "item-1",
          suggestedMarks: 0,
          confidence: "high",
          workFound: true,
          markBreakdown: [
            {
              token: "A1",
              awarded: false,
              note: "Value is incorrect.",
              numericCheck: {
                reportedValue: "8.515",
                referenceValue: "8.51693",
                precisionType: "sf",
                precisionDigits: 3,
              },
            },
            { token: "M1", awarded: true, note: "phantom: model proposed 0 marks overall" },
          ],
          reasoning: "A0.",
          evidence: "8.515",
        },
      ],
    });

    const result = validateGradeResponse(raw, [unit({ maxMarks: 2 })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const grade = result.outcome.grades[0];
    // 2 tokens read as awarded, but only 1 of them is this pass's own doing,
    // so the mark rises by exactly 1 -- not to 2.
    expect(grade.item.markBreakdown[0].awarded).toBe(true);
    expect(grade.clampedMarks).toBe(1);
    expect(grade.confidence).toBe("low");
    expect(
      result.outcome.warnings.some((w) => w.includes("granted on deterministic re-check"))
    ).toBe(true);
    expect(
      result.outcome.warnings.some((w) => w.includes("never used to raise a mark"))
    ).toBe(true);
  });

  it("still lowers a mark when the breakdown awards fewer tokens than proposed", () => {
    const raw = JSON.stringify({
      items: [
        {
          testItemId: "item-1",
          suggestedMarks: 2,
          confidence: "high",
          workFound: true,
          markBreakdown: [
            { token: "A1", awarded: true, note: "" },
            { token: "A1", awarded: false, note: "product written as d² instead of 1" },
          ],
          reasoning: "Second A1 not awarded.",
          evidence: "",
        },
      ],
    });

    const result = validateGradeResponse(raw, [unit({ maxMarks: 2 })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.outcome.grades[0].clampedMarks).toBe(1);
    expect(result.outcome.grades[0].confidence).toBe("low");
    expect(
      result.outcome.warnings.some((w) => w.includes("its own breakdown only awards"))
    ).toBe(true);
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

  // The correlation-coefficient case: r = 0.946591... is required as 0.947
  // (3 s.f.). A student who writes "0.95" (2 s.f.) has under-precise
  // evidence for the A mark, but that value is itself exact evidence the
  // correct method was used (see GRADING_SYSTEM_PROMPT rule 14). M1 A0.
  it("keeps a Method mark awarded via impliedMethodEvidence when the value is a correct-but-under-precise rounding", () => {
    const raw = JSON.stringify({
      items: [
        {
          testItemId: "item-1",
          suggestedMarks: 1,
          confidence: "medium",
          workFound: true,
          markBreakdown: [
            {
              token: "(M1)",
              awarded: true,
              note: "0.95 is 0.946591... to 2 s.f.: sufficient evidence of the correct method",
              impliedMethodEvidence: {
                reportedValue: "0.95",
                referenceValue: "0.946591",
                precisionType: "sf",
                precisionDigits: 3,
              },
            },
            {
              token: "A1",
              awarded: false,
              note: "0.95 has only 2 s.f.; 3 are required",
              numericCheck: {
                reportedValue: "0.95",
                referenceValue: "0.946591",
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

    const result = validateGradeResponse(raw, [unit({ maxMarks: 2 })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // M1 stays awarded (implied-method evidence holds), A1 stays withheld
    // (the model's own, correct, decision) -> 1/2, not 0/2.
    expect(result.outcome.grades[0].clampedMarks).toBe(1);
    expect(result.outcome.warnings).toHaveLength(0);
  });

  it("withdraws a Method mark whose claimed implied-method evidence doesn't actually hold", () => {
    const raw = JSON.stringify({
      items: [
        {
          testItemId: "item-1",
          suggestedMarks: 1,
          confidence: "high",
          workFound: true,
          markBreakdown: [
            {
              // "0.96" is merely close to 0.946591..., not a rounding of it
              // at any precision -- this is the over-generalization the
              // deterministic check exists to catch (model wrongly treated
              // a nearby-but-different value as if it were proof of method).
              token: "(M1)",
              awarded: true,
              note: "0.96 is close to the correct value",
              impliedMethodEvidence: {
                reportedValue: "0.96",
                referenceValue: "0.946591",
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

    expect(result.outcome.grades[0].clampedMarks).toBe(0);
    expect(
      result.outcome.warnings.some((w) => w.includes("implied-method evidence does not hold"))
    ).toBe(true);
  });

  it("does not touch an ordinary Method mark with no impliedMethodEvidence attached", () => {
    const raw = JSON.stringify({
      items: [
        {
          testItemId: "item-1",
          suggestedMarks: 1,
          confidence: "high",
          workFound: true,
          markBreakdown: [{ token: "M1", awarded: true, note: "explicit correct method shown" }],
          reasoning: "",
          evidence: "",
        },
      ],
    });

    const result = validateGradeResponse(raw, [unit({ maxMarks: 1 })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.outcome.grades[0].clampedMarks).toBe(1);
    expect(result.outcome.warnings).toHaveLength(0);
  });

  // The regression-prediction case: mark scheme shows an intermediate
  // "2.65708 (A1)" then a final "y = 2.7 A1" requiring 1 d.p. A student who
  // writes "2.657" for the intermediate step and "2.7" for the final answer
  // should get both A marks -- the mark scheme's displayed 2.65708 is a
  // reference value, not a required digit-for-digit match (rule 15).
  it("awards an intermediate accuracy mark whose value is a correct rounding of the reference, not an exact string match", () => {
    const raw = JSON.stringify({
      items: [
        {
          testItemId: "item-1",
          suggestedMarks: 3,
          confidence: "high",
          workFound: true,
          markBreakdown: [
            { token: "M1", awarded: true, note: "substituted x = 3.7 into the regression equation" },
            {
              token: "(A1)",
              awarded: true,
              note: "2.657 is 2.65708... to 3 d.p.: an acceptable intermediate value",
              intermediateValueCheck: {
                reportedValue: "2.657",
                referenceValue: "2.65708",
                precisionType: "dp",
                precisionDigits: 5,
              },
            },
            {
              token: "A1",
              awarded: true,
              note: "2.7 matches the required final answer to 1 d.p.",
              numericCheck: {
                reportedValue: "2.7",
                referenceValue: "2.65708",
                precisionType: "dp",
                precisionDigits: 1,
              },
            },
          ],
          reasoning: "",
          evidence: "",
        },
      ],
    });

    const result = validateGradeResponse(raw, [unit({ maxMarks: 3 })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.outcome.grades[0].clampedMarks).toBe(3);
    expect(result.outcome.warnings).toHaveLength(0);
  });

  it("withdraws an UNBRACKETED intermediate accuracy mark whose claimed value is not a valid rounding of the reference", () => {
    const raw = JSON.stringify({
      items: [
        {
          testItemId: "item-1",
          suggestedMarks: 1,
          confidence: "high",
          workFound: true,
          markBreakdown: [
            {
              // 2.65708 rounds to 2.66 at 2 d.p., not 2.65 -- "2.65" is a
              // truncation, not a rounding, so this claim doesn't hold. An
              // unbracketed "A1" has no rule-13 implied-mark leniency, so
              // this deterministic check applies in full.
              token: "A1",
              awarded: true,
              note: "2.65 is close enough to the reference value",
              intermediateValueCheck: {
                reportedValue: "2.65",
                referenceValue: "2.65708",
                precisionType: "dp",
                precisionDigits: 5,
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

    expect(result.outcome.grades[0].clampedMarks).toBe(0);
    expect(
      result.outcome.warnings.some((w) => w.includes("intermediate value is not a valid rounding"))
    ).toBe(true);
  });

  // The Q3(b) production case: the mark scheme's intermediate accuracy mark
  // was BRACKETED ("(A1)"), so rule 13's implied-mark leniency applies on
  // top of rule 15 -- a correct final result is enough to imply it even
  // when the student's own intermediate figure (crossed-out working, or an
  // approximate value) isn't itself a clean rounding of the reference. The
  // deterministic intermediateValueCheck re-check must not veto that: it is
  // scoped to unbracketed tokens only.
  it("does not withdraw a BRACKETED intermediate accuracy mark even when its own value fails the rounding check", () => {
    const raw = JSON.stringify({
      items: [
        {
          testItemId: "item-1",
          suggestedMarks: 3,
          confidence: "medium",
          workFound: true,
          markBreakdown: [
            { token: "(M1)", awarded: true, note: "Substitution into their equation evidenced by the final answer." },
            {
              // "2.6857" is not an exact rounding of "2.65708" at any
              // precision -- would fail the same check an unbracketed
              // token is held to -- but this token is bracketed, so rule
              // 13's broader implied-by-final-result leniency governs.
              token: "(A1)",
              awarded: true,
              note: "2.6857 is the student's intermediate working; the correct final answer 2.7 implies the substitution step was done.",
              intermediateValueCheck: {
                reportedValue: "2.6857",
                referenceValue: "2.65708",
                precisionType: "dp",
                precisionDigits: 4,
              },
            },
            {
              token: "A1",
              awarded: true,
              note: "2.7 is correct to the required 1 decimal place.",
              numericCheck: { reportedValue: "2.7", referenceValue: "2.65708", precisionType: "dp", precisionDigits: 1 },
            },
          ],
          reasoning: "",
          evidence: "",
        },
      ],
    });

    const result = validateGradeResponse(raw, [unit({ maxMarks: 3 })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.outcome.grades[0].clampedMarks).toBe(3);
    expect(result.outcome.grades[0].item.markBreakdown[1].awarded).toBe(true);
    expect(
      result.outcome.warnings.some((w) => w.includes("intermediate value is not a valid rounding"))
    ).toBe(false);
  });

  // Confirms an override's correction is visible in the item's summary
  // `reasoning`, not just the per-token note and the separate run-level
  // warnings array -- using an UNBRACKETED intermediate token so the
  // deterministic re-check actually fires (a bracketed "(A1)" here would
  // be exempt, per rule 13's implied-mark leniency -- see the dedicated
  // bracketed-token test above).
  it("appends a correction to the item's reasoning when any deterministic override withdraws a mark, so it never contradicts the awards", () => {
    const raw = JSON.stringify({
      items: [
        {
          testItemId: "item-1",
          suggestedMarks: 3,
          confidence: "low",
          workFound: true,
          markBreakdown: [
            { token: "M1", awarded: true, note: "Substitution shown explicitly." },
            {
              // 2.6857 is not an exact rounding of 2.65708 at any precision
              // -- the model's own note admits it's only "close", exactly
              // the kind of claim the deterministic check exists to catch.
              // Unbracketed, so no rule-13 implied-mark leniency applies.
              token: "A1",
              awarded: true,
              note: "2.6857 shown as intermediate working, close to 2.65708 using their rounded values",
              intermediateValueCheck: {
                reportedValue: "2.6857",
                referenceValue: "2.65708",
                precisionType: "dp",
                precisionDigits: 4,
              },
            },
            { token: "A1", awarded: true, note: "Final answer 2.7 is correct to 1 decimal place." },
          ],
          reasoning:
            "Method shown, intermediate value calculated (using their values), and final answer 2.7 is correct to 1dp as required - full marks for part (b).",
          evidence: "",
        },
      ],
    });

    const result = validateGradeResponse(raw, [unit({ maxMarks: 3 })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const grade = result.outcome.grades[0];
    // The mark itself is correctly withdrawn...
    expect(grade.clampedMarks).toBe(2);
    // ...and the reasoning a teacher actually reads no longer claims full
    // marks without qualification -- it still contains the model's original
    // text (nothing is deleted) plus a visible correction.
    expect(grade.item.reasoning).toContain("full marks for part (b)");
    expect(grade.item.reasoning).toContain("A1 was withdrawn");
    expect(grade.item.reasoning).toMatch(/not a valid rounding/);
  });

  // A failing final-answer precision must not retroactively erase an
  // already-earned intermediate mark (rule 15) -- these are graded on
  // separate criteria, mirroring rule 14's M/A independence.
  it("does not let a failing final-answer accuracy mark erase an already-earned intermediate accuracy mark", () => {
    const raw = JSON.stringify({
      items: [
        {
          testItemId: "item-1",
          suggestedMarks: 1,
          confidence: "high",
          workFound: true,
          markBreakdown: [
            {
              token: "(A1)",
              awarded: true,
              note: "2.657 is an acceptable intermediate value",
              intermediateValueCheck: {
                reportedValue: "2.657",
                referenceValue: "2.65708",
                precisionType: "dp",
                precisionDigits: 5,
              },
            },
            {
              // Final answer given as "2.5" instead of the required 1 d.p.
              // "2.7" -- genuinely fails the final-answer numericCheck (not
              // merely under-precise), and that failure is this token's
              // own, not the intermediate mark's.
              token: "A1",
              awarded: false,
              note: "2.5 does not satisfy the required 1 d.p. final answer",
              numericCheck: {
                reportedValue: "2.5",
                referenceValue: "2.65708",
                precisionType: "dp",
                precisionDigits: 1,
              },
            },
          ],
          reasoning: "",
          evidence: "",
        },
      ],
    });

    const result = validateGradeResponse(raw, [unit({ maxMarks: 2 })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.outcome.grades[0].clampedMarks).toBe(1);
    expect(result.outcome.warnings).toHaveLength(0);
  });

  // A teacher reported this exact production case: the model's own note
  // admitted "8.515 rounds to 8.52, but ... Value is incorrect" and withheld
  // the A mark anyway. Flag-only warnings did not fix the mark for the
  // student -- the wrong total stood until a teacher manually re-graded,
  // and the model kept inventing new rationalizations for the same withheld
  // mark on repeated re-runs even after prompt tightening. The model's own
  // numericCheck, independently re-verified, actually supports the award,
  // so this now grants it directly rather than only flagging it.
  it("grants a mark withheld despite its own numericCheck actually passing", () => {
    const raw = JSON.stringify({
      items: [
        {
          testItemId: "item-1",
          suggestedMarks: 0,
          confidence: "medium",
          workFound: true,
          markBreakdown: [
            {
              token: "A1",
              awarded: false,
              note: "8.515 does not round to 8.52 at 3sf, but using student's a=0.81: 0.81x7+2.88=8.55, not 8.515. Value is incorrect.",
              numericCheck: {
                reportedValue: "8.515",
                referenceValue: "8.51693",
                alternativeReferenceValues: ["8.55"],
                precisionType: "sf",
                precisionDigits: 3,
              },
            },
          ],
          reasoning: "8.515 is inconsistent with either coefficient path, so A0.",
          evidence: "8.515",
        },
      ],
    });

    const result = validateGradeResponse(raw, [unit({ maxMarks: 1 })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const grade = result.outcome.grades[0];
    // Deterministically re-verified as satisfying its own reported check,
    // so the mark is granted -- clampedMarks moves from the model's
    // reported 0 up to 1, and the breakdown entry itself is flipped to
    // awarded.
    expect(grade.clampedMarks).toBe(1);
    expect(grade.item.markBreakdown[0].awarded).toBe(true);
    expect(grade.confidence).toBe("low");
    expect(
      result.outcome.warnings.some((w) => w.includes("granted on deterministic re-check"))
    ).toBe(true);
    expect(grade.item.reasoning).toContain("Correction");
    expect(grade.item.reasoning).toContain("was granted on deterministic re-check");
  });

  it("does not grant a withheld mark whose own numericCheck genuinely fails", () => {
    const raw = JSON.stringify({
      items: [
        {
          testItemId: "item-1",
          suggestedMarks: 0,
          confidence: "high",
          workFound: true,
          markBreakdown: [
            {
              token: "A1",
              awarded: false,
              note: "0.81 has only 2 s.f.; 0.805 to 3 s.f. is required.",
              numericCheck: { reportedValue: "0.81", referenceValue: "0.805084", precisionType: "sf", precisionDigits: 3 },
            },
          ],
          reasoning: "0.81 is insufficiently precise, so A0.",
          evidence: "0.81",
        },
      ],
    });

    const result = validateGradeResponse(raw, [unit({ maxMarks: 1 })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.outcome.grades[0].confidence).toBe("high");
    expect(result.outcome.warnings).toHaveLength(0);
    expect(result.outcome.grades[0].item.reasoning).toBe("0.81 is insufficiently precise, so A0.");
  });

  // The deterministic grant-loop bug: matchesRequiredPrecision() returns
  // `ok: true` both when a value is genuinely verified correct AND when it
  // could not be parsed at all (deferring to the model). Gating the grant on
  // `ok` alone -- as this loop used to -- would treat "could not check" the
  // same as "checked and correct" and hand the model a mark it withheld for
  // an unparseable, symbolic reported value. Confirmed unreproduced in
  // production (0 of 5 real grants ever hit this branch) before this test
  // was added; it exists so it never gets the chance to.
  it("does not grant a withheld mark whose numericCheck cannot be verified deterministically", () => {
    const raw = JSON.stringify({
      items: [
        {
          testItemId: "item-1",
          suggestedMarks: 0,
          confidence: "high",
          workFound: true,
          markBreakdown: [
            {
              token: "A1",
              awarded: false,
              note: "pi/4 is a symbolic exact form, cannot confirm it equals the decimal reference",
              numericCheck: {
                reportedValue: "pi/4",
                referenceValue: "0.785398",
                precisionType: "sf",
                precisionDigits: 3,
              },
            },
          ],
          reasoning: "Could not confirm pi/4 numerically, so A0.",
          evidence: "pi/4",
        },
      ],
    });

    const result = validateGradeResponse(raw, [unit({ maxMarks: 1 })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const grade = result.outcome.grades[0];
    expect(grade.clampedMarks).toBe(0);
    expect(grade.item.markBreakdown[0].awarded).toBe(false);
    expect(result.outcome.warnings).toHaveLength(0);
  });

  it("grants a withheld Method mark whose own impliedMethodEvidence actually supports it", () => {
    const raw = JSON.stringify({
      items: [
        {
          testItemId: "item-1",
          suggestedMarks: 0,
          confidence: "high",
          workFound: true,
          markBreakdown: [
            {
              token: "(M1)",
              awarded: false,
              note: "0.95 might not be sufficient evidence",
              impliedMethodEvidence: {
                reportedValue: "0.95",
                referenceValue: "0.946591",
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
    expect(result.outcome.grades[0].item.markBreakdown[0].awarded).toBe(true);
    expect(result.outcome.grades[0].confidence).toBe("low");
    expect(
      result.outcome.warnings.some((w) => w.includes("granted on deterministic re-check"))
    ).toBe(true);
  });

  // Same grant-loop bug as the numericCheck case above, for
  // impliedMethodEvidence: classifyUnderPrecision() returns "cannot_determine"
  // (not "numerically_incorrect") for an exact-precision claim, since an
  // exact requirement has no under-precise variant to check. The old
  // `classification !== "numerically_incorrect"` grant condition treated
  // that the same as a genuine "correct_but_under_precise" finding.
  it("does not grant a withheld Method mark whose impliedMethodEvidence cannot be classified", () => {
    const raw = JSON.stringify({
      items: [
        {
          testItemId: "item-1",
          suggestedMarks: 0,
          confidence: "high",
          workFound: true,
          markBreakdown: [
            {
              token: "(M1)",
              awarded: false,
              note: "Cannot confirm this exact-value claim supports the method",
              impliedMethodEvidence: {
                reportedValue: "8",
                referenceValue: "8.0001",
                precisionType: "exact",
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

    expect(result.outcome.grades[0].clampedMarks).toBe(0);
    expect(result.outcome.grades[0].item.markBreakdown[0].awarded).toBe(false);
    expect(result.outcome.warnings).toHaveLength(0);
  });

  it("does not touch an ordinary intermediate accuracy mark with no intermediateValueCheck attached", () => {
    const raw = JSON.stringify({
      items: [
        {
          testItemId: "item-1",
          suggestedMarks: 1,
          confidence: "high",
          workFound: true,
          markBreakdown: [{ token: "(A1)", awarded: true, note: "exact intermediate value shown" }],
          reasoning: "",
          evidence: "",
        },
      ],
    });

    const result = validateGradeResponse(raw, [unit({ maxMarks: 1 })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.outcome.grades[0].clampedMarks).toBe(1);
    expect(result.outcome.warnings).toHaveLength(0);
  });

  // Same grant-loop bug once more, for intermediateValueCheck.
  it("does not grant a withheld intermediate accuracy mark whose intermediateValueCheck cannot be classified", () => {
    const raw = JSON.stringify({
      items: [
        {
          testItemId: "item-1",
          suggestedMarks: 0,
          confidence: "high",
          workFound: true,
          markBreakdown: [
            {
              token: "A1",
              awarded: false,
              note: "Cannot confirm this exact-value intermediate claim",
              intermediateValueCheck: {
                reportedValue: "8",
                referenceValue: "8.0001",
                precisionType: "exact",
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

    expect(result.outcome.grades[0].clampedMarks).toBe(0);
    expect(result.outcome.grades[0].item.markBreakdown[0].awarded).toBe(false);
    expect(result.outcome.warnings).toHaveLength(0);
  });

  // A teacher asked for marks in the review UI to be clearly associated
  // with the sub-part they belong to when one graded unit's own mark
  // scheme spans several (e.g. "a)(i)", "a)(ii)", "b)"). Confirms the
  // optional `part` label on a markBreakdown entry round-trips through
  // validateGradeResponse untouched for the UI to group by.
  it("preserves the optional part label on each markBreakdown entry", () => {
    const raw = JSON.stringify({
      items: [
        {
          testItemId: "item-1",
          suggestedMarks: 2,
          confidence: "high",
          workFound: true,
          markBreakdown: [
            { token: "A1", awarded: true, note: "a is correct", part: "a)(i)" },
            { token: "A1", awarded: true, note: "b is correct", part: "a)(i)" },
            { token: "A1", awarded: false, note: "r is insufficiently precise", part: "a)(ii)" },
          ],
          reasoning: "",
          evidence: "",
        },
      ],
    });

    const result = validateGradeResponse(raw, [unit({ maxMarks: 3 })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const parts = result.outcome.grades[0].item.markBreakdown.map((b) => b.part);
    expect(parts).toEqual(["a)(i)", "a)(i)", "a)(ii)"]);
  });

  // Rule 18 / findExposedDeliberation integration: examiner reasoning must
  // never leak the model's own live deliberation. This is the real,
  // verbatim production failure that motivated the rule -- the model's
  // `reasoning` field literally read as a transcript of it changing its
  // mind, even though the final mark it settled on was correct.
  it("downgrades confidence and warns when reasoning exposes internal deliberation, without changing the awarded marks", () => {
    const raw = JSON.stringify({
      items: [
        {
          testItemId: "item-1",
          suggestedMarks: 1,
          confidence: "high",
          workFound: true,
          markBreakdown: [{ token: "A1", awarded: true, note: "" }],
          reasoning:
            "8.515 appears to use correct full precision value giving 8.51693..., student reports 8.515 which rounds to 8.52 - however reconsidering, 8.515 rounds to 8.52 at 3sf so this should earn the mark. Let me reconsider: 8.515 to 3sf is 8.52, which matches mark scheme.",
          evidence: "",
        },
      ],
    });

    const result = validateGradeResponse(raw, [unit({ maxMarks: 1 })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The mark itself was correct -- exposing deliberation is a reasoning
    // QUALITY problem, not a reason to change the score.
    expect(result.outcome.grades[0].clampedMarks).toBe(1);
    expect(result.outcome.grades[0].confidence).toBe("low");
    expect(
      result.outcome.warnings.some((w) => w.includes("exposes internal deliberation"))
    ).toBe(true);
  });

  it("downgrades confidence when a markBreakdown note (not just reasoning) exposes deliberation", () => {
    const raw = JSON.stringify({
      items: [
        {
          testItemId: "item-1",
          suggestedMarks: 1,
          confidence: "high",
          workFound: true,
          markBreakdown: [{ token: "A1", awarded: true, note: "Let me reconsider -- this is correct." }],
          reasoning: "A1 awarded.",
          evidence: "",
        },
      ],
    });

    const result = validateGradeResponse(raw, [unit({ maxMarks: 1 })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.outcome.grades[0].confidence).toBe("low");
    expect(
      result.outcome.warnings.some((w) => w.includes("exposes internal deliberation"))
    ).toBe(true);
  });

  // Hedging is a separate, weaker signal: the model saying it could not read
  // the handwriting cleanly is honest examiner language, not a defect. It
  // caps confidence at medium and says so in its own words, so the stronger
  // deliberation flag keeps its meaning.
  it("caps confidence at medium for hedged reading, without claiming exposed deliberation", () => {
    const raw = JSON.stringify({
      items: [
        {
          testItemId: "item-1",
          suggestedMarks: 1,
          confidence: "high",
          workFound: true,
          markBreakdown: [{ token: "A1", awarded: true, note: "" }],
          reasoning: "The student's answer appears to be 2, which is incorrect.",
          evidence: "",
        },
      ],
    });

    const result = validateGradeResponse(raw, [unit({ maxMarks: 1 })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.outcome.grades[0].clampedMarks).toBe(1);
    expect(result.outcome.grades[0].confidence).toBe("medium");
    expect(result.outcome.warnings.some((w) => w.includes("hedges on reading"))).toBe(true);
    expect(
      result.outcome.warnings.some((w) => w.includes("exposes internal deliberation"))
    ).toBe(false);
  });

  it("keeps low confidence when reasoning both deliberates and hedges", () => {
    const raw = JSON.stringify({
      items: [
        {
          testItemId: "item-1",
          suggestedMarks: 1,
          confidence: "high",
          workFound: true,
          markBreakdown: [{ token: "A1", awarded: true, note: "" }],
          reasoning: "The answer appears to be 2. Let me reconsider: it is 11.",
          evidence: "",
        },
      ],
    });

    const result = validateGradeResponse(raw, [unit({ maxMarks: 1 })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Hedging must never lift a low set by a real defect.
    expect(result.outcome.grades[0].confidence).toBe("low");
    expect(result.outcome.warnings.some((w) => w.includes("hedges on reading"))).toBe(true);
    expect(
      result.outcome.warnings.some((w) => w.includes("exposes internal deliberation"))
    ).toBe(true);
  });

  // Regression for the phrase dropped from the banned list: a correct answer
  // to a question about one expression not matching another must not be
  // flagged at all. See examiner-reasoning.ts's header.
  it("does not flag settled reasoning that says the work doesn't match", () => {
    const raw = JSON.stringify({
      items: [
        {
          testItemId: "item-1",
          suggestedMarks: 1,
          confidence: "high",
          workFound: true,
          markBreakdown: [
            { token: "R1", awarded: true, note: "Contextual explanation using units" },
          ],
          reasoning:
            "The student explained that 78mn doesn't match the context because mn doesn't represent the cost per box of either item. R1 awarded.",
          evidence: "",
        },
      ],
    });

    const result = validateGradeResponse(raw, [unit({ maxMarks: 1 })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.outcome.grades[0].confidence).toBe("high");
    expect(result.outcome.warnings).toHaveLength(0);
  });

  it("does not flag clean, settled professional reasoning", () => {
    const raw = JSON.stringify({
      items: [
        {
          testItemId: "item-1",
          suggestedMarks: 1,
          confidence: "high",
          workFound: true,
          markBreakdown: [{ token: "A1", awarded: true, note: "Correct to 3 significant figures." }],
          reasoning: "The value matches the required accuracy. A1 awarded.",
          evidence: "",
        },
      ],
    });

    const result = validateGradeResponse(raw, [unit({ maxMarks: 1 })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.outcome.grades[0].confidence).toBe("high");
    expect(result.outcome.warnings).toHaveLength(0);
  });

  // Full regression scenario from the report: a teacher's example where a
  // student gets 4/6 for correctly-identified IB reasons, not by coincidence.
  // Grading units mirror the app's real architecture -- each part is its
  // own testItemId/unit, graded together in one validateGradeResponse call
  // the way a real batch grading run would.
  describe("regression: insufficient final precision vs. an accepted rounded intermediate", () => {
    const units: GradingUnit[] = [
      unit({ testItemId: "a-i", questionNumber: 3, partLabel: "ai", maxMarks: 2, markscheme: "a = 0.805, b = 2.88  A1 A1" }),
      unit({ testItemId: "a-ii", questionNumber: 3, partLabel: "aii", maxMarks: 1, markscheme: "r = 0.978  A1" }),
      unit({ testItemId: "b", questionNumber: 3, partLabel: "b", maxMarks: 1, markscheme: "interpretation of gradient in context  R1" }),
      unit({
        testItemId: "c",
        questionNumber: 3,
        partLabel: "c",
        maxMarks: 2,
        markscheme: "attempt to substitute x = 7 into their equation (M1); 8.52  A1",
      }),
    ];

    const raw = JSON.stringify({
      items: [
        {
          testItemId: "a-i",
          suggestedMarks: 1,
          confidence: "high",
          workFound: true,
          markBreakdown: [
            {
              token: "A1",
              awarded: false,
              note: "a = 0.81 is given to only 2 significant figures; a = 0.805 to 3 significant figures is required, so A1 is not awarded.",
              numericCheck: { reportedValue: "0.81", referenceValue: "0.805084", precisionType: "sf", precisionDigits: 3 },
            },
            {
              token: "A1",
              awarded: true,
              note: "b = 2.88 is correct to 3 significant figures.",
              numericCheck: { reportedValue: "2.88", referenceValue: "2.88135", precisionType: "sf", precisionDigits: 3 },
            },
          ],
          reasoning:
            "a = 0.81 is given to only 2 significant figures; a = 0.805 to 3 significant figures is required, so A1 is not awarded. b = 2.88 is correct to 3 significant figures, so A1 is awarded.",
          evidence: "a = 0.81, b = 2.88",
        },
        {
          testItemId: "a-ii",
          suggestedMarks: 0,
          confidence: "high",
          workFound: true,
          // Only one token: the mark scheme has no paired M mark for this
          // criterion, so none is invented here (rule 17).
          markBreakdown: [
            {
              token: "A1",
              awarded: false,
              note: "r = 0.98 is given to only 2 significant figures; r = 0.978 to 3 significant figures is required, so A1 is not awarded.",
              numericCheck: { reportedValue: "0.98", referenceValue: "0.97777", precisionType: "sf", precisionDigits: 3 },
            },
          ],
          reasoning: "r = 0.98 is given to only 2 significant figures; r = 0.978 to 3 significant figures is required, so A1 is not awarded.",
          evidence: "r = 0.98",
        },
        {
          testItemId: "b",
          suggestedMarks: 1,
          confidence: "high",
          workFound: true,
          markBreakdown: [
            {
              token: "R1",
              awarded: true,
              note: "Correct interpretation of the gradient as the increase in waiting time per additional customer.",
            },
          ],
          reasoning:
            "The student correctly interprets the gradient as the increase in waiting time per additional customer, so R1 is awarded.",
          evidence: "For every one customer added, the waiting time increases by 0.81.",
        },
        {
          testItemId: "c",
          suggestedMarks: 2,
          confidence: "high",
          workFound: true,
          markBreakdown: [
            {
              token: "(M1)",
              awarded: true,
              note: "8.515 is consistent with substituting x = 7 into the accepted equation y = 0.805x + 2.88, so the implied method mark is awarded.",
              // Rule 16: check against what the accepted rounded coefficients
              // (0.805, 2.88) actually produce, not only the pristine
              // unrounded calculation -- both are given here.
              impliedMethodEvidence: {
                reportedValue: "8.515",
                referenceValue: "8.51693",
                alternativeReferenceValues: ["8.515"],
                precisionType: "sf",
                precisionDigits: 3,
              },
            },
            {
              token: "A1",
              awarded: true,
              note: "8.515 is consistent with the required answer 8.52 to 3 significant figures, so A1 is awarded.",
              numericCheck: { reportedValue: "8.515", referenceValue: "8.51693", precisionType: "sf", precisionDigits: 3 },
            },
          ],
          reasoning:
            "8.515 is consistent with substituting x = 7 into the accepted equation y = 0.805x + 2.88, so the implied method mark is awarded. This is consistent with the required answer 8.52 to 3 significant figures, so A1 is awarded.",
          evidence: "8.515",
        },
      ],
    });

    it("awards 4/6 for the correct IB reasons, one part at a time", () => {
      const result = validateGradeResponse(raw, units);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const byId = new Map(result.outcome.grades.map((g) => [g.unit.testItemId, g]));
      expect(byId.get("a-i")?.clampedMarks).toBe(1); // A0 (a) + A1 (b)
      expect(byId.get("a-ii")?.clampedMarks).toBe(0); // A0
      expect(byId.get("b")?.clampedMarks).toBe(1); // R1, independent of (a)(i)'s A0
      expect(byId.get("c")?.clampedMarks).toBe(2); // (M1) + A1

      const total = result.outcome.grades.reduce((s, g) => s + g.clampedMarks, 0);
      const maxTotal = units.reduce((s, u) => s + u.maxMarks, 0);
      expect(total).toBe(4);
      expect(maxTotal).toBe(6);
    });

    it("identifies the correct IB reason in each part's reasoning, not just the right score", () => {
      const result = validateGradeResponse(raw, units);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const byId = new Map(result.outcome.grades.map((g) => [g.unit.testItemId, g]));
      expect(byId.get("a-i")?.item.reasoning).toMatch(/significant figures/i);
      expect(byId.get("a-ii")?.item.reasoning).toMatch(/significant figures/i);
      expect(byId.get("b")?.item.reasoning).toMatch(/interpret/i);
      expect(byId.get("c")?.item.reasoning).toMatch(/substitut/i);
      expect(byId.get("c")?.item.reasoning).toMatch(/8\.52/);
    });

    it("contains no exposed chain-of-thought or hedging language anywhere in the response, and no confidence downgrade for it", () => {
      const result = validateGradeResponse(raw, units);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const banned = [/reconsider/i, /\blet me\b/i, /appears to/i, /on second thought/i, /\bi think\b/i, /probably/i, /doesn'?t match/i];
      for (const grade of result.outcome.grades) {
        for (const phrase of banned) {
          expect(grade.item.reasoning).not.toMatch(phrase);
          for (const entry of grade.item.markBreakdown) {
            expect(entry.note).not.toMatch(phrase);
          }
        }
      }
      expect(
        result.outcome.warnings.some((w) => w.includes("exposes internal deliberation"))
      ).toBe(false);
    });

    it("does not invent a method mark for the (a)(ii) criterion, which the mark scheme allocates only an A mark", () => {
      const result = validateGradeResponse(raw, units);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const aii = result.outcome.grades.find((g) => g.unit.testItemId === "a-ii");
      expect(aii?.item.markBreakdown).toHaveLength(1);
      expect(aii?.item.markBreakdown[0].token).toBe("A1");
    });
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

describe("isCustomAssessment", () => {
  it("is true only for markschemeSource 'custom'", () => {
    expect(isCustomAssessment({ markschemeSource: "custom" })).toBe(true);
    expect(isCustomAssessment({ markschemeSource: "part_latex" })).toBe(false);
    expect(isCustomAssessment({ markschemeSource: "none" })).toBe(false);
  });
});

describe("summarizeCoverage", () => {
  it("reports full coverage when every unit has a mark scheme", () => {
    const units = [
      unit({ testItemId: "1", questionNumber: 1, maxMarks: 7 }),
      unit({ testItemId: "2", questionNumber: 2, maxMarks: 5, markschemeSource: "whole_question" }),
    ];
    expect(summarizeCoverage(units)).toEqual({
      partsInAssessment: 2,
      partsWithoutMarkscheme: 0,
      maxTotal: 12,
      testTotalMarks: 12,
      ungradedLabels: [],
    });
  });

  it("excludes markschemeSource 'none' units from maxTotal but keeps them in testTotalMarks", () => {
    // K06P1's real shape, 27 Aug audit reproduced live: Q6(a)/Q6(b) matched a
    // question in the bank but no part, whole-question or draft mark scheme --
    // the case the gradebook and PowerSchool export were silently treating as
    // "these 7 marks were not earned" rather than "these 7 marks cannot be
    // earned at all".
    const units = [
      unit({ testItemId: "1", questionNumber: 5, partLabel: "", maxMarks: 4 }),
      unit({ testItemId: "2", questionNumber: 6, partLabel: "a", maxMarks: 3, markschemeSource: "none" }),
      unit({ testItemId: "3", questionNumber: 6, partLabel: "b", maxMarks: 4, markschemeSource: "none" }),
    ];
    expect(summarizeCoverage(units)).toEqual({
      partsInAssessment: 3,
      partsWithoutMarkscheme: 2,
      maxTotal: 4,
      testTotalMarks: 11,
      ungradedLabels: ["6(a)", "6(b)"],
    });
  });

  it("returns zeroed totals for an empty assessment", () => {
    expect(summarizeCoverage([])).toEqual({
      partsInAssessment: 0,
      partsWithoutMarkscheme: 0,
      maxTotal: 0,
      testTotalMarks: 0,
      ungradedLabels: [],
    });
  });
});

describe("isImpliedToken", () => {
  it("recognizes a parenthesized token as implied", () => {
    expect(isImpliedToken("(M1)")).toBe(true);
    expect(isImpliedToken("(A1)")).toBe(true);
  });

  it("does not treat a plain token as implied", () => {
    expect(isImpliedToken("M1")).toBe(false);
    expect(isImpliedToken("A1")).toBe(false);
    expect(isImpliedToken("R1")).toBe(false);
  });

  it("tolerates leading whitespace", () => {
    expect(isImpliedToken("  (A1)")).toBe(true);
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

  it("appends the Formative Assessment marking principles when any unit is custom", () => {
    const prompt = buildGradingSystemPrompt([unit({ markschemeSource: "custom" })]);
    expect(prompt.startsWith(GRADING_SYSTEM_PROMPT)).toBe(true);
    expect(prompt).toContain(G9_FORMATIVE_ASSESSMENT_MARKING_PRINCIPLES);
    expect(G9_FORMATIVE_ASSESSMENT_MARKING_PRINCIPLES.length).toBeGreaterThan(0);
  });

  it("does not append the Formative Assessment policy for bank-sourced units", () => {
    const prompt = buildGradingSystemPrompt([unit({ markschemeSource: "part_latex" })]);
    expect(prompt).toBe(GRADING_SYSTEM_PROMPT);
  });

  it("can append both policies at once for a mixed test", () => {
    const prompt = buildGradingSystemPrompt([
      unit({ testItemId: "item-1", curriculum: ["AA"], level: "AHL", paper: 2 }),
      unit({ testItemId: "item-2", markschemeSource: "custom" }),
    ]);
    expect(prompt).toContain(AA_HL_PAPER_2_NUMERICAL_ACCURACY_POLICY);
    expect(prompt).toContain(G9_FORMATIVE_ASSESSMENT_MARKING_PRINCIPLES);
  });
});

/** The KA1 Unit 1 paper as grading units, each carrying its strand. */
function ka1Units(): GradingUnit[] {
  return KA1_UNIT1_ITEMS.map((it) => {
    const strand = strandForItem(KA1_UNIT1_RUBRIC, { question_number: it.questionNumber, part_label: it.partLabel })!;
    return unit({
      testItemId: `item-${it.questionNumber}${it.partLabel}`,
      questionNumber: it.questionNumber,
      partLabel: it.partLabel,
      maxMarks: it.maxMarks,
      questionCode: "",
      questionLatex: it.questionText,
      markscheme: it.markschemeText,
      markschemeSource: "custom",
      standards: { strand: { code: strand.code, name: strand.name, standards: strand.standards }, rubric: KA1_UNIT1_RUBRIC },
    });
  });
}

describe("Grade 9 Standard Level (standards-referenced) grading", () => {
  it("isStandardsReferenced is decided by the unit carrying a rubric", () => {
    expect(isStandardsReferenced(unit())).toBe(false);
    expect(isStandardsReferenced(unit({ standards: null }))).toBe(false);
    expect(isStandardsReferenced(ka1Units()[0])).toBe(true);
  });

  it("policy content is actually loaded from grading_policies/, not empty", () => {
    expect(G9_STANDARD_LEVEL_MARKING_PRINCIPLES).toContain("Grade 9 Standard Level");
    expect(G9_STANDARD_LEVEL_MARKING_PRINCIPLES).toContain("descriptor, not a token list");
    expect(G9_STANDARD_LEVEL_MARKING_PRINCIPLES).toContain("Omit numericCheck");
  });

  it("appends the Standard Level policy and the strand rubric, and NOT the Formative principles", () => {
    const prompt = buildGradingSystemPrompt(ka1Units());
    expect(prompt.startsWith(GRADING_SYSTEM_PROMPT)).toBe(true);
    expect(prompt).toContain(G9_STANDARD_LEVEL_MARKING_PRINCIPLES);
    expect(prompt).toContain("THIS ASSESSMENT'S STRAND RUBRIC");
    expect(prompt).not.toContain(G9_FORMATIVE_ASSESSMENT_MARKING_PRINCIPLES);
    expect(prompt).not.toContain("Formative Assessment Marking Principles");
  });

  it("a custom test WITHOUT a rubric still gets the Formative principles, unchanged", () => {
    const prompt = buildGradingSystemPrompt([unit({ markschemeSource: "custom", standards: null })]);
    expect(prompt).toContain(G9_FORMATIVE_ASSESSMENT_MARKING_PRINCIPLES);
    expect(prompt).not.toContain(G9_STANDARD_LEVEL_MARKING_PRINCIPLES);
  });

  it("the strand block prints each strand's marks, parts, ranges and descriptors", () => {
    const block = buildStandardsRubricBlock(KA1_UNIT1_RUBRIC, ka1Units());
    expect(block).toContain("Strand A: Expressions: evaluate, write and rewrite (11 marks)");
    expect(block).toContain("Parts: 1(a), 1(b), 1(c), 7(a), 7(b), 7(c), 8");
    expect(block).toContain("Exceeding 10-11 / Meeting 8-9 / Approaching 5-7 / Beginning 0-4");
    expect(block).toContain("Strand B: Arithmetic sequences and explicit rules (13 marks)");
    expect(block).toContain("Exceeding 12-13 / Meeting 9-11 / Approaching 6-8 / Beginning 0-5");
    expect(block).toContain("Strand D: Reasoning and justification (9 marks)");
    expect(block).toContain("Parts: 2(d), 6(d), 7(d), 9(c)");
    expect(block).toContain("F-LE.A.2 Build a linear rule");
    expect(block).toContain("Approaching: Gives correct conclusions with little justification.");
    expect(block).toContain("Level bands: Exceeding from 85%, Meeting from 65%, Approaching from 40%");
  });

  it("names the strand on each part in the user prompt", () => {
    const prompt = buildGradingUserPrompt(ka1Units(), { testName: "KA1" });
    expect(prompt).toContain("=== 2(d) ===");
    expect(prompt).toContain("Strand: D -- Reasoning and justification");
    expect(prompt).toContain("=== 8 ===\ntestItemId: item-8");
    expect(prompt).toContain("Strand: A -- Expressions: evaluate, write and rewrite");
  });

  it("a unit with no strand context prints no Strand line", () => {
    const prompt = buildGradingUserPrompt([unit()], {});
    expect(prompt).not.toContain("Strand:");
  });

  it("the system prompt is identical for every unit order of the same test (cacheable)", () => {
    const a = buildGradingSystemPrompt(ka1Units());
    const b = buildGradingSystemPrompt([...ka1Units()].reverse());
    expect(a).toBe(b);
  });
});

// These two rules have no deterministic backstop (they're pure grading
// judgement -- reading a mark scheme's own wording, and reasoning-text
// quality -- not something a numeric-string comparison can verify), so
// the only thing to regression-test is that the prompt guidance itself
// hasn't silently regressed or been deleted.
describe("GRADING_SYSTEM_PROMPT content", () => {
  it("forbids citing excess significant figures/decimal places alone as a reason to withhold a mark", () => {
    // A teacher reported the model withholding an A mark by reasoning
    // "the student gave 4 s.f. rather than the required 3sf" for a value
    // it had ITSELF just confirmed rounds correctly -- excess precision
    // that rounds correctly was already meant to be accepted (the 8.515
    // example), but the model kept re-inventing this exact rationalization.
    expect(GRADING_SYSTEM_PROMPT).toMatch(/greater than M/i);
    expect(GRADING_SYSTEM_PROMPT).toContain("contradiction");
  });

  it("distinguishes a constant term from the coefficients of variable terms", () => {
    expect(GRADING_SYSTEM_PROMPT).toContain("CONSTANT TERM");
    expect(GRADING_SYSTEM_PROMPT).toContain("3x^2 - 5x + 7");
    expect(GRADING_SYSTEM_PROMPT).toMatch(/coefficient of x\^0/);
  });
});

describe("composeQuestionText", () => {
  it("puts the stem before the part, separated by a blank line", () => {
    expect(composeQuestionText("Consider $px + q = rx + s$.", "Make $x$ the subject.")).toBe(
      "Consider $px + q = rx + s$.\n\nMake $x$ the subject.",
    );
  });

  it("returns the part alone when there is no stem", () => {
    expect(composeQuestionText(null, "Make $x$ the subject.")).toBe("Make $x$ the subject.");
    expect(composeQuestionText(undefined, "Make $x$ the subject.")).toBe("Make $x$ the subject.");
    expect(composeQuestionText("   ", "Make $x$ the subject.")).toBe("Make $x$ the subject.");
  });

  it("returns the stem alone when the part is missing, rather than a stray blank line", () => {
    expect(composeQuestionText("Consider $px + q = rx + s$.", null)).toBe(
      "Consider $px + q = rx + s$.",
    );
  });

  it("is empty when both are", () => {
    expect(composeQuestionText(null, null)).toBe("");
    expect(composeQuestionText("", "  ")).toBe("");
  });
});

/** Exploration 1.1 as grading units, each carrying the learning target(s) it feeds. */
function exploration11Units(): GradingUnit[] {
  return EXPLORATION_1_1_ITEMS.map((it) => {
    const targets = targetsForItem(EXPLORATION_1_1_RUBRIC, {
      question_number: it.questionNumber,
      part_label: it.partLabel || null,
    });
    return unit({
      testItemId: `item-${it.questionNumber}${it.partLabel}`,
      questionNumber: it.questionNumber,
      partLabel: it.partLabel,
      maxMarks: it.maxMarks,
      questionCode: "",
      questionLatex: it.questionText,
      markscheme: it.markschemeText,
      markschemeSource: "custom",
      activity: {
        targets: targets.map((t) => ({ code: t.code, name: t.name })),
        rubric: EXPLORATION_1_1_RUBRIC,
      },
    });
  });
}

describe("Exploration and homework (activity) grading", () => {
  it("isActivity is decided by the unit carrying a rubric", () => {
    expect(isActivity(unit())).toBe(false);
    expect(isActivity(unit({ activity: null }))).toBe(false);
    expect(isActivity(exploration11Units()[0])).toBe(true);
  });

  it("policy content is actually loaded from grading_policies/, not empty", () => {
    expect(MATHMEDIC_ACTIVITY_MARKING_PRINCIPLES).toContain("Exploration and Homework");
    expect(MATHMEDIC_ACTIVITY_MARKING_PRINCIPLES).toContain("A bare correct answer still shows the idea");
    expect(MATHMEDIC_ACTIVITY_MARKING_PRINCIPLES).toContain("Omit");
  });

  it("appends the activity policy and the learning targets, and NEITHER other policy", () => {
    // The trap this pins: an activity's items are source = 'custom', so the
    // Formative branch would fire on them if the dispatch were a chain of
    // independent ifs rather than an else-if chain.
    const units = exploration11Units();
    expect(units.every((u) => u.markschemeSource === "custom")).toBe(true);

    const prompt = buildGradingSystemPrompt(units);
    expect(prompt.startsWith(GRADING_SYSTEM_PROMPT)).toBe(true);
    expect(prompt).toContain(MATHMEDIC_ACTIVITY_MARKING_PRINCIPLES);
    expect(prompt).toContain("THIS ACTIVITY'S LEARNING TARGETS");
    expect(prompt).not.toContain(G9_FORMATIVE_ASSESSMENT_MARKING_PRINCIPLES);
    expect(prompt).not.toContain("Formative Assessment Marking Principles");
    expect(prompt).not.toContain(G9_STANDARD_LEVEL_MARKING_PRINCIPLES);
    expect(prompt).not.toContain("THIS ASSESSMENT'S STRAND RUBRIC");
  });

  it("an activity that somehow also carries strands is marked as an activity", () => {
    const strand = strandForItem(KA1_UNIT1_RUBRIC, { question_number: 1, part_label: "a" })!;
    const prompt = buildGradingSystemPrompt([
      unit({
        markschemeSource: "custom",
        standards: { strand: { code: strand.code, name: strand.name, standards: strand.standards }, rubric: KA1_UNIT1_RUBRIC },
        activity: { targets: [{ code: "LT1", name: "Relationships" }], rubric: EXPLORATION_1_1_RUBRIC },
      }),
    ]);
    expect(prompt).toContain(MATHMEDIC_ACTIVITY_MARKING_PRINCIPLES);
    expect(prompt).not.toContain(G9_STANDARD_LEVEL_MARKING_PRINCIPLES);
  });

  it("a custom test without an activity rubric still gets the Formative principles, unchanged", () => {
    const prompt = buildGradingSystemPrompt([unit({ markschemeSource: "custom", activity: null })]);
    expect(prompt).toContain(G9_FORMATIVE_ASSESSMENT_MARKING_PRINCIPLES);
    expect(prompt).not.toContain(MATHMEDIC_ACTIVITY_MARKING_PRINCIPLES);
  });

  it("the learning-target block prints each target, its note and its parts", () => {
    const block = buildActivityRubricBlock(EXPLORATION_1_1_RUBRIC, exploration11Units());
    expect(block).toContain("LT1: Look for relationships between variables (7 marks of evidence)");
    expect(block).toContain("Parts: 1, 2, 9(a), 10(b)");
    expect(block).toContain("LT2: Use operations to describe a relationship between variables (6 marks of evidence)");
    expect(block).toContain("LT3: Evaluate an expression by substituting a value for a variable (8 marks of evidence)");
    expect(block).toContain("PEMDAS");
    expect(block).toContain("sat BEFORE the lesson");
  });

  it("the block prints NO thresholds or mark ranges, unlike the strand block", () => {
    // Deliberate: the outcome bands roll accepted marks up afterwards and are
    // none of the model's business. Handing it the arithmetic would invite
    // exactly the level-computing the policy forbids.
    const block = buildActivityRubricBlock(EXPLORATION_1_1_RUBRIC, exploration11Units());
    expect(block).not.toContain("Mark ranges");
    // The outcome words appear exactly once, in the line that tells the model
    // the platform computes them -- never against a target or a mark count.
    expect(block.match(/Got it/g)?.length).toBe(1);
    expect(block).toContain(
      "The platform computes Got it / Almost / Not yet per learning target from the marks a teacher accepts. You report marks per part only."
    );
    for (const target of EXPLORATION_1_1_RUBRIC.targets) {
      const line = block.split("\n").find((l) => l.startsWith(`--- ${target.code}:`))!;
      expect(line).not.toMatch(/Got it|Almost|Not yet/);
    }
  });

  it("is byte-identical however the units are ordered, so the prompt stays cacheable", () => {
    const forwards = buildActivityRubricBlock(EXPLORATION_1_1_RUBRIC, exploration11Units());
    const backwards = buildActivityRubricBlock(EXPLORATION_1_1_RUBRIC, [...exploration11Units()].reverse());
    expect(backwards).toBe(forwards);
  });

  it("names the learning target on each part in the user prompt", () => {
    const prompt = buildGradingUserPrompt(exploration11Units(), { testName: "Exploration 1.1" });
    expect(prompt).toContain("Evidence of: LT3 Evaluate an expression by substituting a value for a variable");
    // Q10(b) feeds two targets, and both are named on it.
    expect(prompt).toContain("Evidence of: LT1 Look for relationships between variables; LT2 Use operations to describe a relationship between variables");
  });
});
