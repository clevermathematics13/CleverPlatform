-- Students read tests across their track family.
--
-- A test is attached to one course, but a track (Grade 9 Extended) and its
-- member classes (9A, 9C, 9G) sit one assessment: the AI grader attaches a
-- test to one class and marks the whole track. The student read policies on
-- tests and test_items required students.course_id = tests.course_id, so a
-- 9A student could never see (or self-assess against) Formative Assessment 1,
-- attached to 9G, even after their marks were written. Widen both policies to
-- the track family: the course itself, the tracks it belongs to, and their
-- other members (the same rule as lib/track-courses.ts on the teacher side).
-- Marks stay per-student (student_marks: student_id = auth.uid()).

create or replace function public.track_family_course_ids(p_course_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p_course_id
  union
  -- p_course_id is a track: its member classes
  select tc.member_course_id from public.track_courses tc where tc.track_course_id = p_course_id
  union
  -- p_course_id is a class: the tracks it belongs to
  select tc.track_course_id from public.track_courses tc where tc.member_course_id = p_course_id
  union
  -- ... and every other member of those tracks
  select sib.member_course_id
  from public.track_courses tc
  join public.track_courses sib on sib.track_course_id = tc.track_course_id
  where tc.member_course_id = p_course_id;
$$;

comment on function public.track_family_course_ids(uuid) is
  'The course itself plus every course in its track family (track_courses): a track and its members, or a class, its parent tracks and their other members. Security definer so student RLS policies can consult track_courses, which students cannot read directly.';

create or replace function public.student_can_view_test_course(p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.students s
    where s.profile_id = auth.uid()
      and p_course_id in (select public.track_family_course_ids(s.course_id))
  );
$$;

comment on function public.student_can_view_test_course(uuid) is
  'True when the signed-in student is enrolled in a course whose track family contains p_course_id. Backs the student SELECT policies on tests and test_items.';

drop policy if exists "Students can view their tests" on public.tests;
create policy "Students can view their tests"
  on public.tests
  for select
  using (public.student_can_view_test_course(course_id));

drop policy if exists "Students can view test items" on public.test_items;
create policy "Students can view test items"
  on public.test_items
  for select
  using (
    exists (
      select 1
      from public.tests t
      where t.id = test_items.test_id
        and public.student_can_view_test_course(t.course_id)
    )
  );