-- public.test_scores summed every invited-only student on a test into a
-- single row.
--
-- The view grouped on sm.student_id alone. That column is NULL for any mark
-- written against a roster row rather than an account (student_marks gained
-- invited_student_id in 20260904222409, and the AI-grade accept routes set
-- one identity or the other, never both). Postgres groups all those NULLs
-- together, so every not-yet-registered student on a test collapsed into one
-- row whose marks_earned was the whole cohort's marks added up: Formative
-- Assessment 1 read 1788 out of a max_total of 50, from 1 row instead of 50.
--
-- Identity here is the profile when there is one and the roster row
-- otherwise -- never both at once. That matters because
-- auto_enroll_from_invitations backfills student_marks.student_id on first
-- sign-in WITHOUT clearing invited_student_id, so one student's rows can
-- carry both columns while their later marks carry only student_id.
-- Grouping on the raw pair would split that student across two rows; the
-- CASE collapses them onto the profile identity instead.
--
-- Dropped and recreated rather than CREATE OR REPLACE: that cannot insert a
-- column ahead of an existing one. Safe here -- nothing depends on this view
-- (no rewrite-rule dependencies, no function body or RLS policy mentions it,
-- and no application code selects from it).
--
-- security_invoker stays ON, as before: the view must keep evaluating
-- student_marks under the caller's own RLS, not the view owner's.

drop view if exists public.test_scores;

create view public.test_scores
with (security_invoker = on) as
select
  sm.student_id,
  case when sm.student_id is null then sm.invited_student_id end as invited_student_id,
  t.id as test_id,
  t.name as test_name,
  t.test_date,
  t.total_marks as max_total,
  sum(sm.marks_awarded) as marks_earned,
  round(100.0 * sum(sm.marks_awarded)::numeric / nullif(t.total_marks, 0)::numeric, 1) as percentage
from public.student_marks sm
  join public.test_items ti on ti.id = sm.test_item_id
  join public.tests t on t.id = ti.test_id
group by
  sm.student_id,
  case when sm.student_id is null then sm.invited_student_id end,
  t.id,
  t.name,
  t.test_date,
  t.total_marks;

comment on view public.test_scores is
  'One row per student per test. Identity is student_id when the student has an account, otherwise invited_student_id; exactly one of the two is set on any row.';
