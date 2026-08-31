import { describe, expect, it } from "vitest";
import {
  AA_HL_PAPER_2_NUMERICAL_ACCURACY_POLICY,
  GRADING_SYSTEM_PROMPT,
  buildGradingSystemPrompt,
  isAaHlPaper2,
  isImpliedToken,
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
