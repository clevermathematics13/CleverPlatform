
-- Populates the rubric for "Sixty Times a Person" (A.1) from the
-- authoritative parts[] data, one row per ANCHOR so that sub-parts with
-- their own answer boxes (Q1(e), Q13(b), Q13(c), ...) each get their own
-- editable rubric entry rather than sharing the parent's.
--
-- answer_key/question_text/question_marks come from parts[].questions[];
-- marks, command_term, open_rubric and misconception_context come from
-- the anchor, which already had per-sub-part values.
with parts_q as (
  select row_number() over () as qnum,
         (q.value->>'marks')::int as parts_marks,
         q.value->>'prompt' as prompt,
         q.value->>'answer' as answer
  from nuanced_analyses n,
       lateral jsonb_array_elements(n.parts) p,
       lateral jsonb_array_elements(p->'questions') q
  where n.id = 'aabd94f4-aa08-405e-bccb-5003d31696cb'
),
bases as (
  select base_qid,
         dense_rank() over (order by min(sort_order)) as bnum
  from na_anchors
  where packet_version_id = '1462a2f2-fc2a-4bab-8135-ed3aefeb0aff'
  group by base_qid
)
insert into na_rubric_items (
  nuanced_analysis_id, qid, base_qid, question_number,
  question_text, answer_key, open_rubric, misconception_context,
  command_term, marks, question_marks, source
)
select
  'aabd94f4-aa08-405e-bccb-5003d31696cb',
  a.qid,
  a.base_qid,
  b.bnum,
  pq.prompt,
  pq.answer,
  a.open_rubric,
  a.misconception_context,
  a.command_term,
  a.marks_available,
  pq.parts_marks,
  'generated'
from na_anchors a
join bases b on b.base_qid = a.base_qid
join parts_q pq on pq.qnum = b.bnum
where a.packet_version_id = '1462a2f2-fc2a-4bab-8135-ed3aefeb0aff'
on conflict (nuanced_analysis_id, qid) do nothing;
;
