-- ============================================================================
-- Postgres grants EXECUTE to PUBLIC on every new function by default, so
-- "REVOKE ... FROM anon" alone is a no-op. Revoke from PUBLIC, then grant
-- back only to the roles that genuinely need each function.
-- ============================================================================

-- Sign-in lifecycle RPCs: authenticated only (they now bind to auth.uid())
REVOKE ALL ON FUNCTION public.auto_enroll_from_invitations(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auto_enroll_from_invitations(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.promote_to_parent_on_signin(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promote_to_parent_on_signin(uuid, text) TO authenticated;

-- Teacher administration RPCs. These already raise 'Unauthorized' internally,
-- but there is no reason for them to be reachable by anon at all.
REVOKE ALL ON FUNCTION public.teacher_bulk_import_roster(uuid, jsonb)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_link_parent(text, uuid)                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_unlink_parent(uuid)                      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_set_invited_full_name(uuid, text)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_set_invited_nickname(uuid, text)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_set_profile_display_name(uuid, text)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_set_profile_nickname(uuid, text)         FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.teacher_bulk_import_roster(uuid, jsonb)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_link_parent(text, uuid)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_unlink_parent(uuid)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_set_invited_full_name(uuid, text)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_set_invited_nickname(uuid, text)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_set_profile_display_name(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_set_profile_nickname(uuid, text)     TO authenticated;

-- Trigger functions must never be reachable as RPCs. Postgres checks EXECUTE
-- on a trigger function at CREATE TRIGGER time, not at fire time, so the
-- triggers themselves keep working after this revoke.
REVOKE ALL ON FUNCTION public.profiles_force_safe_insert()  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.profiles_guard_role_update()  FROM PUBLIC, anon, authenticated;

-- redeem_registration_code: authenticated only, never anon
REVOKE ALL ON FUNCTION public.redeem_registration_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_registration_code(text) TO authenticated;;
