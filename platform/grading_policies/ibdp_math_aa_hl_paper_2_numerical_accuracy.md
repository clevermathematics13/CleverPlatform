# IBDP Mathematics: Analysis and Approaches HL Paper 2 — Numerical Accuracy Policy

Scope: this policy governs how the AI grader treats rounding, significant
figures, and exact-vs-decimal answers for IBDP Mathematics: Analysis and
Approaches HL, Paper 2 (a GDC/calculator paper). It is loaded into the
grading system prompt automatically whenever at least one part being graded
belongs to a question tagged AA / AHL / Paper 2 in the PPQ bank — see
`isAaHlPaper2()` in `lib/ai-grading.ts`.

Where this policy is more specific than the general marking rules earlier
in this prompt, follow this policy for numerical accuracy. It does not
override anything else in the general rules (method marks, follow-through,
mark scheme authority, etc.) — it sharpens how "does this numerical value
earn its accuracy mark" is decided.

## 1. Order of precedence

Apply requirements in this order:

1. The supplied question-specific mark scheme, rubric notes, and explicitly
   accepted alternative answers.
2. An accuracy or answer-form instruction in the question itself, such as:
   - "correct to four significant figures"
   - "correct to two decimal places"
   - "give an exact answer"
   - "give your answer in the form..."
   - "give an integer value"
3. If neither of the above specifies otherwise, apply the Paper 2 default:
   - accept an exact value; or
   - require a correctly rounded value to three significant figures.

A question-specific mark scheme can explicitly allow an answer that would
otherwise appear to violate the default.

## 2. Marks affected by an accuracy error

A rounding or significant-figure error affects only the final Answer/Accuracy
mark associated with that numerical result.

- Do not impose a separate whole-paper accuracy penalty.
- Do not use the historical "one accuracy penalty per paper" rule.
- Do not deduct an arbitrary mark from the paper total.
- Withhold only the final A mark or accuracy mark attached to the affected
  result.
- Preserve all correctly earned Method marks and Reasoning marks.
- Do not describe the whole solution as incorrect when only the final
  numerical presentation is defective.
- Do not deduct twice for the same accuracy error.

If a subpart has:

- one final A1: an accuracy error normally changes that A1 to A0;
- separate final answers marked A1A1: evaluate the accuracy of each result
  separately;
- a combined A2 or another unsplittable award: follow the question-specific
  mark scheme. Do not automatically assume that the maximum loss is one mark;
- only one mark, awarded for the numerical answer: an accuracy error can
  result in 0/1.

If no detailed mark allocation is supplied, use one mark as the default
final numerical-answer mark while preserving credit for demonstrably correct
method and reasoning.

## 3. Exact answers

Accept mathematically exact answers under the default rule. Examples
include: fractions, radicals, expressions involving π, e, or logarithms,
exact terminating decimals, and exact integers.

Do not require an exact integer such as 8 to be written as 8.00.

A longer decimal is acceptable as an exact answer only when it is genuinely
equal to the mathematical value — not merely a longer calculator
approximation.

If the question explicitly requests a decimal answer to a stated accuracy,
an exact expression by itself does not satisfy that instruction. The student
must also provide the requested rounded value.

If the question explicitly requires an exact answer, a decimal approximation
by itself does not earn the final answer mark.

## 4. Default three-significant-figure rule

When no different accuracy is specified, a non-exact final numerical answer
must be correctly rounded to three significant figures.

Examples:

- 1.23456... -> 1.23
- 0.0066048... -> 0.00660
- 16.513... -> 16.5
- 6.596... -> 6.60

Apply conventional rounding: inspect the first discarded digit and round the
last retained digit appropriately.

Treat the following as accuracy errors:

- incorrect rounding, such as 1.23456... -> 1.24;
- too few significant figures, such as 1.23456... -> 1.2;
- truncation instead of rounding;
- a final value changed by premature rounding;
- failure to provide the required number of significant figures.

## 5. Excess significant figures

If a student gives a non-exact final calculator approximation with more
significant figures than required, classify it as an incorrect level of
accuracy and withhold the corresponding final accuracy mark, unless:

- the question-specific mark scheme explicitly accepts that value;
- the value is mathematically exact;
- the rubric explicitly permits additional significant figures; or
- an existing project configuration deliberately uses a more lenient
  excess-precision policy.

Record this as a presentation/accuracy issue, not a calculation error.

Do not apply this rule to full-precision intermediate values. Students
should retain additional digits during their working.

## 6. Explicit significant figures or decimal places

When the question specifies an accuracy, enforce that accuracy. For example,
if the exact calculator value is 1.056140... and the question requests four
significant figures:

- 1.056: correct;
- 1.06: incorrect level of accuracy;
- 1.056140...: does not provide the requested four-significant-figure final
  presentation unless explicitly accepted by the mark scheme.

Distinguish significant figures from decimal places. Examples:

- 6.60 has three significant figures and two decimal places.
- 0.00660 has three significant figures.
- 6.6 has two significant figures and one decimal place.
- Leading zeros are not significant.
- Zeros between non-zero digits are significant.
- Trailing zeros after a decimal point are significant.

Do not penalize a whole-number answer such as 120 solely because its
trailing zeros are typographically ambiguous when it is numerically the
correct requested rounded value. Scientific notation such as 1.20x10^2 is
preferable when precision needs to be made explicit, but should not be
mandatory unless the rubric requires it.

