-- 002: Invited students (teacher pre-imports) + nickname

-- ============================================
-- 1. Add nickname to profiles
-- ============================================
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS nickname TEXT;

-- ============================================
-- 2. Invited students table
-- ============================================
CREATE TABLE IF NOT EXISTS public.invited_students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  full_name TEXT,
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  registered BOOLEAN NOT NULL DEFAULT false,
  profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(email, course_id)
);

ALTER TABLE public.invited_students ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Teachers can manage invited students" ON public.invited_students;
CREATE POLICY "Teachers can manage invited students"
  ON public.invited_students FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'teacher'
    )
  );

DROP POLICY IF EXISTS "Users can view own invitations" ON public.invited_students;
CREATE POLICY "Users can view own invitations"
  ON public.invited_students FOR SELECT
  USING (
    email = (SELECT p.email FROM public.profiles p WHERE p.id = auth.uid())
  );

-- ============================================
-- 3. Auto-enroll function (SECURITY DEFINER)
--    Called from auth callback when student logs in.
--    Bypasses RLS to create enrollments from invitations.
-- ============================================
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
  -- Create enrollments for all pending invitations
  INSERT INTO public.students (profile_id, course_id)
  SELECT p_user_id, i.course_id
  FROM public.invited_students i
  WHERE i.email = p_user_email AND i.registered = false
  ON CONFLICT (profile_id, course_id) DO NOTHING;

  -- Mark invitations as registered
  UPDATE public.invited_students
  SET registered = true, profile_id = p_user_id
  WHERE email = p_user_email AND registered = false;
END;
$$;
