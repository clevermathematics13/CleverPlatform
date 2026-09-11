-- ---------------------------------------------------------------------------
-- Practice questions that are written, not borrowed
-- ---------------------------------------------------------------------------
-- A practice set could only hold bank questions, which creates a problem the
-- teacher hit immediately: a past paper question spent on practice is spent.
-- It cannot then be used to assess, because the class has already seen it.
-- With ~100 integration questions tagged in the whole bank, that is a real
-- cost, and it gets worse every term.
--
-- So an item is now one of two things:
--
--   source = 'bank'       ib_question_code points at the bank; the student
--                         sees the scanned page, as before.
--   source = 'generated'  question_latex holds an ORIGINAL question, written
--                         against the same sub-topic and tariff as the bank
--                         question named in generated_from_code, but not that
--                         question. The bank question stays unused.
--
-- ib_question_code is therefore nullable, and a CHECK keeps each shape
-- coherent rather than letting half-filled rows through.
--
-- approved_at is the gate, and it is not decoration. A generated question is
-- machine-written mathematics: the phrasing can be off, the answer can be
-- wrong, and the only reliable check is a teacher reading it. Unapproved
-- generated items are invisible to students -- enforced in the RLS policy
-- below, not merely filtered in the query -- so the failure mode of the
-- generator is a question that never appears, never a wrong question in
-- front of a class.
--
-- answer_latex is the worked mark scheme. It is stored from the moment the
-- question is written, because a question whose answer nobody recorded is
-- worth very little later, and it is withheld by the same
-- practice_sets.markscheme_released_at gate that governs bank mark schemes.
-- Nothing serves it today: lib/practice-set-service.ts does not select the
-- column.

ALTER TABLE practice_set_items
  ADD COLUMN source text NOT NULL DEFAULT 'bank',
  ADD COLUMN question_latex text,
  ADD COLUMN answer_latex text,
  ADD COLUMN generated_from_code text,
  ADD COLUMN generator_model text,
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN approved_by uuid REFERENCES profiles(id);

ALTER TABLE practice_set_items
  ALTER COLUMN ib_question_code DROP NOT NULL;

ALTER TABLE practice_set_items
  ADD CONSTRAINT practice_set_items_source_check
    CHECK (source IN ('bank', 'generated')),
  ADD CONSTRAINT practice_set_items_shape_check
    CHECK (
      (source = 'bank' AND ib_question_code IS NOT NULL)
      OR
      (source = 'generated' AND question_latex IS NOT NULL AND ib_question_code IS NULL)
    );

COMMENT ON COLUMN practice_set_items.source IS
  'bank: a scanned past-paper question, addressed by ib_question_code. generated: an original question in question_latex, so the past paper it was modelled on stays unused and can still be set as an assessment.';
COMMENT ON COLUMN practice_set_items.question_latex IS
  'The question itself, body LaTeX only, following the conventions in platform/AGENTS.md. Rendered by components/LatexRenderer.';
COMMENT ON COLUMN practice_set_items.answer_latex IS
  'Worked mark scheme for a generated question. Withheld from students by practice_sets.markscheme_released_at, exactly as a bank mark scheme is; no code path selects this column today.';
COMMENT ON COLUMN practice_set_items.generated_from_code IS
  'The bank question whose sub-topic, tariff and technique this one was modelled on. Provenance only -- it is NOT that question, and the teacher can still set the original as an assessment.';
COMMENT ON COLUMN practice_set_items.approved_at IS
  'A generated question is invisible to students until a teacher has read it and approved it. Machine-written mathematics can be wrong, and this is what keeps a wrong question off a student''s screen.';

-- Students: bank items as before, generated items only once approved. The
-- condition lives in the policy rather than in the query because a draft
-- question that a teacher has not read is exactly the thing that must not
-- leak, and a policy is the only place that holds however the page is
-- rewritten later.
DROP POLICY IF EXISTS "Students can read items of released practice sets" ON practice_set_items;

CREATE POLICY "Students can read items of released practice sets"
  ON practice_set_items
  FOR SELECT USING (
    (source = 'bank' OR approved_at IS NOT NULL)
    AND EXISTS (
      SELECT 1 FROM practice_sets ps
      WHERE ps.id = practice_set_id
        AND ps.released_at IS NOT NULL
        AND public.student_is_on_course_roster(ps.course_id)
    )
  );