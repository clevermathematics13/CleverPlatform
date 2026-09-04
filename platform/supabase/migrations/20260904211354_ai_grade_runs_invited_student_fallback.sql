-- Lets a batch AI-grading run be attributed to a student who has been
-- imported (e.g. via Google Classroom) but has never logged in, so has no
-- profiles row yet -- mirrors na_packet_scans' existing invited_student_id /
-- student_profile_id pair exactly (both independently nullable, no CHECK).
alter table ai_grade_runs
  alter column student_id drop not null,
  add column invited_student_id uuid references invited_students(id) on delete set null;

comment on column ai_grade_runs.student_id is 'profiles.id of the graded student, once known. Nullable: a run graded against an imported-but-not-yet-registered student has this null and invited_student_id set instead, until auto_enroll_from_invitations backfills it on first login.';
comment on column ai_grade_runs.invited_student_id is 'invited_students.id of the graded student. Set for every run created against the batch/invited-roster flow, regardless of registration status; left null for runs created the old way, directly against a profiles-backed roster entry.';

-- Backfill ai_grade_runs.student_id the same way auto_enroll_from_invitations
-- already backfills na_packet_scans.student_profile_id on a student's first
-- login, so a student graded while still invited-only is not stranded once
-- they register.
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

  update public.invited_students
  set registered = true, profile_id = p_user_id
  where email = p_user_email and profile_id is null;
end;
$function$;
