-- Lets a mark ("Clev's Marks") be written for a student who has been
-- imported (e.g. via Google Classroom) but has never logged in, so has no
-- profiles row yet -- mirrors ai_grade_runs.invited_student_id exactly.
alter table student_marks
  alter column student_id drop not null,
  add column invited_student_id uuid references invited_students(id) on delete set null;

-- The existing (test_item_id, student_id) unique constraint does not dedupe
-- invited-only rows -- Postgres never treats two NULLs as equal, so a
-- second write for the same invited student would insert a duplicate row
-- instead of updating it. A matching unique constraint on
-- (test_item_id, invited_student_id) closes that gap.
alter table student_marks
  add constraint student_marks_test_item_id_invited_student_id_key
  unique (test_item_id, invited_student_id);

comment on column student_marks.student_id is 'profiles.id of the marked student, once known. Nullable: a mark written against an imported-but-not-yet-registered student has this null and invited_student_id set instead, until auto_enroll_from_invitations backfills it on first login.';
comment on column student_marks.invited_student_id is 'invited_students.id of the marked student, when student_id is not yet known.';

alter table mark_changes
  alter column student_id drop not null,
  add column invited_student_id uuid references invited_students(id) on delete set null;

comment on column mark_changes.student_id is 'profiles.id of the student this change is about, once known. Nullable: a change logged against an imported-but-not-yet-registered student has this null and invited_student_id set instead, until auto_enroll_from_invitations backfills it on first login.';
comment on column mark_changes.invited_student_id is 'invited_students.id of the student this change is about, when student_id is not yet known.';

-- Backfill both tables' student_id the same way auto_enroll_from_invitations
-- already backfills ai_grade_runs.student_id and na_packet_scans.student_profile_id
-- on a student's first login, so marks entered while a student was still
-- invited-only are not stranded once they register. Guarded with NOT EXISTS
-- so a pre-existing profile-keyed row for the same (test_item_id, student)
-- (unlikely, but possible) is left alone instead of raising a unique-
-- constraint error and aborting the whole login.
create or replace function public.auto_enroll_from_invitations(p_user_id uuid, p_user_email text)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Unauthorized';
  end if;
  if lower(auth.jwt() ->> 'email') <> lower(p_user_email) then
    raise exception 'Email mismatch';
  end if;

  insert into public.students (profile_id, course_id, extra_time)
  select p_user_id, i.course_id, i.extra_time
  from public.invited_students i
  where i.email = p_user_email and i.profile_id is null
  on conflict (profile_id, course_id) do update
  set extra_time = excluded.extra_time;

  update public.invited_parents ip
  set student_id = s.id
  from public.students s
  where ip.student_id is null
    and ip.invited_student_email = p_user_email
    and ip.course_id = s.course_id
    and s.profile_id = p_user_id;

  update public.profiles
  set nickname = (
    select coalesce(
      nullif(trim(i.nickname), ''),
      split_part(i.full_name, ' ', 1)
    )
    from public.invited_students i
    where i.email = p_user_email and i.profile_id is null
    limit 1
  )
  where id = p_user_id and nickname is null;

  -- Any na_packet_scans row whose invited_student_id matches an
  -- invited_students row now being linked to this login gets
  -- student_profile_id backfilled, so the existing na_feedback/
  -- na_response_crops student-read RLS (which joins through
  -- student_profile_id) can actually find it.
  update public.na_packet_scans ps
  set student_profile_id = p_user_id
  from public.invited_students i
  where i.email = p_user_email
    and i.profile_id is null -- pre-update snapshot: this invitation row is about to be claimed by p_user_id below
    and ps.invited_student_id = i.id
    and ps.student_profile_id is null;

  -- Same backfill for ai_grade_runs graded against this student while they
  -- were still invited-only (batch AI-grading, no login required).
  update public.ai_grade_runs r
  set student_id = p_user_id
  from public.invited_students i
  where i.email = p_user_email
    and i.profile_id is null
    and r.invited_student_id = i.id
    and r.student_id is null;

  -- Same backfill for student_marks ("Clev's Marks") accepted while this
  -- student was still invited-only.
  update public.student_marks m
  set student_id = p_user_id
  from public.invited_students i
  where i.email = p_user_email
    and i.profile_id is null
    and m.invited_student_id = i.id
    and m.student_id is null
    and not exists (
      select 1 from public.student_marks m2
      where m2.test_item_id = m.test_item_id and m2.student_id = p_user_id
    );

  -- Same backfill for the mark_changes audit log.
  update public.mark_changes c
  set student_id = p_user_id
  from public.invited_students i
  where i.email = p_user_email
    and i.profile_id is null
    and c.invited_student_id = i.id
    and c.student_id is null;

  update public.invited_students
  set registered = true, profile_id = p_user_id
  where email = p_user_email and profile_id is null;
end;
$function$;
