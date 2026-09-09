import { describe, expect, it } from "vitest";
import type { AssignmentDraft, AssignmentQuestion } from "./assignments";
import {
  validateRubric,
  summarizeRubricFindings,
  shouldHoldForRubricReview,
} from "./rubric-validator";

/**
 * Every violating case here is copied verbatim from Formative Assessment 1,
 * the paper whose audit produced these rules. Every clean case is copied from
 * a part of the same paper that got it right -- a validator that fires on
 * good schemes is worse than none, because a teacher who learns to dismiss it
 * will dismiss the real finding too.
 */

function draftOf(
  questions: AssignmentQuestion[],
  markingPrinciples: string[] = []
): AssignmentDraft {
  return {
    title: "Formative Assessment 1",
    subtitle: "Grade 9 Mathematics",
    instructions: [],
    sections: [{ heading: "Level 1", questions }],
    ...(markingPrinciples.length > 0 ? { markingPrinciples } : {}),
  };
}

/** One question with lettered subparts, the shape FA1 actually uses. */
function withSubparts(
  subparts: Array<{ prompt: string; marks: number; markScheme: string }>
): AssignmentQuestion {
  return { prompt: "Stem", subparts };
}

const codesOf = (fs: ReturnType<typeof validateRubric>) => fs.map((f) => f.code);

