-- ---------------------------------------------------------------------------
-- Practice sets: a teacher-curated list of bank questions, shown to a class
-- ---------------------------------------------------------------------------
-- A practice set is a handful of ib_questions put in front of one course to
-- work through outside a test. It is deliberately NOT a `tests` row and NOT a
-- `saved_exams` row: those two are the assessment path (marks, boundaries,
-- gradebook, Clev's Marks) and the paper-builder's own scratch space, and a
-- set of revision questions is neither. Reusing either would have put practice
-- questions into the gradebook and into the bank's "this has been used with
-- this class" history, which is exactly what a practice set must not do.
--
-- Two independent release gates, both closed by default:
--
--   released_at            -- null: students cannot see the set at all.
--   markscheme_released_at -- null: students see the questions and no answers.
--
-- They are separate because the normal shape of this is "attempt it this week,
-- answers on Friday", and that is one UPDATE rather than a rebuild. Both are
-- timestamps rather than booleans so the record says *when*, which matters
-- when a student asks why they could see something yesterday.
--
-- Nothing here grants access to mark scheme content on its own.
-- markscheme_released_at is the app-level gate; the hard boundary is the RLS
-- on question_images and on the question-images bucket, tightened in the
-- migration that follows this one. Read that one too before wiring a mark
-- scheme into any student-facing page.

CREATE TABLE practice_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  released_at timestamptz,
  markscheme_released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX practice_sets_course_idx ON practice_sets (course_id);

COMMENT ON TABLE practice_sets IS
  'A teacher-curated list of bank questions shown to one course for practice. Not an assessment: deliberately separate from tests and saved_exams so practice never reaches the gradebook or the bank''s usage history.';
COMMENT ON COLUMN practice_sets.released_at IS
  'Null means students cannot see the set. Set it to publish; clear it to withdraw.';
COMMENT ON COLUMN practice_sets.markscheme_released_at IS
  'Null means students see questions only. Independent of released_at so answers can follow the attempt. The enforcing boundary is the RLS on question_images and on the question-images bucket, not this column.';

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON practice_sets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- marks and subtopic_codes are snapshots taken from question_parts when the
-- set is built, not live joins. A tariff a student has already been shown
-- must not change because someone re-tagged the bank mid-week, and the
-- sub-topic label is the one the teacher signed off on, not whatever the
-- bank says today. Question CONTENT is still live -- it is read from
-- ib_questions / question_images by code.
CREATE TABLE practice_set_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_set_id uuid NOT NULL REFERENCES practice_sets(id) ON DELETE CASCADE,
  position integer NOT NULL,
  ib_question_code text NOT NULL
    REFERENCES ib_questions(code) ON UPDATE CASCADE ON DELETE RESTRICT,
  tier text NOT NULL CHECK (tier IN ('basic', 'medium', 'challenging')),
  marks integer NOT NULL CHECK (marks > 0),
  subtopic_codes text[] NOT NULL DEFAULT '{}',
  teacher_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (practice_set_id, position)
);

CREATE INDEX practice_set_items_set_idx ON practice_set_items (practice_set_id, position);

COMMENT ON TABLE practice_set_items IS
  'One bank question in a practice set. ON DELETE RESTRICT on the question code: a question a class has been handed cannot quietly vanish from under them when the bank is tidied.';
COMMENT ON COLUMN practice_set_items.tier IS
  'basic | medium | challenging -- the teacher''s difficulty call, shown to students as the section heading. Not derived from ib_questions.difficulty, which is null for every row in the bank.';
COMMENT ON COLUMN practice_set_items.marks IS
  'Snapshot of the question''s total tariff at the time the set was built.';
COMMENT ON COLUMN practice_set_items.teacher_note IS
  'Teacher-facing note on why this question is in the set. Never sent to students.';

ALTER TABLE practice_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_set_items ENABLE ROW LEVEL SECURITY;

-- Per class, not per track family. A practice set is handed to one class by
-- name; widening it to the family would put 9A's revision in front of 9C.
-- student_is_enrolled_in_course is the existing security-definer helper
-- (migration 20260911055400) -- a student cannot read `students` directly,
-- so the policy cannot consult it without one.
CREATE POLICY "Students can read released practice sets for their course"
  ON practice_sets
  FOR SELECT USING (
    released_at IS NOT NULL
    AND public.student_is_enrolled_in_course(course_id)
  );

CREATE POLICY "Teachers can manage practice sets"
  ON practice_sets
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'teacher')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'teacher')
  );

-- The item policy repeats the parent's conditions rather than trusting that
-- the caller joined through practice_sets: a student querying
-- practice_set_items directly with a guessed set id has to fail, and it only
-- fails if the check lives here too.
CREATE POLICY "Students can read items of released practice sets"
  ON practice_set_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM practice_sets ps
      WHERE ps.id = practice_set_id
        AND ps.released_at IS NOT NULL
        AND public.student_is_enrolled_in_course(ps.course_id)
    )
  );

CREATE POLICY "Teachers can manage practice set items"
  ON practice_set_items
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'teacher')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'teacher')
  );