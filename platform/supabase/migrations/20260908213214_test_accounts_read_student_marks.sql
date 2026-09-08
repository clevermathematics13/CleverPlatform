-- "View as <student>" showed an empty Teacher column for a student who had
-- in fact been marked, while their self-assessment showed fine. The two
-- tables disagreed about what "teacher" means:
--
--   student_self_scores  teachers see all    get_my_role() = 'teacher'
--   student_marks        teachers see OWN    tests.teacher_id = auth.uid()
--
-- The two multi-role test accounts are teachers by role but own no tests --
-- every test belongs to clevermathematics@gmail.com -- so marks were
-- invisible to them and self-scores were not. Acting as
-- pcleveng@amersol.edu.pe, Alonso Yoshiyama's Formative Assessment 1 read
-- back 0 marks and 41 self-scores, which is exactly what the page rendered.
--
-- Ownership-scoping is kept for everyone else: a second teacher must not be
-- able to read this teacher's marks, and widening the existing policy to
-- get_my_role() = 'teacher' would have granted exactly that. This adds a
-- separate SELECT policy for the two known accounts instead. The same two
-- ids are already hardcoded in set_test_account_role().
--
-- SELECT only, deliberately. The preview is read-only -- it says so on the
-- page -- and these accounts have no business writing marks on tests they do
-- not own. The existing "Teachers can manage student marks" ALL policy is
-- untouched.
drop policy if exists "Test accounts can read student marks" on public.student_marks;

create policy "Test accounts can read student marks"
  on public.student_marks
  for select
  using (
    auth.uid() = any (array[
      '44db5d56-f3ab-419f-9238-83377ac05b1d'::uuid,  -- pcleveng@amersol.edu.pe
      '822c943e-f9ff-46ab-8953-4c99229c9f03'::uuid   -- paulsclevenger@gmail.com
    ])
  );
