-- auto_enroll_from_invitations built the students row from the invitation and
-- copied extra_time out of it, but not student_number -- while selecting from
-- the very row that holds it. So every student's number went missing from
-- students the moment they first signed in, and the more of a class had
-- logged in, the more of it was blank.
--
-- That is what made 9G export seventeen rows with every Score cell empty and
-- PowerSchool report "0 of 17 scores will be imported": buildScoreRows could
-- not match a single student to a row in the stored template. Twelve more
-- students drifted the same way in the three days after that was patched, so
-- the reader-side fallback stops the export breaking but does not stop the
-- drift -- and /dashboard/students reads the column directly, showing those
-- students as having no number when their invitation has one.
--
-- Only the insert changes. COALESCE on conflict so a number the teacher typed
-- on the students row is never overwritten by a stale invitation: the
-- students row wins where it has a value, the invitation fills the blank.
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

  insert into public.students (profile_id, course_id, extra_time, student_number)
  select p_user_id, i.course_id, i.extra_time, i.student_number
  from public.invited_students i
  where i.email = p_user_email and i.profile_id is null
  on conflict (profile_id, course_id) do update
  set extra_time = excluded.extra_time,
      student_number = coalesce(public.students.student_number, excluded.student_number);

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

-- The students who already drifted.
update public.students s
set student_number = i.student_number
from public.invited_students i
where i.profile_id = s.profile_id
  and i.course_id = s.course_id
  and s.student_number is null
  and i.student_number is not null;