## 7. Intermediate rounding

Do not independently penalize a rounded intermediate value merely because it
appears in the working. Students should retain and reuse the full
calculator value in subsequent calculations, even after reporting a rounded
answer for an earlier part.

If premature rounding produces an incorrect later final answer:

- preserve valid method marks;
- withhold the affected final A mark;
- award follow-through marks where the mark scheme permits them;
- explain that the later error resulted from using a prematurely rounded
  value.

For example, if Part (a) gives x = 6.556666... ≈ 6.56, the displayed final
answer to Part (a) can be 6.56, but subsequent calculations should use the
stored value 6.556666..., not 6.56.

## 8. Follow-through

When a student correctly uses an earlier incorrect or prematurely rounded
value in a later part:

- award Method marks for a valid later method;
- award FT marks when allowed;
- do not award the later final A mark if the result remains numerically
  incorrect;
- do not repeatedly penalize the original error beyond the marks affected
  by it.

Within a single part, once an incorrect value is used, subsequent A marks
depending on that value are normally unavailable, although Method marks may
remain available.

## 9. Correct exact value followed by an incorrect decimal

If the student clearly gives a correct exact value and then follows it with
an incorrect decimal approximation:

- accept the correct exact value and award the final A mark for that part,
  unless the question explicitly required a decimal approximation;
- note the incorrect decimal in feedback;
- if the incorrect decimal is carried into a subsequent part, award
  appropriate Method or FT marks there but withhold the later final A mark
  if the final result is incorrect.

## 10. Context and special answers

Respect contextual requirements such as: numbers of people or objects
requiring integer answers; years or dates; probabilities between 0 and 1;
measurements with units; monetary values when the question explicitly
requests cents, whole currency units, or another precision.

Do not invent a universal "all currency answers must be two decimal places"
exception. Follow the question and its mark scheme.

Do not apply a significant-figure penalty to an exact count or exact integer
merely because it is not written with three displayed digits.

## 11. Feedback language

When an accuracy mark is withheld, give precise feedback, for example:

- "The method is correct, but the final value should be 6.60 to three
  significant figures. Award A0 for the final accuracy mark; retain the
  method marks."
- "The answer was truncated rather than rounded."
- "The question requested four significant figures; 1.06 has only three."
- "The full calculator value should have been retained for the calculation
  in the next part."
- "The exact answer is correct, so the final A mark is awarded despite the
  incorrect decimal approximation that follows."

Never say only "wrong significant figures." State: the required accuracy,
the student's error, the correct presentation, and exactly which mark is
affected. Write this into the `reasoning` field for the affected item.

## 12. Numerical comparison and the `numericCheck` field

When you itemize a `markBreakdown` token that is a final Answer/Accuracy
mark tied to a specific numerical value, in addition to the normal
`token`/`awarded`/`note` fields, also populate `numericCheck` on that entry:

```json
{
  "token": "A1",
  "awarded": true,
  "note": "...",
  "numericCheck": {
    "reportedValue": "8.52",
    "referenceValue": "8.51693",
    "precisionType": "sf",
    "precisionDigits": 3
  }
}
```

- `reportedValue`: the exact final numeric value the student wrote for this
  mark, as plain text (no units, no surrounding words) — e.g. "8.52", not
  "8.52 mins".
- `referenceValue`: the correct value at full precision (the exact
  mathematical value, or the mark scheme's own unrounded value), as plain
  text. Give as much precision as you have — the grader rounds it itself.
  Some mark schemes give more than one accepted final value because two
  equally valid computation paths lead to different results — most often
  one path that carries an earlier rounded intermediate value (e.g. a
  student's own 3sf answer from an earlier part) and one that carries the
  full-precision value through instead (for example a mark scheme note
  reading "y = 261, (y = 260 from 3sf)" is stating two separate accepted
  values, not one value rounded two ways). When this happens, set
  `referenceValue` to whichever of those alternates corresponds to the
  intermediate values the student actually carried through their own
  working, not the other path's value — using the other path's value as
  `referenceValue` makes a genuinely accepted answer fail the deterministic
  recheck below even though it is correct.
- `precisionType`: `"exact"` when this mark requires an exact value (a
  decimal approximation never satisfies it), `"sf"` for a significant-figure
  requirement, or `"dp"` for a decimal-place requirement.
- `precisionDigits`: the number of significant figures or decimal places
  required (per section 1's precedence: question's own instruction, else
  mark scheme, else the Paper 2 default of 3 s.f.). Omit for `"exact"`.

Omit `numericCheck` entirely for tokens that are not a final numeric
accuracy mark (M marks, R marks, AG, or an A mark for a non-numerical
answer). The grader cross-checks `numericCheck` deterministically in code
against the stated precision and can override `awarded` for that token when
your own report is measurably wrong about rounding — populate it honestly
rather than to justify a lenient award; it does not help the student for
`referenceValue` or `precisionDigits` to be misreported, since a
deterministic recheck, not your own leniency, has the final say on this
one field.

- calculate or preserve a high-precision reference value;
- determine the correct rounded answer at the required precision;
- compare the student's written result with that rounded result;
- do not rely only on a broad floating-point tolerance;
- distinguish an exact value from an approximation;
- recognize meaningful trailing zeros;
- avoid binary floating-point artifacts when determining rounding
  boundaries.
