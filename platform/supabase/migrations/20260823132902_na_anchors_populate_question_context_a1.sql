
-- Populates question_text/question_marks for packet version 1462a2f2 (A.1).
--
-- Mapping is ORDINAL: the Nth distinct base_qid (by sort_order) maps to
-- the Nth question in nuanced_analyses.parts[].questions[]. That sounds
-- fragile, so it was verified before being relied on: all 24 base
-- questions that have exactly ONE anchor match their parts marks total
-- exactly (diff = 0 across every one). Only the 6 multi-anchor questions
-- differ, which is the separate mis-split bug this does NOT touch --
-- marks_available is deliberately left alone here.
with parts_q as (
  select row_number() over () as qnum,
         (q.value->>'marks')::int as parts_marks,
         q.value->>'prompt' as prompt
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
set question_text  = pq.prompt,
    question_marks = pq.parts_marks
from bases b
join parts_q pq on pq.qnum = b.bnum
where a.packet_version_id = '1462a2f2-fc2a-4bab-8135-ed3aefeb0aff'
  and a.base_qid = b.base_qid;
;
