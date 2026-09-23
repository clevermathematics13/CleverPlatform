-- Let self-assess release the "9 Extended" Key Assessment 1 mark scheme to students.
--
-- 1. Students could not read test_course_dates at all -- only a teacher
--    manage-everything policy existed -- so the per-class sitting date that
--    table exists to record (9G sat Key Assessment 1 a day after 9A/9C; see
--    that migration's comment) could never be consulted from the
--    student-scoped client the reflection self-assess page (and its new
--    mark-scheme route) run under. Mirrors the student read policy already
--    granted on the sibling table test_course_self_assessment (migration
--    20260911055400), reusing the same student_is_enrolled_in_course()
--    security-definer function.
--
-- 2. tests.mark_scheme_url is the field NativeForm (self-assess step 1)
--    already renders a "Mark Scheme" button from whenever it is non-null,
--    and it has never been set on any test in this database. Point it at
--    the new gated route (app/api/tests/[id]/mark-scheme) rather than at the
--    private teacher-archive storage path -- that route builds a SEPARATE,
--    student-appropriate document from tests.custom_content (answers and
--    plain-language marking notes, no M1/A1/R1 shorthand, none of the
--    teacher-only marking-principles/reteach-guide sections), and re-checks
--    the student's own class's sitting date (via test_course_dates) before
--    serving it, so a class that has not sat the test yet still cannot
--    reach it through this link.

create policy "Students can read their own class's test date"
  on test_course_dates
  for select using (public.student_is_enrolled_in_course(course_id));

update tests
set mark_scheme_url = '/api/tests/ccfa0456-a7f7-4835-81d4-7983df021022/mark-scheme'
where id = 'ccfa0456-a7f7-4835-81d4-7983df021022';
