
-- Atomically promote a profile to 'parent' and link it to a student's
-- enrollment row. Teacher-gated. Never demotes a teacher profile.
-- Removes any existing `students` enrollment rows for the promoted
-- profile, since a parent profile should not carry course enrollments.
CREATE OR REPLACE FUNCTION public.teacher_link_parent(
  p_parent_email text,
  p_student_id uuid
)
RETURNS TABLE (
  parent_profile_id uuid,
  parent_display_name text,
  already_linked boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_parent_id uuid;
  v_parent_role text;
  v_parent_name text;
  v_student_exists boolean;
  v_already boolean := false;
BEGIN
  IF public.get_my_role() != 'teacher' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_parent_email IS NULL OR trim(p_parent_email) = '' THEN
    RAISE EXCEPTION 'Parent email is required';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.students WHERE id = p_student_id) INTO v_student_exists;
  IF NOT v_student_exists THEN
    RAISE EXCEPTION 'Student enrollment not found';
  END IF;

  SELECT id, role, display_name INTO v_parent_id, v_parent_role, v_parent_name
  FROM public.profiles
  WHERE lower(email) = lower(trim(p_parent_email));

  IF v_parent_id IS NULL THEN
    RAISE EXCEPTION 'No account found for %. They must sign in at least once before being linked as a parent.', p_parent_email;
  END IF;

  IF v_parent_role = 'teacher' THEN
    RAISE EXCEPTION '% is a teacher account and cannot be converted to a parent.', p_parent_email;
  END IF;

  IF v_parent_role != 'parent' THEN
    UPDATE public.profiles SET role = 'parent', updated_at = now() WHERE id = v_parent_id;
    DELETE FROM public.students WHERE profile_id = v_parent_id;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.parent_links
    WHERE parent_links.parent_profile_id = v_parent_id AND parent_links.student_id = p_student_id
  ) INTO v_already;

  INSERT INTO public.parent_links (parent_profile_id, student_id)
  VALUES (v_parent_id, p_student_id)
  ON CONFLICT (parent_profile_id, student_id) DO NOTHING;

  RETURN QUERY SELECT v_parent_id, v_parent_name, v_already;
END;
$function$;

-- Remove a parent-student link. Teacher-gated. Does not touch role,
-- since a parent may be linked to multiple students.
CREATE OR REPLACE FUNCTION public.teacher_unlink_parent(p_link_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF public.get_my_role() != 'teacher' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  DELETE FROM public.parent_links WHERE id = p_link_id;
END;
$function$;
;
