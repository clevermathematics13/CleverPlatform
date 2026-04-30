-- 025: Add extra_time to invited_students and carry it into enrollments

ALTER TABLE public.invited_students
ADD COLUMN IF NOT EXISTS extra_time INTEGER CHECK (extra_time IN (0, 25, 50)) NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.auto_enroll_from_invitations(
  p_user_id UUID,
  p_user_email TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.students (profile_id, course_id, extra_time)
  SELECT p_user_id, i.course_id, i.extra_time
  FROM public.invited_students i
  WHERE i.email = p_user_email AND i.profile_id IS NULL
  ON CONFLICT (profile_id, course_id) DO UPDATE
  SET extra_time = EXCLUDED.extra_time;

  UPDATE public.invited_students
  SET registered = true, profile_id = p_user_id
  WHERE email = p_user_email AND profile_id IS NULL;
END;
$$;