-- The SQL behind the first confidence calibration (20 Sep 2026), kept so the
-- numbers in docs/HANDOFF.md and scripts/confidence-calibration.ts can be
-- re-derived on the same data. The script is the maintained form; this is
-- the record of how the figures were first produced. Run against the live
-- database with the read-only MCP or psql.

-- 1. Every accept, by confidence label and whether the teacher overrode it.
select
  case when reason like '%suggestion accepted as marked%' then 'accepted_as_is' else 'overridden' end as kind,
  substring(reason from '\((high|medium|low) confidence\)') as confidence,
  case when reason like '%via batch accept-all%' then 'accept_all' else 'individual' end as route,
  count(*) as n
from mark_changes
where reason like 'AI grading run%'
group by 1, 2, 3 order by 2, 1, 3;

-- 2. Newest complete run per student, by confidence x cap cause, with later
--    hand corrections counted as disagreement.
with newest as (
  select distinct on (g.test_id, coalesce(g.student_id, g.invited_student_id)) g.id as run_id, g.test_id,
         coalesce(g.student_id, g.invited_student_id) as sid, g.coverage
  from ai_grade_runs g where g.status = 'complete'
  order by g.test_id, coalesce(g.student_id, g.invited_student_id), g.created_at desc
),
w as (
  select n.run_id, jsonb_array_elements_text(n.coverage->'warnings') as warning
  from newest n where jsonb_typeof(n.coverage->'warnings') = 'array'
),
res as (
  select r.id, r.run_id, r.confidence, r.suggested_marks, r.accepted, r.test_item_id, n.test_id, n.sid,
         ti.question_number || coalesce('(' || ti.part_label || ')', '') as label
  from ai_grade_results r join newest n on n.run_id = r.run_id join test_items ti on ti.id = r.test_item_id
),
flag as (
  select res.*,
    exists (select 1 from w where w.run_id = res.run_id and w.warning like res.label || ': reasoning hedges%') as hedge_cap,
    exists (select 1 from w where w.run_id = res.run_id and w.warning like res.label || ':%' and w.warning not like res.label || ': reasoning hedges%') as other_cap
  from res
),
final as (
  select f.*, sm.marks_awarded as final_mark
  from flag f left join student_marks sm on sm.test_item_id = f.test_item_id and coalesce(sm.student_id, sm.invited_student_id) = f.sid
)
select confidence, hedge_cap, other_cap,
  count(*) as n,
  count(*) filter (where accepted) as accepted,
  count(*) filter (where accepted and final_mark is not null and final_mark <> suggested_marks) as accepted_but_final_differs
from final
group by 1, 2, 3 order by 1, 2, 3;

-- 3. What the hedge cap was firing on: sentences with the hedge phrase that
--    mention reading the work, versus ones that describe the student's method.
with w as (
  select g.id as run_id, jsonb_array_elements_text(g.coverage->'warnings') as warning
  from ai_grade_runs g where g.status = 'complete' and jsonb_typeof(g.coverage->'warnings') = 'array'
),
hedged as (
  select r.id, r.reasoning, r.mark_breakdown::text as notes
  from ai_grade_results r join ai_grade_runs g on g.id = r.run_id join test_items ti on ti.id = r.test_item_id
  where g.status = 'complete'
    and exists (select 1 from w where w.run_id = r.run_id and w.warning like (ti.question_number || coalesce('(' || ti.part_label || ')', '')) || ': reasoning hedges%')
),
sentences as (
  select h.id, s.sentence
  from hedged h, unnest(regexp_split_to_array(coalesce(h.reasoning, '') || ' ' || coalesce(h.notes, ''), '(?<=[.!?])\s+')) as s(sentence)
  where s.sentence ~* '\m(appears to|seems to|probably|maybe|i think|i believe)\M'
)
select
  count(distinct id) as hedge_capped_parts,
  count(distinct id) filter (where sentence ~* '(read|handwrit|legib|digit|written|unclear|crop|scan|could be|looks like|hard to|difficult to|illegib|ambiguous|smudg|cross)') as with_reading_vocab,
  count(distinct id) filter (where sentence !~* '(read|handwrit|legib|digit|written|unclear|crop|scan|could be|looks like|hard to|difficult to|illegib|ambiguous|smudg|cross)') as without_reading_vocab
from sentences;
