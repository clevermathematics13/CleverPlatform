-- A student who did not sit a test. Until now the only signal was the
-- absence of marks, which reads the same as "not graded yet"; the AI grader
-- and the gradebook can now show "Absent" instead of an empty row.
-- Exactly one of profile_id / invited_student_id is set, mirroring
-- student_marks: registered students by profile, invitees by their
-- invited_students row.
create table public.test_absences (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.tests(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete cascade,
  invited_student_id uuid references public.invited_students(id) on delete cascade,
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint test_absences_one_subject check (
    (profile_id is not null and invited_student_id is null)
    or (profile_id is null and invited_student_id is not null)
  )
);

create unique index test_absences_test_profile_idx
  on public.test_absences (test_id, profile_id) where profile_id is not null;
create unique index test_absences_test_invited_idx
  on public.test_absences (test_id, invited_student_id) where invited_student_id is not null;

alter table public.test_absences enable row level security;

create policy "Teachers can manage test absences" on public.test_absences
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher')
  );

create policy "Students can view own absences" on public.test_absences
  for select using (profile_id = auth.uid());

comment on table public.test_absences is
  'Students recorded as absent for a test; shown as Absent by the AI grader and the gradebook.';