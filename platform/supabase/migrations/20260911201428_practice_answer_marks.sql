-- ---------------------------------------------------------------------------
-- A teacher's read of one practice answer
-- ---------------------------------------------------------------------------
-- The marking view lets a teacher work through a class's practice answers one
-- question at a time. This is where that reading is recorded.
--
-- It is NOT a mark. There is no score column, no total, nothing that can be
-- summed, and no path from here to the gradebook -- the same line practice_sets
-- and practice_answers already hold. What a teacher records is which of three
-- states an answer is in and, optionally, a sentence about it. That is enough
-- to answer "who has not got integration by parts yet" without turning
-- revision into an assessment.
--
-- Deliberately NOT visible to students. RLS is enabled below and there is no
-- student policy of any kind, so a student cannot read these rows at all.
-- Showing them is a separate decision with its own release gate, exactly as
-- mark schemes have markscheme_released_at -- and it should be made
-- deliberately rather than inherited by a policy someone widened.
--
-- Keyed on the ANSWER, one mark per answer. When a student then edits that
-- answer, the mark is not deleted: practice_answers.updated_at moves past
-- practice_answer_marks.updated_at, and the view says the answer changed since
-- it was read. Throwing the teacher's note away because the student added a
-- line would be worse than showing it as stale.

CREATE TABLE practice_answer_marks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_answer_id uuid NOT NULL UNIQUE
    REFERENCES practice_answers(id) ON DELETE CASCADE,
  verdict text NOT NULL CHECK (verdict IN ('correct', 'almost', 'not_yet')),
  note text,
  marked_by uuid NOT NULL REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE practice_answer_marks IS
  'A teacher''s read of one practice answer: correct | almost | not_yet, plus an optional note. Not a score and not assessment -- nothing here reaches the gradebook. Teacher-only: RLS grants students no access at all.';
COMMENT ON COLUMN practice_answer_marks.verdict IS
  'correct | almost | not_yet. Three states rather than a mark out of the tariff, because practice is not assessment and a number here would be one.';
COMMENT ON COLUMN practice_answer_marks.updated_at IS
  'Compared against practice_answers.updated_at to detect an answer edited after it was read. The mark is kept and shown as stale rather than discarded.';

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON practice_answer_marks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE practice_answer_marks ENABLE ROW LEVEL SECURITY;

-- Teachers only, and no second policy. A table with RLS on and no policy
-- matching a student is closed to them -- that is the intended state, not an
-- omission to be tidied up later.
CREATE POLICY "Teachers can manage practice answer marks"
  ON practice_answer_marks
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'teacher')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'teacher')
  );