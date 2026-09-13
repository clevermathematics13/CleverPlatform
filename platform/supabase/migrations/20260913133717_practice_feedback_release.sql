-- ---------------------------------------------------------------------------
-- Handing a teacher's marking back to the students
-- ---------------------------------------------------------------------------
-- practice_answer_marks was built teacher-only and said so: RLS on, no student
-- policy of any kind, and a note that showing this work to a class should be a
-- separate decision with its own release gate rather than something inherited
-- by widening a policy. This is that decision, and this is that gate.
--
-- practice_sets now has THREE independent gates, all closed by default:
--
--   released_at            -- null: the class cannot see the set at all.
--   markscheme_released_at -- null: they see questions, not worked answers.
--   feedback_released_at   -- null: they cannot see what you wrote about them.
--
-- Three rather than one because they move at different times in a normal week:
-- attempt it Monday, feedback once you have read the class, worked answers
-- only after that. Collapsing them would mean handing back the mark scheme in
-- order to hand back a comment.
--
-- Adding the column and the policy is safe to apply ahead of any UI, which is
-- the order this was done in: every existing row has feedback_released_at
-- null, so the new policy matches nothing until a teacher deliberately opens
-- one set. There is no window in which this widens what anybody can read.

ALTER TABLE practice_sets
  ADD COLUMN feedback_released_at timestamptz;

COMMENT ON COLUMN practice_sets.feedback_released_at IS
  'Null means students cannot see the teacher''s marking of their own answers. Independent of the other two gates: feedback usually goes back before worked answers do. The enforcing boundary is the student SELECT policy on practice_answer_marks, not this column.';

-- A student may read a mark when BOTH hold: it is on their own answer, and the
-- set it belongs to has had feedback released. Neither half is checked
-- anywhere else, so neither can be skipped by querying the table directly.
--
-- SECURITY DEFINER because the chain from a mark back to its set runs through
-- practice_answers and practice_set_items, and a student cannot read another
-- student's practice_answers row -- the policy would be evaluating a join it
-- is not allowed to see.
CREATE OR REPLACE FUNCTION public.can_read_practice_feedback(p_answer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.practice_answers a
    JOIN public.practice_set_items i ON i.id = a.practice_set_item_id
    JOIN public.practice_sets ps ON ps.id = i.practice_set_id
    WHERE a.id = p_answer_id
      AND a.profile_id = auth.uid()
      AND ps.feedback_released_at IS NOT NULL
  );
$$;

COMMENT ON FUNCTION public.can_read_practice_feedback(uuid) IS
  'True when the signed-in student may read the teacher''s mark on this answer: it is their own answer and the set has feedback_released_at set. SECURITY DEFINER because the chain from mark to set runs through rows a student cannot select directly.';

REVOKE EXECUTE ON FUNCTION public.can_read_practice_feedback(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_practice_feedback(uuid) TO authenticated;

-- SELECT only. A student reads their feedback and can no more write to this
-- table than a teacher can write to practice_answers -- the two directions
-- stay separate, so neither can quietly become the other.
CREATE POLICY "Students can read released feedback on their own answers"
  ON practice_answer_marks
  FOR SELECT USING (
    public.can_read_practice_feedback(practice_answer_id)
  );