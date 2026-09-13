-- ---------------------------------------------------------------------------
-- Practice-set visibility follows the roster, not just the enrolment table
-- ---------------------------------------------------------------------------
-- student_is_enrolled_in_course (20260911055400) reads `students`, and for the
-- gate it was written for -- releasing one class's marks -- that is right: a
-- mark belongs to an enrolment.
--
-- Practice sets are not marks, and `students` is not the roster. A `students`
-- row appears when a student is enrolled through the Students page; the
-- roster row in `invited_students` is what actually exists for everyone, which
-- is why the NA pipeline keys on it. The two disagree in production right now:
-- of 27AH's 14 visible students, 13 have a `students` row and one (a
-- registered student with a profile, sitting in the same class as the others)
-- does not. Gating on `students` alone would have shown that student an empty
-- page all term with nothing to explain it.
--
-- So: either table, matched on the signed-in profile, plus the roster's own
-- email as a fallback for a registered student whose profile_id was never
-- backfilled -- the same match `invited_students`'s own SELECT policy makes.
--
-- SECURITY DEFINER for the usual reason: a student can read neither `students`
-- nor most of `invited_students`, so a policy cannot consult them unaided.

CREATE OR REPLACE FUNCTION public.student_is_on_course_roster(p_course_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.profile_id = auth.uid()
      AND s.course_id = p_course_id
  ) OR EXISTS (
    SELECT 1 FROM public.invited_students i
    WHERE i.course_id = p_course_id
      AND (
        i.profile_id = auth.uid()
        OR lower(i.email) = lower(auth.jwt() ->> 'email')
      )
  );
$$;

COMMENT ON FUNCTION public.student_is_on_course_roster(uuid) IS
  'True when the signed-in user is on this course''s roster, by `students` enrolment or by `invited_students`. Per class, never the track family. Use this for anything a whole class should see; use student_is_enrolled_in_course where the thing is tied to an enrolment, such as marks.';

REVOKE EXECUTE ON FUNCTION public.student_is_on_course_roster(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.student_is_on_course_roster(uuid) TO authenticated;

DROP POLICY IF EXISTS "Students can read released practice sets for their course" ON practice_sets;

CREATE POLICY "Students can read released practice sets for their course"
  ON practice_sets
  FOR SELECT USING (
    released_at IS NOT NULL
    AND public.student_is_on_course_roster(course_id)
  );

DROP POLICY IF EXISTS "Students can read items of released practice sets" ON practice_set_items;

CREATE POLICY "Students can read items of released practice sets"
  ON practice_set_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM practice_sets ps
      WHERE ps.id = practice_set_id
        AND ps.released_at IS NOT NULL
        AND public.student_is_on_course_roster(ps.course_id)
    )
  );