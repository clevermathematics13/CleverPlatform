-- A key assessment is sat on different days by the classes that share it.
--
-- Grade 9 Extended is a virtual track course covering 9A, 9C and 9G, and one
-- test hangs off it. The Course Outline gives every key assessment a two-day
-- window for exactly this reason -- "September 14, 15", "October 12, 13" --
-- and the classes are split across those days: 9A and 9C sat Key Assessment 1
-- on the 14th, 9G on the 15th. tests.test_date is a single column, so no value
-- in it is right for that test.
--
-- Same shape as test_course_self_assessment, which is already the per-course
-- override on a track test: keyed on (test_id, course_id), holding the one
-- field that differs per class.
--
-- tests.test_date stays the assessment's own date and remains the fallback for
-- a class with no row here, so a track whose classes all sit on the same day
-- needs no rows at all.
create table test_course_dates (
  test_id uuid not null references tests(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  test_date date not null,
  updated_at timestamptz not null default now(),
  primary key (test_id, course_id)
);

comment on table test_course_dates is
  'The day one class sat a test, where the classes sharing that test did not all sit it together. Rows are only needed for a test on a virtual track course (e.g. Grade 9 Extended -> 9A, 9C, 9G) whose classes sat it on different days; a class with no row here inherits tests.test_date. course_id is the REAL class course, never the track course. Read by lib/assessment-calendar.ts.';

comment on column test_course_dates.course_id is
  'The real, roster-bearing class course (9A, 9C, 9G), not the virtual track course the test hangs off.';

alter table test_course_dates enable row level security;

-- Teachers only, matching test_course_self_assessment: these are scheduling
-- facts about a whole class, and nothing student-facing reads them today.
create policy "Teachers manage test course dates"
  on test_course_dates for all
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'teacher'))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'teacher'));