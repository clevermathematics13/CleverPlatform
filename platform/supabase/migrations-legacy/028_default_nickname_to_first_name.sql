-- 028: Default nickname to first name for all students

-- 0. Ensure nickname columns exist (defensive, in case earlier migrations were skipped)
ALTER TABLE public.invited_students ADD COLUMN IF NOT EXISTS nickname TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS nickname TEXT;

-- 1. Backfill invited_students.nickname with first name where not yet set
UPDATE public.invited_students
SET nickname = split_part(full_name, ' ', 1)
WHERE nickname IS NULL AND full_name IS NOT NULL AND trim(full_name) <> '';

-- 2. Backfill profiles.nickname with first name for students where not yet set
UPDATE public.profiles
SET nickname = split_part(display_name, ' ', 1)
WHERE nickname IS NULL
  AND display_name IS NOT NULL
  AND trim(display_name) <> ''
  AND role = 'student';

-- 3. Update auto_enroll_from_invitations to copy nickname from invitation to profile
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

  -- Copy nickname (or derive from full_name) into profiles if not already set
  UPDATE public.profiles
  SET nickname = (
    SELECT COALESCE(
      NULLIF(trim(i.nickname), ''),
      split_part(i.full_name, ' ', 1)
    )
    FROM public.invited_students i
    WHERE i.email = p_user_email AND i.profile_id IS NULL
    LIMIT 1
  )
  WHERE id = p_user_id AND nickname IS NULL;

  UPDATE public.invited_students
  SET registered = true, profile_id = p_user_id
  WHERE email = p_user_email AND profile_id IS NULL;
END;
$$;
