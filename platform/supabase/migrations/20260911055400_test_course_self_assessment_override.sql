-- ---------------------------------------------------------------------------
-- Releasing one class's marks without releasing the whole track's
-- ---------------------------------------------------------------------------
-- tests.require_self_assessment is the gate on a student seeing Clev's Marks
-- before they have self-graded, and it lives on the test. A test belongs to
-- one course but is sat by its whole track family (migration
-- 20260905182550): Formative Assessment 1 hangs off 9G and is sat by 9A, 9C,
-- 9D and 9G alike. So the only way to release marks to one class was to
-- release them to all four, roughly 69 students, which is not a decision
-- anyone wanted to make on one class's behalf.
--
-- This is the per-class exception. A row here overrides the test's own flag
-- for exactly one course; no row means the test's flag stands, so every
-- existing test keeps behaving exactly as it does today.
--
-- Deliberately not a column on some course-test join table that does not
-- exist: the pair IS the identity here, and the primary key says so.
--
-- Resolution is in lib/self-assessment-gate.ts, and it fails closed -- see
-- that file for why "any override still requires it" rather than "the last
-- one wins".

CREATE TABLE test_course_self_assessment (
  test_id uuid NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  require_self_assessment boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (test_id, course_id)
);

COMMENT ON TABLE test_course_self_assessment IS
  'Per-course override of tests.require_self_assessment, for releasing one class''s marks without releasing every class in the track family. No row means the test''s own flag applies.';
COMMENT ON COLUMN test_course_self_assessment.require_self_assessment IS
  'False releases Clev''s Marks to this course without self-grading first. True re-imposes the gate on this course even where the test itself has it switched off.';

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON test_course_self_assessment
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE test_course_self_assessment ENABLE ROW LEVEL SECURITY;

-- A student has to be able to read the row that governs their own gate: the
-- reflection page resolves it through the user-scoped client, not the service
-- role. Security definer for the same reason track_family_course_ids is --
-- the policy has to consult students, which a student cannot read directly.
CREATE OR REPLACE FUNCTION public.student_is_enrolled_in_course(p_course_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.students s
    WHERE s.profile_id = auth.uid()
      AND s.course_id = p_course_id
  );
$$;

COMMENT ON FUNCTION public.student_is_enrolled_in_course(uuid) IS
  'True when the signed-in student is enrolled in exactly this course -- their own class, NOT its track family. Backs the student SELECT policy on test_course_self_assessment: the override is per class, so widening this to the family would let one class''s release leak to its siblings, which is the whole thing this table exists to prevent.';

REVOKE EXECUTE ON FUNCTION public.student_is_enrolled_in_course(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.student_is_enrolled_in_course(uuid) TO authenticated;

CREATE POLICY "Students can read their own class's self-assessment setting"
  ON test_course_self_assessment
  FOR SELECT USING (public.student_is_enrolled_in_course(course_id));

CREATE POLICY "Teachers can read self-assessment overrides"
  ON test_course_self_assessment
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'teacher')
  );

CREATE POLICY "Teachers can write self-assessment overrides"
  ON test_course_self_assessment
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'teacher')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'teacher')
  );
