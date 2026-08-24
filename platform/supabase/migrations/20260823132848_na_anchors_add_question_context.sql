
-- Stage 5 assessment has never been able to see WHAT THE QUESTION ASKED --
-- na_anchors only carried an answer key. For a question like Q1(e)
-- ("Write down one thing you notice about your answers to (c) and (d)")
-- that is a real handicap: the model marks a written observation with no
-- idea what observation was requested.
--
-- question_text: the authoritative prompt from nuanced_analyses.parts.
-- question_marks: the authoritative WHOLE-QUESTION mark total, kept
--   separate from marks_available (which is this anchor's own share) so
--   a mis-split between sub-part anchors is detectable rather than
--   silent -- exactly the bug found here, where Q1's anchors summed to 5
--   against a true total of 4.
alter table na_anchors
  add column if not exists question_text text,
  add column if not exists question_marks integer;

comment on column na_anchors.question_text is
  'The full question prompt as authored, from nuanced_analyses.parts[].questions[].prompt. Shown to the assessment model so it knows what was actually asked, not just the expected answer.';

comment on column na_anchors.question_marks is
  'Authoritative mark total for the WHOLE base question. marks_available is this individual anchor''s share; the shares for one base_qid should sum to this. A mismatch means the anchor split is wrong.';
;
