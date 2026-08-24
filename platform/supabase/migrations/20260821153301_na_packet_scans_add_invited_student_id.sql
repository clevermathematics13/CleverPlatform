-- Adds an alternate identity link on na_packet_scans for students who have
-- been invited (invited_students) but haven't logged in yet, so they have
-- no profiles row and student_profile_id (FK'd to profiles) can't be set.
--
-- Both columns are nullable and mutually exclusive in practice (a scan is
-- matched to EITHER an invited_students row OR a profiles row, never both
-- at once) but this isn't enforced with a CHECK, since the review UI/admin
-- tooling may want to backfill student_profile_id later (once the student
-- registers and invited_students.profile_id gets populated) while leaving
-- invited_student_id in place as a record of how the match was originally
-- made.
alter table public.na_packet_scans
  add column invited_student_id uuid references public.invited_students(id) on delete set null;

comment on column public.na_packet_scans.invited_student_id is
  'Set when a scan was matched to a student who has been invited but has not yet registered (no profiles row exists). Once the student logs in and invited_students.profile_id is populated, student_profile_id should be backfilled from it and this column can be left as a record of the original match.';

comment on column public.na_packet_scans.student_profile_id is
  'Set when a scan is matched to a student who has an active profiles row (has logged in at least once). See invited_student_id for the not-yet-registered case.';;
