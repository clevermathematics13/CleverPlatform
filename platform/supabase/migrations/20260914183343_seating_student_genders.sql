-- Per-student B/G marker, set by the teacher and read by one thing only: the
-- seating generator's assessment mode, which alternates genders along each row
-- (BGB for row 1, GBG for row 2, and so on). Nothing else in the platform
-- reads it, and no student-facing query touches it.
--
-- Keyed by the same student_id the rest of the seating tables use -- the
-- student's email -- which is what lib/seating-data.ts derives from the live
-- roster (profiles.email for a registered student, invited_students.email for
-- an invited-only one). No foreign key, for that same reason: the identifier
-- can come from either table, and the seating tables have never referenced
-- either one.
--
-- Clearing a student's marker deletes the row, so gender is never the empty
-- string here.
create table if not exists public.seating_student_genders (
  student_id text primary key,
  gender text not null check (gender in ('B', 'G')),
  updated_at timestamptz not null default now()
);

alter table public.seating_student_genders enable row level security;

-- Teacher-only. The other seating tables carry an authenticated-read policy so
-- a student can see their own seat; this one has no student-readable reason to
-- exist, so it does not get one.
create policy "Teachers manage seating_student_genders"
  on public.seating_student_genders
  for all
  using (get_my_role() = 'teacher')
  with check (get_my_role() = 'teacher');
