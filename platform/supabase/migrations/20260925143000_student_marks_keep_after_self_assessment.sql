-- A ClevMark is never lowered or cleared once the student has self-assessed
-- the test. The teacher's rule, 25 Sep 2026: a mark found to be too high
-- after that stays, and the lesson goes to the grader instead (the part's
-- marking notes, the grading policies).
--
-- The application refuses such a write before making it and tells the teacher
-- which marks were kept (lib/protected-marks.ts, and the six routes that write
-- student_marks). This trigger is the backstop for everything else: a route
-- that forgets, a student self-assessing in the middle of a request, SQL run
-- by hand or by an agent.
--
-- "Has self-assessed" means at least one student_self_scores row for the
-- student on any part of the test. That is wider than the reveal gate, which
-- needs a non-null self mark: a Redo, or an all-blank submit, leaves rows whose
-- self marks are all null, and neither should reopen the marks to being
-- lowered.
--
-- It never raises, so a batch write never fails because of it:
--   - an UPDATE that would lower marks_awarded keeps the old value, with a
--     WARNING in the Postgres log;
--   - a DELETE is skipped, with a WARNING, while the part still exists.
-- Always allowed: raising a value or writing the same one, updates that change
-- only the identity columns (auto_enroll_from_invitations, and the set-null
-- when an invited_students row goes), rows with no student_id (an
-- invited-only student has no account, so cannot self-assess), and deletes
-- whose part is already gone -- which is how deleting a test or a part still
-- removes its marks through the cascade.
--
-- Because it keeps rather than raises, a caller learns what happened by
-- reading the row back: the routes compare the value an upsert returns, or
-- whether a delete returned the row, with what they sent.
--
-- Only an admin disabling this trigger can lower a protected mark. Do that
-- only on the teacher's explicit instruction.

create or replace function public.student_marks_protect_self_assessed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student uuid;
  v_test_id uuid;
begin
  if tg_op = 'UPDATE' then
    if new.marks_awarded >= old.marks_awarded then
      return new;
    end if;
    v_student := coalesce(old.student_id, new.student_id);
  else
    v_student := old.student_id;
  end if;

  -- Invited-only: no account, so no self-assessment.
  if v_student is null then
    if tg_op = 'UPDATE' then
      return new;
    end if;
    return old;
  end if;

  -- The part is gone: a test or a part is being deleted, and its marks go
  -- with it.
  select ti.test_id into v_test_id
  from public.test_items ti
  where ti.id = old.test_item_id;

  if v_test_id is null then
    if tg_op = 'UPDATE' then
      return new;
    end if;
    return old;
  end if;

  if not exists (
    select 1
    from public.test_items ti
    join public.student_self_scores s
      on s.test_item_id = ti.id
     and s.student_id = v_student
    where ti.test_id = v_test_id
  ) then
    if tg_op = 'UPDATE' then
      return new;
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    raise warning 'student_marks %: kept % (asked %) -- the student has self-assessed this test',
      old.id, old.marks_awarded, new.marks_awarded;
    new.marks_awarded := old.marks_awarded;
    return new;
  end if;

  raise warning 'student_marks %: not deleted (%) -- the student has self-assessed this test',
    old.id, old.marks_awarded;
  return null;
end;
$$;

comment on function public.student_marks_protect_self_assessed() is
  'Keeps a ClevMark from being lowered or cleared once the student has any student_self_scores row on the test. Never raises: a lowering keeps the old value and a delete is skipped, each with a WARNING. See lib/protected-marks.ts.';

drop trigger if exists student_marks_protect_self_assessed on public.student_marks;

create trigger student_marks_protect_self_assessed
  before update or delete on public.student_marks
  for each row execute function public.student_marks_protect_self_assessed();

comment on trigger student_marks_protect_self_assessed on public.student_marks is
  'A ClevMark is never lowered or cleared after the student self-assesses the test. Disable only on the teacher''s explicit instruction.';

-- Trigger functions must never be reachable as RPCs. Postgres checks EXECUTE
-- on a trigger function at CREATE TRIGGER time, not at fire time, so the
-- trigger keeps working after this revoke (as for profiles_guard_role_update).
revoke all on function public.student_marks_protect_self_assessed() from public, anon, authenticated;
