-- ============================================================================
-- CRITICAL FIX 1: Prevent self-promotion to teacher via profiles.role
-- CRITICAL FIX 3: Bind identity-parameterised SECURITY DEFINER RPCs to auth.uid()
-- ============================================================================

-- Sole teacher account, mirrored from platform/app/auth/callback/route.ts
-- (kept in one place so the DB is authoritative, not the client).

-- ---------------------------------------------------------------------------
-- INSERT guard: role and email are derived from the JWT, never from the payload
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.profiles_force_safe_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_jwt_email text;
BEGIN
  -- service_role / server-side maintenance (auth.uid() is NULL) is untouched
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  v_jwt_email := lower(auth.jwt() ->> 'email');

  -- Never trust a client-supplied email: it feeds the invited_parents policy
  IF v_jwt_email IS NOT NULL AND v_jwt_email <> '' THEN
    NEW.email := v_jwt_email;
  END IF;

  NEW.role := CASE
    WHEN v_jwt_email = 'clevermathematics@gmail.com' THEN 'teacher'
    ELSE 'student'
  END;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS profiles_force_safe_insert_trg ON public.profiles;
CREATE TRIGGER profiles_force_safe_insert_trg
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_force_safe_insert();

-- ---------------------------------------------------------------------------
-- UPDATE guard: role/email may only change through a privileged definer path
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.profiles_guard_role_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Transaction-local flag set only by vetted SECURITY DEFINER functions below.
  IF coalesce(current_setting('app.privileged_role_write', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  -- service_role / server-side maintenance
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'profiles.role cannot be modified by the client';
  END IF;

  IF NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'profiles.email cannot be modified by the client';
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS profiles_guard_role_update_trg ON public.profiles;
CREATE TRIGGER profiles_guard_role_update_trg
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_guard_role_update();

-- Defence in depth: remove the column-level grants entirely
REVOKE UPDATE (role, email, id) ON public.profiles FROM authenticated, anon;
REVOKE INSERT (role)           ON public.profiles FROM anon;

-- ---------------------------------------------------------------------------
-- promote_to_parent_on_signin: bind to caller, drop anon access
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.promote_to_parent_on_signin(p_profile_id uuid, p_email text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
declare
  v_email text := lower(trim(p_email));
  v_matched boolean := false;
  v_row record;
begin
  if p_profile_id is null or v_email is null or v_email = '' then
    return false;
  end if;

  -- Caller may only act on their own identity
  if auth.uid() is null or auth.uid() <> p_profile_id then
    raise exception 'Unauthorized';
  end if;
  if lower(auth.jwt() ->> 'email') <> v_email then
    raise exception 'Email mismatch';
  end if;

  for v_row in
    select id, student_id
    from public.invited_parents
    where lower(email) = v_email and registered = false
  loop
    insert into public.parent_links (parent_profile_id, student_id)
    values (p_profile_id, v_row.student_id)
    on conflict do nothing;

    update public.invited_parents
    set registered = true, profile_id = p_profile_id
    where id = v_row.id;

    v_matched := true;
  end loop;

  if v_matched then
    perform set_config('app.privileged_role_write', 'on', true);
    update public.profiles set role = 'parent' where id = p_profile_id;
    perform set_config('app.privileged_role_write', 'off', true);
  end if;

  return v_matched;
end; $$;

-- ---------------------------------------------------------------------------
-- auto_enroll_from_invitations: bind to caller, drop anon access
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_enroll_from_invitations(p_user_id uuid, p_user_email text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF lower(auth.jwt() ->> 'email') <> lower(p_user_email) THEN
    RAISE EXCEPTION 'Email mismatch';
  END IF;

  INSERT INTO public.students (profile_id, course_id, extra_time)
  SELECT p_user_id, i.course_id, i.extra_time
  FROM public.invited_students i
  WHERE i.email = p_user_email AND i.profile_id IS NULL
  ON CONFLICT (profile_id, course_id) DO UPDATE
  SET extra_time = EXCLUDED.extra_time;

  UPDATE public.invited_parents ip
  SET student_id = s.id
  FROM public.students s
  WHERE ip.student_id IS NULL
    AND ip.invited_student_email = p_user_email
    AND ip.course_id = s.course_id
    AND s.profile_id = p_user_id;

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
END; $$;

-- ---------------------------------------------------------------------------
-- Lock down anon RPC surface
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.promote_to_parent_on_signin(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.auto_enroll_from_invitations(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_public_schema()                     FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_my_role()                           FROM anon;;
