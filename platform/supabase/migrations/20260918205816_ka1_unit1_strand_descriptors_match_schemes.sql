-- KA1 Unit 1: the strand descriptors still carried the demands the 18 Sep
-- rewrite withdrew from the parts themselves.
--
-- Migration 20260918123826 corrected Q7(d), Q9(a) and Q9(c) so that none of
-- them requires what its printed question never asked. It did not touch
-- tests.standards_rubric, and buildStandardsRubricBlock() puts those strand
-- descriptors into the SAME grading prompt as the corrected schemes, where
-- section 5 of the Standard Level policy tells the grader to use them to
-- decide what a part-way answer is worth. So both withdrawn demands were
-- still live guidance:
--
--   strand D, Exceeding: "gives a counterexample AND a correct condition for
--     whole-number groups" -- the Q7(d) demand removed as unasked -- and
--     "links 3n and +1 to parts of the figure" -- the Q9(c) demand replaced
--     by a link to the student's own part (a).
--   strand C, Exceeding: "Describes the tile pattern by naming which parts
--     grow and by how much" -- the surviving half of the Q9(a) clause that
--     cost nine of fifteen students marks for their vocabulary.
--
-- Both are rewritten to what the corrected schemes actually mark on. Strand C
-- Meeting already read "names where the new tiles go", which is right, and is
-- left alone; so are strands A and B, whose live text is already correct.
--
-- jsonb_set on the one strand's descriptors rather than a rewrite of the
-- whole column, so a later teacher edit elsewhere in the rubric survives.
-- The array index is guarded by the strand's own code, so the statement is a
-- no-op rather than a corruption if the strand order ever changes.
--
-- No accepted mark moves: this test has 390 AI suggestions and 0 accepted.
-- Generated from platform/lib/fixtures/g9-standard-ka1-unit1.ts.

update public.tests
   set standards_rubric = jsonb_set(standards_rubric, '{strands,2,descriptors}', '{"exceeding":"Describes alternating and repeating patterns precisely. Uses the position of a term (odd or even, groups of three) to find a far term (the 40th term is 68) and sums without listing. Describes the tile pattern well enough that a reader could draw the next figure, in whatever words.","meeting":"Describes the patterns correctly and finds nearby terms and sums. Finds the far term with a mostly correct method, with a small counting slip. The tile description names where the new tiles go.","approaching":"Describes the patterns only partly (\"it goes down and then up\"). Finds far terms by listing, with errors. The tile description gives only the total change (\"it adds 3\").","beginning":"Pattern descriptions are incorrect or missing. Cannot extend a pattern beyond the terms shown."}'::jsonb)
 where id = 'a1c0f4e2-9d00-4b7e-8c21-000000000001'
   and standards_rubric->'strands'->2->>'code' = 'C';

update public.tests
   set standards_rubric = jsonb_set(standards_rubric, '{strands,3,descriptors}', '{"exceeding":"Justifies every conclusion completely: -52 is not a term because n is not a whole number; k is not a multiple of 3 because each group of three terms adds to 0; shows that the number of groups is not always whole, by a counterexample or by the multiple-of-5 reason; relates the rule 3n + 1 to the growth described in part (a).","meeting":"Reaches correct conclusions with mostly complete reasoning. One argument relies on examples rather than a general rule, or one explanation is missing a step.","approaching":"Gives correct conclusions with little justification. Reasons from a single example, or explanations just restate the answer.","beginning":"Conclusions are missing or incorrect, with no reasoning given."}'::jsonb)
 where id = 'a1c0f4e2-9d00-4b7e-8c21-000000000001'
   and standards_rubric->'strands'->3->>'code' = 'D';