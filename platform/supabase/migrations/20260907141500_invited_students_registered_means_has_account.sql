-- invited_students.registered must mean "this student has an account".
--
-- Both invite paths wrote registered = true at import time, before any account
-- could exist: the manual invite in app/dashboard/students/actions.ts and the
-- roster import in google-classroom-actions.ts. Every imported student
-- therefore read as registered while profile_id stayed null. On 7 Sep 2026 that
-- state made a Grade 9 class's Formative Assessment 1 feedback look ready to
-- hand back when not one of the 14 students had ever signed in, so none of them
-- could see a mark. Nothing in the delivery path was broken -- the roster flag
-- simply lied about who could read anything.
--
-- profile_id is the fact. auto_enroll_from_invitations sets it on a student's
-- first sign-in (together with registered), and it is what every account-aware
-- query already keys on: /dashboard/students, /api/students and the AI-grade
-- pickers all test profile_id and ignore the flag. The trigger below derives
-- the flag from that fact on every write, so it cannot drift again even if a
-- future caller passes registered explicitly.
--
-- ORDERING: the three headcount readers that filtered on registered = true
-- (/dashboard, /dashboard/courses, /dashboard/archived-courses) were changed in
-- the same commit as this migration. Applied against a deployment that predates
-- that commit, this empties their invited-student counts, because
-- `registered = true AND profile_id IS NULL` then matches no row. Apply it only
-- once that code is live on main.

update public.invited_students
set registered = (profile_id is not null)
where registered is distinct from (profile_id is not null);

create or replace function public.invited_students_sync_registered()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Derived, never taken from the caller: an invite cannot know whether the
  -- student has ever signed in, and claiming so hides a whole class that
  -- cannot yet read what the teacher publishes.
  new.registered := new.profile_id is not null;
  return new;
end;
$$;

-- Fires on every insert and update rather than on a column list, so the
-- invariant survives a write path that touches profile_id indirectly.
drop trigger if exists invited_students_sync_registered on public.invited_students;

create trigger invited_students_sync_registered
  before insert or update on public.invited_students
  for each row
  execute function public.invited_students_sync_registered();
