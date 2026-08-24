
-- Enable RLS on track_courses and restrict to teacher role only.
-- This table links two courses together (track_course_id -> member_course_id)
-- and is purely teacher-managed configuration data; students have no business reading it.

ALTER TABLE public.track_courses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers manage track courses"
  ON public.track_courses
  FOR ALL
  TO authenticated
  USING (get_my_role() = 'teacher')
  WITH CHECK (get_my_role() = 'teacher');
;
