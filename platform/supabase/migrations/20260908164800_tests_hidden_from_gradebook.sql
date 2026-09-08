-- Hiding a test from the teacher's own gradebook, separately from hiding it
-- from students.
--
-- `tests.hidden` already existed and means "keep this out of the student
-- reflection dropdown" (lib/exam-service.ts, exam-templates/export-pdf). It is
-- deliberately NOT reused here: the two audiences want different answers. A
-- paper whose boundary set is still approximate should stay out of the
-- students' hands while the teacher goes on grading it in the gradebook, and a
-- finished paper can be worth showing students while its column is folded away
-- to make room.
--
-- Affects the gradebook grid only. Marks, levels and the PowerSchool export
-- are untouched: this hides a column, it does not withdraw a test.
alter table public.tests
  add column if not exists hidden_from_gradebook boolean not null default false;

comment on column public.tests.hidden_from_gradebook is
  'Omit this test''s column from the teacher gradebook grid. Distinct from tests.hidden, which hides the test from students.';
