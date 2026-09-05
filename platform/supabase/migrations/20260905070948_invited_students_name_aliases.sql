-- Alternative spellings of a student's name that the teacher has confirmed
-- (e.g. how it was misread off a scanned cover page: "Galo Mafiol" for
-- Galo Masias). The AI grader's roster matcher treats each alias as an
-- extra name for the student, so the same misread matches next time.
alter table public.invited_students
  add column if not exists name_aliases text[] not null default '{}';

comment on column public.invited_students.name_aliases is
  'Teacher-confirmed alternative spellings of full_name, used by the AI grader roster matcher.';