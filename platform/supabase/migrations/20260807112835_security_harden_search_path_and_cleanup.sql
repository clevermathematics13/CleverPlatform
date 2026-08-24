-- ============================================================================
-- MEDIUM: pin search_path on remaining functions. Pinned to `public` rather
-- than '' because these bodies use unqualified table references; the point is
-- that the path is no longer role-mutable, not that it is empty.
-- ============================================================================

ALTER FUNCTION public.handle_updated_at()                          SET search_path = public;
ALTER FUNCTION public.set_updated_at()                             SET search_path = public;
ALTER FUNCTION public.update_updated_at()                          SET search_path = public;
ALTER FUNCTION public.enforce_student_submission_update()          SET search_path = public;
ALTER FUNCTION public.trg_question_parts_normalize_context_terms() SET search_path = public;
ALTER FUNCTION public.trg_question_parts_sync_command_terms()      SET search_path = public;
ALTER FUNCTION public.trigger_correction_check()                   SET search_path = public;
ALTER FUNCTION public.update_question_studio_settings_updated_at() SET search_path = public;
ALTER FUNCTION public.platform_design_settings_updated_at()        SET search_path = public;
ALTER FUNCTION public.touch_google_oauth_tokens()                  SET search_path = public;
ALTER FUNCTION public.normalize_command_terms(p_command_term text, p_command_terms text[])
                                                                   SET search_path = public;
ALTER FUNCTION public.normalize_instructional_context_terms(p_command_term text, p_terms text[])
                                                                   SET search_path = public;

-- ---------------------------------------------------------------------------
-- mirror_marks_to_pablo(): a personal/debug trigger left running in
-- production. It copied the marks of any student whose display_name matched
-- '%camilla%' into the teacher's own student_marks rows.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT tg.tgname, c.relname
    FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_proc p  ON p.oid = tg.tgfoid
    WHERE p.proname = 'mirror_marks_to_pablo' AND NOT tg.tgisinternal
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t.tgname, t.relname);
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.mirror_marks_to_pablo();

-- ---------------------------------------------------------------------------
-- nuanced_analyses: previously SELECT USING (true) for all authenticated
-- users, so every student could read every generated activity packet
-- (including worked solutions). Teacher-only.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can read nuanced_analyses" ON public.nuanced_analyses;

CREATE POLICY "Teachers can read nuanced_analyses"
  ON public.nuanced_analyses FOR SELECT
  TO authenticated
  USING (public.get_my_role() = 'teacher');;
