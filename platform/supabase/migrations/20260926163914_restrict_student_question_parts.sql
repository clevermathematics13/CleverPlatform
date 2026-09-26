-- ---------------------------------------------------------------------------
-- Students can no longer read question_parts (it carries the mark schemes)
-- ---------------------------------------------------------------------------
-- "Students can view question parts" (migrations-legacy/003_ib_question_bank.sql)
-- let any signed-in student or teacher SELECT every row, so a student's own
-- JWT could read every markscheme_latex and markscheme_text in the bank
-- through PostgREST. 20260911142419_restrict_student_markscheme_images.sql
-- closed the same hole for mark scheme images, and lib/practice-set-service.ts
-- is written on the premise that a student cannot reach a mark scheme.
--
-- Nothing student-facing reads question_parts: every reader in app/ and lib/
-- is behind getApiTeacher() or uses the service role (the process-correction
-- edge function among them), so dropping the policy removes no feature.
-- Teachers keep "Teachers can manage question parts" (FOR ALL); policies are
-- OR-ed, so dropping this one cannot narrow a teacher.
--
-- Applied before the bulk mark-scheme build fills the bank, which would
-- otherwise have made ~2,000 schemes readable (docs/HANDOFF.md).

DROP POLICY IF EXISTS "Students can view question parts" ON public.question_parts;

COMMENT ON POLICY "Teachers can manage question parts" ON public.question_parts IS
  'The only policy on question_parts. Students have none: the table carries mark schemes (markscheme_latex, markscheme_text). A student-facing feature that needs part labels or marks must read them through the service role or a narrower view, never by re-adding a student SELECT policy here.';