describe("validateRubric", () => {
  // -- Rule 1 ---------------------------------------------------------------
  it("catches a code awarded 'for both' and then awarded when only one is met", () => {
    // FA1 Q12(a), verbatim. Two graders read this two ways and a real mark hung on it.
    const findings = validateRubric(
      draftOf([
        {
          prompt: "Let m=1 and n=2. Calculate both values.",
          marks: 2,
          markScheme:
            "M1 for both expressions evaluated with m=1, n=2 substituted visibly. " +
            "A1 for Original = 48+60=108; student's = 78(1)(2)=156. " +
            "Both values must be present; one value alone earns M1A0.",
        },
      ])
    );
    expect(codesOf(findings)).toContain("scheme-self-contradiction");
    expect(findings.find((f) => f.rule === 1)?.severity).toBe("block");
  });

  it("does not flag a scheme whose exception withholds the code it gates", () => {
    // FA1 Q7(b): "A single collected term alone earns M1A0" -- M1 is NOT gated
    // on "both", so awarding it partially is coherent, not contradictory.
    const findings = validateRubric(
      draftOf([
        {
          prompt: "Simplify your expression from part (a).",
          marks: 2,
          markScheme:
            "M1 for like terms collected: (-6z + 4z) and (8 - 10). " +
            "A1 for -2z - 2 (accept -2 - 2z). A single collected term alone earns M1A0.",
        },
      ])
    );
    expect(codesOf(findings)).not.toContain("scheme-self-contradiction");
  });

  // -- Rule 2 ---------------------------------------------------------------
  it("catches a question that asks for units when the scheme never requires them", () => {
    // FA1 Q12(c). 12 students earned this mark with no units -- correctly, as written.
    const findings = validateRubric(
      draftOf([
        {
          prompt: "Explain why 78mn does not match the context. Use units in your answer.",
          marks: 1,
          markScheme: "R1. Must be about contextual meaning, distinct from (b).",
        },
      ])
    );
    expect(codesOf(findings)).toContain("units-asked-not-required");
  });

  it("catches a scheme requiring units the question never asked for", () => {
    const findings = validateRubric(
      draftOf([
        {
          prompt: "Explain what 28a means.",
          marks: 1,
          markScheme: "R1. Requires 'total' and dollars.",
        },
      ])
    );
    expect(codesOf(findings)).toContain("units-required-not-asked");
  });

  it("passes a part where the question and the scheme agree about units", () => {
    // FA1 Q4(a) -- both sides ask for units.
    const findings = validateRubric(
      draftOf([
        {
          prompt: "Explain what 28 means. Use units and the word 'per.'",
          marks: 1,
          markScheme:
            "R1. Requires units and 'per' or 'each'. '$28' alone, or 'the coefficient of a', earns 0.",
        },
      ])
    );
    expect(findings.filter((f) => f.rule === 2)).toHaveLength(0);
  });

  // Regressions from the first run against the real FA1 draft. Each of these
  // was a good scheme the validator wrongly flagged, or a bad one it missed --
  // none of which the hand-written cases above would have caught.

  it('accepts a question that asks for units as "Include units"', () => {
    // FA1 Q6(b). Papers do not all say "use units", and flagging this one
    // would have told a teacher to fix a scheme that was already correct.
    const findings = validateRubric(
      draftOf([
        {
          prompt: "Hence calculate the total cost when b=4 and d=3. Show the substitution. Include units.",
          marks: 1,
          markScheme:
            "A1. The mark requires visible substitution into the student's own part (a) and the units. A bare '$69' earns 0.",
        },
      ])
    );
    expect(findings.filter((f) => f.rule === 2)).toHaveLength(0);
  });

  it("does not read a worked value in an example as a units requirement", () => {
    // FA1 Q13(c) and Q13(d): the "$" is inside an accepted answer and an
    // illustration, not a rule the student must satisfy.
    const findings = validateRubric(
      draftOf([
        {
          prompt: "Hence calculate the total price when p=640 dollars. Show the substitution.",
          marks: 1,
          markScheme:
            "A1. Requires substitution into the student's own (b). $684.8 or $684.80 both accepted.",
        },
        {
          prompt: "Explain why p+7 is wrong.",
          marks: 1,
          markScheme:
            "R1. Award for any explanation contrasting a proportional amount with a fixed amount; a numerical demonstration (e.g. $640 tax of $44.80 versus $7) also earns the mark.",
        },
      ])
    );
    expect(findings.filter((f) => f.rule === 2)).toHaveLength(0);
  });

  it('does not treat "both sides" as a two-condition mark', () => {
    // FA1 Q10(a). Multiplying both sides of an equation is one operation.
    const findings = validateRubric(
      draftOf([
        {
          prompt: "Rearrange this formula so that h is alone. Show every step. A bare answer earns 0.",
          marks: 2,
          markScheme: "M1 for multiplying both sides by 2: 2A = bh. A1 for h = 2A/b.",
        },
      ])
    );
    expect(codesOf(findings)).not.toContain("single-mark-two-conditions");
  });

  it("catches a conjunct stated in a later sentence than its award", () => {
    // FA1 Q3(a) opens "A1." and puts the condition in the next sentence, so a
    // clause-by-clause scan finds an award with no condition and a condition
    // with no award, and reports nothing.
    const findings = validateRubric(
      draftOf([
        {
          prompt: "Write the additive inverse of d. Then write the sum of d and its inverse.",
          marks: 1,
          markScheme: "A1. Both parts are needed for the single mark.",
        },
      ])
    );
    expect(codesOf(findings)).toContain("single-mark-two-conditions");
  });

  // -- Rules 3 and 4 --------------------------------------------------------
  it("catches a principle that names a part whose scheme contradicts it", () => {
    // FA1 markingPrinciples #3 names Q4 and demands units; Q4(d) requires none.
    const findings = validateRubric(
      draftOf(
        [withSubparts([{ prompt: "Explain what 28a+16c means.", marks: 1, markScheme: "R1. Must refer to the whole group, not just one part." }])],
        ["Interpretation requires the quantity and its units. In Q1, an answer naming only the number does not earn the mark."]
      )
    );
    expect(codesOf(findings)).toContain("principle-not-reflected-in-scheme");
  });

  it("catches follow-through promised by a principle but absent from the part", () => {
    // FA1 markingPrinciples #2 names Q14(c) for FT; its scheme never says FT.
    const findings = validateRubric(
      draftOf(
        [withSubparts([
          { prompt: "Find every pair (j, c) that works.", marks: 2,
            markScheme: "M1 for a visible ordered search. A1 for all four pairs." },
        ])],
        ["Hence is marked on evidence of reuse. In Q1(a), if the earlier result is wrong, FT applies and full marks are still available."]
      )
    );
    expect(codesOf(findings)).toContain("follow-through-promised-not-stated");
  });

  it("does not flag a part that restates the follow-through it was promised", () => {
    // FA1 Q13(c) does restate FT, so the principle and the part agree.
    const findings = validateRubric(
      draftOf(
        [withSubparts([
          { prompt: "Hence calculate the total price when p=640.", marks: 1,
            markScheme: "A1. Requires substitution into the student's own (b). FT: a student whose (b) is p+0.07p but who substitutes correctly still earns the mark. Evidence of reuse, not restarting." },
        ])],
        ["In Q1(a), if the earlier result is wrong, FT applies and full marks are still available."]
      )
    );
    expect(codesOf(findings)).not.toContain("follow-through-promised-not-stated");
  });

  // -- Rule 5 ---------------------------------------------------------------
  it("catches a scheme that is nothing but its own mark code", () => {
    // FA1 had six of these; Q11(a) is a bare "A1." on a part only 44% passed.
    const findings = validateRubric(
      draftOf([
        { prompt: "Write the greatest common factor of 54y and -36.", marks: 1, markScheme: "A1." },
      ])
    );
    expect(codesOf(findings)).toContain("bare-scheme");
  });

  it("does not flag a short scheme that still states a criterion", () => {
    // FA1 Q13(a) is only 18 characters and is perfectly markable.
    const findings = validateRubric(
      draftOf([
        { prompt: "Write an expression for the tax.", marks: 1, markScheme: "A1. Accept 7p/100." },
      ])
    );
    expect(codesOf(findings)).not.toContain("bare-scheme");
  });

  // -- Rule 6 ---------------------------------------------------------------
  it("warns on an explanation part with no stated exclusion", () => {
    const findings = validateRubric(
      draftOf([
        { prompt: "Explain why j and c must be whole numbers.", marks: 1, markScheme: "R1." },
      ])
    );
    const r6 = findings.find((f) => f.rule === 6);
    expect(r6?.code).toBe("explanation-without-exclusion");
    expect(r6?.severity).toBe("warn");
  });

  it("does not warn when the explanation scheme names what earns nothing", () => {
    // FA1 Q14(d): "'I checked them all' with no evidence earns 0."
    const findings = validateRubric(
      draftOf([
        { prompt: "Explain how you know there are no other pairs.", marks: 1,
          markScheme: "R1. The mark is for a closure argument -- a parity or bound argument. 'I checked them all' with no evidence earns 0." },
      ])
    );
    expect(codesOf(findings)).not.toContain("explanation-without-exclusion");
  });

  // -- Rule 7 ---------------------------------------------------------------
  it("catches a 'show every step' part with no bare-answer rule", () => {
    // FA1 Q10(a), verbatim.
    const findings = validateRubric(
      draftOf([
        { prompt: "Rearrange this formula so that h is alone on one side. Show every step.", marks: 2,
          markScheme: "M1 for multiplying both sides by 2: 2A = bh. A1 for h = 2A/b. Accept any valid order." },
      ])
    );
    expect(codesOf(findings)).toContain("working-command-without-bare-answer-rule");
  });

  it("does not flag a solve part that states what a bare answer earns", () => {
    // FA1 Q9(a): "A correct x=6 with no working scores M0M0A1."
    const findings = validateRubric(
      draftOf([
        { prompt: "Solve this equation. Show every step.", marks: 3,
          markScheme: "M1 for the left side expanded. M1 for terms collected: 2x = 12. A1 for x = 6. A correct x=6 with no working scores M0M0A1." },
      ])
    );
    expect(codesOf(findings)).not.toContain("working-command-without-bare-answer-rule");
  });

  // -- Rule 10 --------------------------------------------------------------
  it("catches a scheme crediting the unsimplified form the question never asked for", () => {
    // FA1 Q8(a), verbatim. 42 students wrote 6k - 12 + 5k - 6; 24 were given
    // the mark and 18 were refused it for also writing 11k - 18 on the answer
    // line, a rule that appears nowhere in the question or the scheme.
    const findings = validateRubric(
      draftOf([
        {
          prompt: "Expand the brackets in 3(2k-4)+5k-6. Write the result.",
          marks: 1,
          markScheme: "A1 for the correctly distributed, unsimplified expression 6k - 12 + 5k - 6.",
        },
      ])
    );
    expect(codesOf(findings)).toContain("unsimplified-required-not-asked");
    expect(findings.find((f) => f.rule === 10)?.severity).toBe("block");
  });

  it("catches a question forbidding simplification whose scheme never marks it", () => {
    // FA1 Q7(a): the question says "Do not simplify further" and the scheme
    // is silent on what a simplified answer earns -- the mirror of Q8(a), and
    // the one mistake that instruction invites.
    const findings = validateRubric(
      draftOf([
        {
          prompt:
            "Use the distributive property to rewrite the expression. Multiply -2 by each term inside the brackets. Do not simplify further.",
          marks: 1,
          markScheme: "A1. '8 - 6z + 10 + 4z' is the diagnostic error here -- 0 for (a), but FT through (b).",
        },
      ])
    );
    expect(codesOf(findings)).toContain("no-simplify-asked-not-marked");
  });

  it("passes a part where the question and the scheme agree about simplifying", () => {
    const findings = validateRubric(
      draftOf([
        {
          prompt: "Expand the brackets. Do not simplify further.",
          marks: 1,
          markScheme: "A1 for the unsimplified expansion 6k - 12 + 5k - 6; a simplified 11k - 18 earns 0.",
        },
        {
          prompt: "Now simplify your expression from part (a) as far as possible.",
          marks: 2,
          markScheme: "M1 for like terms collected. A1 for -2z - 2.",
        },
      ])
    );
    expect(findings.filter((f) => f.rule === 10)).toHaveLength(0);
  });

  // -- Rule 8 ---------------------------------------------------------------
  it("counts allocated codes without counting codes named in an exception", () => {
    // FA1 Q8(b) mentions R1 three times but allocates M1 + R1 = 2, which matches.
    const findings = validateRubric(
      draftOf([
        { prompt: "Show that these two expressions are equal.", marks: 2,
          markScheme: "M1 for collecting like terms from their (a) to reach 11k - 18. R1 for a stated conclusion (the R1 is for the conclusion, not the algebra -- working that stops at 11k-18 with no closing statement earns M1R0)." },
      ])
    );
    expect(codesOf(findings)).not.toContain("code-sum-mismatch");
  });

  it("warns when the allocated codes do not sum to the part's marks", () => {
    const findings = validateRubric(
      draftOf([
        { prompt: "Solve and show every step.", marks: 3,
          markScheme: "M1 for a correct first step. A1 for the answer. A bare answer earns 0." },
      ])
    );
    const r8 = findings.find((f) => f.rule === 8);
    expect(r8?.code).toBe("code-sum-mismatch");
    expect(r8?.message).toContain("2 mark(s)");
    expect(r8?.severity).toBe("warn");
  });

  // -- Rule 9 ---------------------------------------------------------------
  it("warns when one code is gated on two conditions", () => {
    // FA1 Q3(b): a single A1 requiring d != 0 AND the product being 1.
    const findings = validateRubric(
      draftOf([
        { prompt: "Write the reciprocal of d, the value d cannot equal, and the product.", marks: 2,
          markScheme: "A1 for 1/d. A1 for both d != 0 AND the product is 1 -- one of the two alone earns 0." },
      ])
    );
    const r9 = findings.find((f) => f.rule === 9);
    expect(r9?.code).toBe("single-mark-two-conditions");
    expect(r9?.severity).toBe("warn");
  });

  // -- summary + robustness --------------------------------------------------
  it("treats warnings as publishable and blocks only on blocking findings", () => {
    const warnOnly = summarizeRubricFindings(
      validateRubric(
        draftOf([
          { prompt: "Explain your reasoning.", marks: 1, markScheme: "R1. Award for a stated reason." },
        ])
      )
    );
    expect(warnOnly.blocking).toBe(0);
    expect(warnOnly.publishable).toBe(true);

    const blocked = summarizeRubricFindings(
      validateRubric(draftOf([{ prompt: "Write the GCF.", marks: 1, markScheme: "A1." }]))
    );
    expect(blocked.blocking).toBeGreaterThan(0);
    expect(blocked.publishable).toBe(false);
  });

  // -- the save gate ---------------------------------------------------------
  describe("shouldHoldForRubricReview", () => {
    const blocking = validateRubric(
      draftOf([{ prompt: "Write the GCF.", marks: 1, markScheme: "A1." }])
    );
    const clean = validateRubric(
      draftOf([
        { prompt: "Write the GCF.", marks: 1, markScheme: "A1. Accept 18 only; 18y earns 0." },
      ])
    );

    it("holds a blocking draft until it is acknowledged", () => {
      expect(shouldHoldForRubricReview(blocking, undefined)).toBe(true);
      expect(shouldHoldForRubricReview(blocking, true)).toBe(false);
    });

    it("never holds a draft with nothing blocking", () => {
      expect(summarizeRubricFindings(clean).blocking).toBe(0);
      expect(shouldHoldForRubricReview(clean, undefined)).toBe(false);
    });

    it("requires exactly true, so a stray truthy value cannot wave a paper through", () => {
      // The value reaches this from a JSON body and, on the client, from a
      // click handler -- `onClick={handleSave}` would pass React's mouse
      // event straight into it. Anything short of an explicit true would
      // skip the review the gate exists to force.
      for (const sneaky of ["true", 1, {}, [], "yes", new Date()]) {
        expect(shouldHoldForRubricReview(blocking, sneaky)).toBe(true);
      }
    });
  });

  it("returns findings rather than throwing on a malformed draft", () => {
    // This runs on model output, which can be missing anything at all.
    const empty = { title: "", subtitle: "", instructions: [], sections: [] } as AssignmentDraft;
    expect(validateRubric(empty)).toEqual([]);

    const noScheme = validateRubric(
      draftOf([{ prompt: "Explain why.", marks: 1 } as AssignmentQuestion])
    );
    expect(codesOf(noScheme)).toContain("bare-scheme");
  });

  it("addresses findings to the same part labels the grader will use", () => {
    // Subparts must come back as Q1(a)/Q1(b), matching buildTestItemsFromSections,
    // so a finding points at the row a teacher can actually open.
    const findings = validateRubric(
      draftOf([
        withSubparts([
          { prompt: "First part.", marks: 1, markScheme: "A1." },
          { prompt: "Second part.", marks: 1, markScheme: "A1." },
        ]),
      ])
    );
    expect(findings.map((f) => f.part)).toEqual(["Q1(a)", "Q1(b)"]);
  });
});
