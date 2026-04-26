-- 022: Add nickname to invited_students + fix auto_enroll_from_invitations
-- The RPC previously filtered on registered=false; now we track by profile_id IS NULL
-- so resets and auto-registered imports both work correctly.

-- 1. Add nickname column so teachers can pre-set nicknames before students sign in
ALTER TABLE public.invited_students ADD COLUMN IF NOT EXISTS nickname TEXT;

-- 2. Fix auto_enroll_from_invitations to use profile_id IS NULL instead of registered=false
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
  -- Create enrollments for all invitations not yet linked to a profile
  INSERT INTO public.students (profile_id, course_id)
  SELECT p_user_id, i.course_id
  FROM public.invited_students i
  WHERE i.email = p_user_email AND i.profile_id IS NULL
  ON CONFLICT (profile_id, course_id) DO NOTHING;

  -- Mark invitations as registered and link to the newly signed-in profile
  UPDATE public.invited_students
  SET registered = true, profile_id = p_user_id
  WHERE email = p_user_email AND profile_id IS NULL;
END;
$$;
