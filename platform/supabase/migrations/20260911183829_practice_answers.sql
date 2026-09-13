-- ---------------------------------------------------------------------------
-- Student answers to practice questions
-- ---------------------------------------------------------------------------
-- Until now a practice set was something to read. This is where the student
-- writes back: one row per (question part, student), holding the LaTeX their
-- notation editor produced.
--
-- Keyed per PART, not per question. A question's parts are (a), (b), (c) in
-- its own LaTeX, and a student answering a five-part question into one box
-- cannot be marked against a tariff that is stated per part. Questions with no
-- parts -- and every bank question, which is a scan with no parsable
-- structure -- use the empty string as their single part label, so the key
-- shape is the same either way and no column is nullable-with-meaning.
--
-- Storage is LaTeX because that is what the editor emits and what
-- LatexRenderer already reads. It is never executed or evaluated; nothing in
-- this codebase interprets it. Treat it as what it is -- text a student typed.
--
-- Two things this table deliberately does NOT do:
--
--   * No marks, no score, no correctness. Practice is not assessment; the
--     whole point of practice_sets was to keep it out of the gradebook, and a
--     grade column here would be the first step back towards it.
--   * No teacher writes. The policies below give teachers SELECT and nothing
--     else. This is not caution for its own sake: the student practice page
--     is the same page a teacher opens with ?viewAs=, running in the
--     teacher's own client with the teacher's own rights. Without this, a
--     teacher previewing a student's page could save an answer INTO that
--     student's record just by typing in the box.

CREATE TABLE practice_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_set_item_id uuid NOT NULL
    REFERENCES practice_set_items(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  part_label text NOT NULL DEFAULT '',
  answer_latex text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (practice_set_item_id, profile_id, part_label)
);

-- The two shapes this table is read in: "this student's answers for this set"
-- (the student's own page, and the teacher looking at one student) and "every
-- answer to this question" (the teacher reading a class's work on one part).
CREATE INDEX practice_answers_student_idx
  ON practice_answers (profile_id, practice_set_item_id);
CREATE INDEX practice_answers_item_idx
  ON practice_answers (practice_set_item_id);

COMMENT ON TABLE practice_answers IS
  'A student''s written answer to one part of one practice question, as LaTeX from the notation editor. Not assessment: no marks, no correctness, never reaches the gradebook. Teachers can read these and cannot write them.';
COMMENT ON COLUMN practice_answers.part_label IS
  'The part this answers, exactly as the question labels it: "(a)", "(b)". Empty string for a question with no parts, which includes every scanned bank question.';
COMMENT ON COLUMN practice_answers.answer_latex IS
  'LaTeX as typed. Never executed or evaluated -- it is rendered, and it is student input, so treat it as untrusted text.';

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON practice_answers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE practice_answers ENABLE ROW LEVEL SECURITY;

-- One predicate, used by all four student policies, so read and write can
-- never drift apart: it is your row, on a question in a set that has actually
-- been released to a course you are on.
--
-- The released_at check is not redundant with the SELECT policy on
-- practice_set_items. A student who kept an item id from a set that was later
-- withdrawn would otherwise still be able to write against it.
CREATE OR REPLACE FUNCTION public.can_write_practice_answer(p_item_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.practice_set_items i
    JOIN public.practice_sets ps ON ps.id = i.practice_set_id
    WHERE i.id = p_item_id
      AND ps.released_at IS NOT NULL
      AND public.student_is_on_course_roster(ps.course_id)
  );
$$;

COMMENT ON FUNCTION public.can_write_practice_answer(uuid) IS
  'True when the signed-in user may hold an answer against this practice item: the item''s set is released and they are on that course''s roster. SECURITY DEFINER because a student cannot read practice_sets rows that are not released, so the policy cannot make this check unaided.';

REVOKE EXECUTE ON FUNCTION public.can_write_practice_answer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_write_practice_answer(uuid) TO authenticated;

CREATE POLICY "Students can read their own practice answers"
  ON practice_answers
  FOR SELECT USING (profile_id = auth.uid());

CREATE POLICY "Students can write their own practice answers"
  ON practice_answers
  FOR INSERT WITH CHECK (
    profile_id = auth.uid()
    AND public.can_write_practice_answer(practice_set_item_id)
  );

-- profile_id is checked in both USING and WITH CHECK so a row cannot be
-- updated and handed to somebody else in the same statement.
CREATE POLICY "Students can revise their own practice answers"
  ON practice_answers
  FOR UPDATE USING (
    profile_id = auth.uid()
    AND public.can_write_practice_answer(practice_set_item_id)
  ) WITH CHECK (
    profile_id = auth.uid()
    AND public.can_write_practice_answer(practice_set_item_id)
  );

CREATE POLICY "Students can delete their own practice answers"
  ON practice_answers
  FOR DELETE USING (profile_id = auth.uid());

-- SELECT only, and deliberately so -- see the note at the top of this file
-- about ?viewAs= running in the teacher's own client.
CREATE POLICY "Teachers can read practice answers"
  ON practice_answers
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'teacher')
  );