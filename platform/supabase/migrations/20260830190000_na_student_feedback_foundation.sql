-- Phase 0 of the in-app student feedback feature (na_feedback.released_at).
--
-- Bug fix (the actual blocker): na_feedback/na_response_crops student-read
-- RLS policies gate on na_packet_scans.student_profile_id = auth.uid(), but
-- the real ingestion pipeline (batch/[batchId]/split/route.ts) only ever
-- sets invited_student_id, never student_profile_id -- confirmed against
-- production: 35/35 identified scans have invited_student_id set, 0 have
-- student_profile_id set. auto_enroll_from_invitations links a student's
-- real login to their roster row on first sign-in but never touches
-- na_packet_scans -- so even a released feedback row is invisible to the
-- student it belongs to today. This migration backfills that link going
-- forward (extending auto_enroll_from_invitations) and once for anyone
-- already registered.
--
-- Also adds student/parent SELECT policies on na_anchors and
-- na_packet_scans, which currently only have "teachers full access" --
-- the student feedback read query needs both. na_anchors carries the
-- actual answer key (question_answer, answer_sketch, open_rubric) --
-- Postgres RLS is row-level, not column-level, so this policy scopes to
-- only anchors reachable through that student's own RELEASED feedback,
-- not every anchor in the packet version. Callers must still never
-- SELECT the answer-key columns in a student-facing query -- RLS makes
-- the row reachable, it does not hide columns within it.

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

  -- The actual fix: any na_packet_scans row whose invited_student_id
  -- matches an invited_students row now being linked to this login gets
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

  update public.invited_students
  set registered = true, profile_id = p_user_id
  where email = p_user_email and profile_id is null;
end;
$function$;

-- One-time backfill for anyone already registered before this migration.
-- Verified against production: 0 rows match today (every currently
-- registered invited_students row belongs to a different course than the
-- ones with real scans), so this is a safe no-op right now and exists for
-- completeness/future-proofing rather than because it changes anything
-- immediately.
update public.na_packet_scans ps
set student_profile_id = i.profile_id
from public.invited_students i
where ps.invited_student_id = i.id
  and i.profile_id is not null
  and ps.student_profile_id is null;

-- na_packet_scans: a student may see their own scan rows (status/metadata
-- only -- no answer content lives on this table).
create policy "students read own packet scans"
  on public.na_packet_scans for select
  using (
    public.get_my_role() = 'student'
    and student_profile_id = auth.uid()
  );

create policy "parents read linked student packet scans"
  on public.na_packet_scans for select
  using (
    public.get_my_role() = 'parent'
    and student_profile_id in (
      select pl.student_id from public.parent_links pl where pl.parent_profile_id = auth.uid()
    )
  );

-- na_anchors: scoped to only anchors reachable through that student's own
-- RELEASED feedback -- not "any anchor in a packet version they have a
-- scan for", since this table holds the answer key.
create policy "students read anchors for their own released feedback"
  on public.na_anchors for select
  using (
    public.get_my_role() = 'student'
    and id in (
      select rc.anchor_id
      from public.na_response_crops rc
      join public.na_packet_scans ps on ps.id = rc.packet_scan_id
      join public.na_feedback fb on fb.crop_id = rc.id
      where ps.student_profile_id = auth.uid()
        and fb.released_at is not null
    )
  );

create policy "parents read anchors for linked student released feedback"
  on public.na_anchors for select
  using (
    public.get_my_role() = 'parent'
    and id in (
      select rc.anchor_id
      from public.na_response_crops rc
      join public.na_packet_scans ps on ps.id = rc.packet_scan_id
      join public.na_feedback fb on fb.crop_id = rc.id
      join public.parent_links pl on pl.student_id = ps.student_profile_id
      where pl.parent_profile_id = auth.uid()
        and fb.released_at is not null
    )
  );
