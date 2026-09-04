-- lib/ai-grading.ts's MarkschemeSource type (and assembleMarkScheme's
-- custom-test_items branch, added for the Formative Assessment feature)
-- already produce markscheme_source = 'custom', but this CHECK constraint
-- was never updated to match -- every grading run against a custom
-- (non-IB-bank) assessment succeeded through the model call and then failed
-- at the final ai_grade_results insert, discarding the result. Confirmed
-- via ai_grade_runs.error on Formative Assessment 1 (f5221cd9-66b1-48cd-
-- bfe3-652d87df26b2): "new row for relation \"ai_grade_results\" violates
-- check constraint \"ai_grade_results_markscheme_source_check\"".
alter table ai_grade_results
  drop constraint ai_grade_results_markscheme_source_check;

alter table ai_grade_results
  add constraint ai_grade_results_markscheme_source_check
  check (markscheme_source = any (array['part_latex', 'part_text', 'whole_question', 'draft', 'custom', 'none']));
