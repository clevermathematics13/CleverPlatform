-- Pablo Clevenger (the teacher) uses two personal accounts to test the
-- platform as other roles:
--   pcleveng@amersol.edu.pe   (44db5d56-f3ab-419f-9238-83377ac05b1d, currently role='parent')
--   paulsclevenger@gmail.com (822c943e-f9ff-46ab-8953-4c99229c9f03, currently role='student')
--
-- Three changes:
--  1. A role chooser at sign-in for just these two accounts (app/login/choose-role),
--     backed by set_test_account_role() below. This is NOT a general
--     multi-role mechanism -- profiles.role stays a fixed, DB-trigger-guarded
--     value per profile (see 20260807112352_security_lock_profile_role_escalation.sql),
--     so this function is hardcoded to exactly these two ids, the same way
--     promote_to_parent_on_signin() is scoped to its own caller. "Admin" in
--     the UI maps to the real 'teacher' role -- there is no separate admin
--     role or admin-only code path anywhere in this app.
--  2. Both accounts enrolled as students in every real (non-virtual,
--     non-archived-inactive) rostered course, so a "Student" sign-in has
--     real courses/assignments to look at regardless of which course a
--     feature under test happens to live in.
--  3. Both enrollments (and both invited_students rows) marked hidden=true,
--     so they don't inflate real class rosters or counts. teacher_settings
--     gets a show_hidden_students column so the teacher can opt into
--     seeing them (and any other hidden row) when needed.

alter table public.teacher_settings
  add column if not exists show_hidden_students boolean not null default false;

-- ---------------------------------------------------------------------------
-- Enroll both accounts, hidden, in 26AH / 27AH / 9A / 9A (2025-2026 archived).
-- Deliberately excludes Grade 9 Extended / Grade 9 Standard: those are
-- virtual tracks with no direct roster by design (see track_courses).
-- ---------------------------------------------------------------------------

insert into public.invited_students (email, full_name, course_id, registered, profile_id, hidden)
select v.email, v.full_name, c.id, true, v.profile_id, true
from (values
  ('pcleveng@amersol.edu.pe', 'Pablo Clevenger', '44db5d56-f3ab-419f-9238-83377ac05b1d'::uuid),
  ('paulsclevenger@gmail.com', 'Paul Clevenger', '822c943e-f9ff-46ab-8953-4c99229c9f03'::uuid)
) as v(email, full_name, profile_id)
cross join (
  select id from public.courses
  where name in ('26AH', '27AH', '9A', '9A (2025-2026)')
) as c(id)
on conflict (email, course_id) do update
set profile_id = excluded.profile_id, registered = true, hidden = true;

insert into public.students (profile_id, course_id, hidden)
select v.profile_id, c.id, true
from (values
  ('44db5d56-f3ab-419f-9238-83377ac05b1d'::uuid),
  ('822c943e-f9ff-46ab-8953-4c99229c9f03'::uuid)
) as v(profile_id)
cross join (
  select id from public.courses
  where name in ('26AH', '27AH', '9A', '9A (2025-2026)')
) as c(id)
on conflict (profile_id, course_id) do update set hidden = true;

-- ---------------------------------------------------------------------------
-- set_test_account_role: the only way profiles.role can change for these
-- two ids. Mirrors promote_to_parent_on_signin's privileged-write pattern.
-- ---------------------------------------------------------------------------

create or replace function public.set_test_account_role(p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed uuid[] := array[
    '44db5d56-f3ab-419f-9238-83377ac05b1d'::uuid,
    '822c943e-f9ff-46ab-8953-4c99229c9f03'::uuid
  ];
begin
  if auth.uid() is null or not (auth.uid() = any(v_allowed)) then
    raise exception 'Unauthorized';
  end if;
  if p_role not in ('teacher', 'student', 'parent') then
    raise exception 'Invalid role: %', p_role;
  end if;

  perform set_config('app.privileged_role_write', 'on', true);
  update public.profiles set role = p_role, updated_at = now() where id = auth.uid();
  perform set_config('app.privileged_role_write', 'off', true);
end;
$$;
revoke all on function public.set_test_account_role(text) from public;
grant execute on function public.set_test_account_role(text) to authenticated;
