-- ============================================================================
-- CRITICAL FIX 2: registration_codes was readable and writable by `anon`.
--   "Anyone can validate codes"   SELECT USING (true)
--   "Allow marking codes as used" UPDATE USING (true) CHECK (used = true)
-- Any holder of the public anon key could enumerate every live code and its
-- student_id, or mass-burn codes to deny registration.
-- Replaced with a single atomic SECURITY DEFINER redemption RPC that never
-- returns enumerable data.
-- ============================================================================

DROP POLICY IF EXISTS "Anyone can validate codes"   ON public.registration_codes;
DROP POLICY IF EXISTS "Allow marking codes as used" ON public.registration_codes;

CREATE OR REPLACE FUNCTION public.redeem_registration_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_code    text := upper(trim(p_code));
  v_row     record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF v_code IS NULL OR v_code = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid');
  END IF;

  -- Lock the row so two concurrent redemptions cannot both win
  SELECT id, student_id INTO v_row
  FROM public.registration_codes
  WHERE code = v_code
    AND used = false
    AND (expires_at IS NULL OR expires_at > now())
  FOR UPDATE;

  -- Uniform response: a caller cannot distinguish "wrong code" from
  -- "already used" from "expired", so codes are not enumerable.
  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid');
  END IF;

  UPDATE public.registration_codes
  SET used = true, used_by = v_uid
  WHERE id = v_row.id;

  INSERT INTO public.parent_links (parent_profile_id, student_id)
  VALUES (v_uid, v_row.student_id)
  ON CONFLICT DO NOTHING;

  PERFORM set_config('app.privileged_role_write', 'on', true);
  UPDATE public.profiles SET role = 'parent' WHERE id = v_uid;
  PERFORM set_config('app.privileged_role_write', 'off', true);

  RETURN jsonb_build_object('ok', true);
END; $$;

REVOKE ALL     ON FUNCTION public.redeem_registration_code(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.redeem_registration_code(text) TO authenticated;;
