# Formative Assessment — Marking Principles

Scope: this policy governs grading of a custom, teacher-authored Formative
Assessment — a test whose questions and mark scheme were created inline
through the Formative Assessment creator, not resolved from the IB question
bank. It is loaded into the grading system prompt automatically whenever at
least one part being graded is a `source = 'custom'` test item — see
`isCustomAssessment()` in `lib/ai-grading.ts`.

Where this policy is more specific than the general marking rules earlier
in this prompt, follow this policy. It does not override anything else in
the general rules (method marks, follow-through, mark scheme authority,
etc.) — it sharpens how a custom, free-text M/A/R/FT mark scheme is applied
when the question bank's own conventions (`ib_questions`/`question_parts`)
aren't available to fall back on.

## 1. Mark codes

The mark scheme text for each part uses the same M/A/R/FT convention as the
general marking rules:

- **M (method)** — awarded for a correct process that is *visible*: a
  distribution written out, a substitution shown, an inverse operation
  applied to both sides, a systematic search begun. Never award an M mark
  retrospectively purely because the final answer is correct.
- **A (answer)** — a correct value, expression, or classification. Usually
  depends on a preceding M mark where the mark scheme pairs them.
- **R (reasoning)** — a valid explanation, interpretation, justification, or
  conclusion. A restatement of the result ("because it is correct") is not
  reasoning.
- **FT (follow-through)** — if an earlier part is wrong but a later part
  correctly reuses that wrong value, award the later part's marks anyway.
  Applies throughout, and especially to any part built on the word "hence."

## 2. Bare answers earn no method marks

Where the question's command term is Solve, Show, Determine, or Hence, a
correct final answer with no working shown earns 0 for any M-coded portion
of that part's marks — the working is what is being assessed, not just the
destination.

## 3. "Hence" is marked on evidence of reuse

A part built on the word "hence" must be marked on whether the student
substituted or reused their OWN result from an earlier part in this same
question. A correct number obtained by restarting from the original given
values, rather than by reusing the student's prior answer, earns 0 for that
part — even though the number itself is correct. If the earlier result was
wrong, follow-through still applies: correct reuse of an incorrect earlier
value earns full marks for the "hence" part.

## 4. Interpretation requires the quantity and its units

A part asking what a number or expression means in context is marked on
contextual meaning, not on re-describing the algebra. An answer that names
only the number, or restates which term of the expression it is, without
stating what it represents in the given units, does not earn the mark.

## 5. Explanation requires a reason, not a verdict

A part asking for an explanation is marked on a stated reason. A bare
verdict ("because it is wrong," "because they are not the same") does not
earn the mark on its own — the reason WHY must be present.

## 6. Accept equivalent correct forms

Unless a part explicitly specifies a required form (e.g. "give your answer
as a fraction in its lowest terms," "give an exact answer"), accept any
mathematically equivalent correct form of an answer — a different but valid
algebraic rearrangement, an unsimplified-but-correct fraction where
simplification wasn't asked for, or an equivalent unit expression.

## 7. Do not double-penalise

A single error (a sign slip, a mis-copied value) that is then carried
correctly through the rest of a multi-step working should cost the mark for
that one error once — not again at every later step that correctly used the
carried-through value. This is exactly what follow-through (FT) marks are
for.
