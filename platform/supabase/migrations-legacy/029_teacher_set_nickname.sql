-- 029: SECURITY DEFINER functions for teachers to set nicknames and names
--      Needed because RLS on profiles only allows users to update their own row.

CREATE OR REPLACE FUNCTION public.teacher_set_profile_nickname(p_profile_id UUID, p_nickname TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF public.get_my_role() != 'teacher' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE public.profiles
  SET nickname = NULLIF(trim(p_nickname), '')
  WHERE id = p_profile_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_set_invited_nickname(p_invited_id UUID, p_nickname TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF public.get_my_role() != 'teacher' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE public.invited_students
  SET nickname = NULLIF(trim(p_nickname), '')
  WHERE id = p_invited_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_set_profile_display_name(p_profile_id UUID, p_display_name TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF public.get_my_role() != 'teacher' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE public.profiles
  SET display_name = trim(p_display_name)
  WHERE id = p_profile_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_set_invited_full_name(p_invited_id UUID, p_full_name TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF public.get_my_role() != 'teacher' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE public.invited_students
  SET full_name = trim(p_full_name)
  WHERE id = p_invited_id;
END;
$$;
