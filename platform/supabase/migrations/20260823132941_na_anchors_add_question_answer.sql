
-- The answer key currently in na_anchors.answer_sketch comes from
-- teacher_companion.answerSketches, which is a terse one-line-per-question
-- summary. nuanced_analyses.parts[].questions[].answer is a separate,
-- richer authored key -- and materially better for marking. Q1 is the
-- clearest example found:
--   answer_sketch (in use):  "(e) they agree."
--   parts answer (this col): "(e) Accept any observation that (c) and (d) agree."
-- The second is explicitly permissive about wording; the first reads like
-- a required phrase. A student who wrote "they are different ways to get
-- to the answer of 750" satisfies the second and was marked down against
-- the first.
--
-- Added as a NEW column rather than overwriting answer_sketch so both
-- sources remain available and the change is reversible -- which of the
-- two the prompt actually uses is a separate, deliberate decision.
alter table na_anchors
  add column if not exists question_answer text;

comment on column na_anchors.question_answer is
  'Authoritative answer key from nuanced_analyses.parts[].questions[].answer. Richer and more permissive than answer_sketch (which comes from the terser teacher_companion.answerSketches). Both retained deliberately.';

with parts_q as (
  select row_number() over () as qnum,
         q.value->>'answer' as answer
  from nuanced_analyses n,
       lateral jsonb_array_elements(n.parts) p,
       lateral jsonb_array_elements(p->'questions') q
  where n.id = (
    select nuanced_analysis_id from na_packet_versions
    where id = '1462a2f2-fc2a-4bab-8135-ed3aefeb0aff'
  )
),
bases as (
  select base_qid,
         dense_rank() over (order by min(sort_order)) as bnum
  from na_anchors
  where packet_version_id = '1462a2f2-fc2a-4bab-8135-ed3aefeb0aff'
  group by base_qid
)
update na_anchors a
set question_answer = pq.answer
from bases b
join parts_q pq on pq.qnum = b.bnum
where a.packet_version_id = '1462a2f2-fc2a-4bab-8135-ed3aefeb0aff'
  and a.base_qid = b.base_qid;
;
