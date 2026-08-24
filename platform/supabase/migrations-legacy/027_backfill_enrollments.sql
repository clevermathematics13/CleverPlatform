-- 027: Backfill enrollments for all invited students who have a profile
--      and ensure all invited students are marked registered so auto-enroll
--      fires when they next log in.

-- 1. Mark all invited students as registered (so auto_enroll fires on login)
UPDATE public.invited_students
SET registered = true
WHERE registered = false;

-- 2. Create enrollment rows for invited students who already have a profile
--    but no matching row in public.students yet.
INSERT INTO public.students (profile_id, course_id, extra_time)
SELECT
  i.profile_id,
  i.course_id,
  COALESCE(i.extra_time, 0)
FROM public.invited_students i
WHERE i.profile_id IS NOT NULL
ON CONFLICT (profile_id, course_id) DO NOTHING;
