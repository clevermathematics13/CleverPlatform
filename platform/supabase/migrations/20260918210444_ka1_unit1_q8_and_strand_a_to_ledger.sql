-- KA1 Unit 1: make the ledger reproduce production for Q8 and strand A.
--
-- Q8's live mark scheme and strand A's live descriptors were corrected
-- through the app, not through a migration. The correction itself is right
-- and is already live: Q8 no longer caps a substitute-and-verify route at 2
-- marks as "guess-and-check", because the question asks for algebraic steps
-- and does not prescribe a method, so both routes are complete algebra. But
-- no migration in this directory produces that text -- the seed
-- (20260915165036) still writes the pre-correction wording. A replay of the
-- ledger from empty would therefore rebuild the OLD scheme and silently undo
-- a fix that had cost students marks, which is exactly the drift the
-- CLAUDE.md 1:1 rule exists to prevent.
--
-- Both statements set the live values to the same live values, so this is a
-- verified no-op against production today. Its only effect is on a replay.
-- The fixture platform/lib/fixtures/g9-standard-ka1-unit1.ts was brought up
-- to the live text in the same commit, and this SQL is generated from it.
--
-- No accepted mark moves: this test has 0 accepted marks.

update public.test_items set markscheme_text = 'The question asks for the values of $j$ and $k$ and for algebraic steps; it does not prescribe a method, so ANY valid algebraic route to $j = 4$, $k = 7$ earns all 5 marks. Route 1 (match coefficients): $3(x + k) + j(2x - 4) = 3x + 3k + 2jx - 4j = (3 + 2j)x + (3k - 4j)$; matching with $11x + 5$ gives $3 + 2j = 11$ so $j = 4$, and $3k - 4j = 5$ so $3k - 16 = 5$ and $k = 7$. Route 2 (substitute and verify): $3(x + 7) + 4(2x - 4) = 3x + 21 + 8x - 16 = 11x + 5$, which IS Expression B, so $j = 4$ and $k = 7$ are the values that make the two expressions equivalent. Route 2 is a complete algebraic argument and earns the same 5 marks as Route 1 - do not cap it, and do not call it guess-and-check. Answer: $j = 4$, $k = 7$. 5 marks: one for expanding both brackets correctly (either $3x + 3k + 2jx - 4j$, or $3x + 21 + 8x - 16$ once the values are substituted); one for collecting into a single linear expression (either $(3 + 2j)x + (3k - 4j)$, or $11x + 5$); one for $j = 4$; one for work connecting the constant terms (either $3k - 4j = 5$, or $21 - 16 = 5$); one for $k = 7$. Judge each of the five on its own evidence, whichever route the student took. A copying slip when restating Expression A - for example writing $4(6x - 4)$ but expanding it correctly as $8x - 16$ - is a notation slip, not an expansion error. Correct values with no working at all earn the two answer marks.'
 where test_id = 'a1c0f4e2-9d00-4b7e-8c21-000000000001' and question_number = 8 and part_label = '';

update public.tests
   set standards_rubric = jsonb_set(standards_rubric, '{strands,0,descriptors}', '{"exceeding":"Evaluates every expression accurately, including negatives, brackets and powers, with each substitution shown. Writes (84 - x) / 5 with correct grouping and uses it. Finds j = 4 and k = 7 with complete algebra by any valid route - matching coefficients, or substituting the values and expanding to show the two expressions are equivalent.","meeting":"Evaluates most expressions correctly, with one slip in signs or order of operations. Writes and uses a correct expression from the context. Finds j and k with algebra shown, by any route, with at most one small error or missing step.","approaching":"Substitutes correctly but makes repeated sign or order-of-operations errors. The context expression is missing its brackets, or only the numerical cases are right. Expands Expression A but does not reach both values.","beginning":"Substitution is incomplete or incorrect. Cannot represent the context with an expression. Makes little or no progress with equivalent expressions."}'::jsonb)
 where id = 'a1c0f4e2-9d00-4b7e-8c21-000000000001'
   and standards_rubric->'strands'->0->>'code' = 'A';
