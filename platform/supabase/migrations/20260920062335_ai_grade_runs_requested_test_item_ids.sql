-- A grading run that was asked to mark only some parts of the paper.
--
-- Until now every run marked every gradeable part, so a teacher who wrote a
-- ruling on one part (test_items.marking_notes) and wanted the class marked
-- to it paid for the whole paper again per student -- about 6.5k output
-- tokens of which the one part is a few hundred. A run with this column set
-- sends only those parts to the model; the collect step copies the other
-- parts' rows, acceptance included, from the student's previous complete run
-- into the new one, so the review panel still shows a whole paper.
--
-- Null means the run covers every part, exactly as before.

alter table public.ai_grade_runs
  add column if not exists requested_test_item_ids uuid[];

comment on column public.ai_grade_runs.requested_test_item_ids is
  'The test_items this run was asked to mark; null means every gradeable part. Other parts are copied from the previous complete run at collect time (lib/ai-grading-run.ts persistGradeOutcome).';
