-- ---------------------------------------------------------------------------
-- Students can no longer reach mark scheme images
-- ---------------------------------------------------------------------------
-- Until now a signed-in student could read every mark scheme in the bank.
-- Two policies combined to allow it, and neither was obviously wrong on its
-- own:
--
--   public.question_images  "Students can view question image records"
--     -> SELECT for role student|teacher with no filter, so a student could
--        list the storage_path of every markscheme row.
--
--   storage.objects         "Students can read question images"
--     -> SELECT for `authenticated` on the whole question-images bucket, so
--        a student could sign a URL for any of those paths.
--
-- Nothing in the student UI did that, which is why it went unnoticed; the
-- practice-set page is the first student-facing feature to show bank
-- questions at all, and it would have shipped with the answers one fetch
-- behind them. /api/questions/images was the ready-made route -- it took any
-- authenticated user and returned signed URLs for both image types -- and it
-- is narrowed to teachers in the same change as this migration.
--
-- The bucket is worse than the table suggests. Alongside the tidy
-- <code>/question/ and <code>/markscheme/ directories it holds several
-- hundred raw uploads under their own prefixes -- "..._markscheme",
-- "..._ms", whole past-paper mark scheme PDFs rasterised a page at a time --
-- none of which have question_images rows. A deny-list on image_type would
-- have left every one of those readable, so the storage policy below is an
-- allow-list: the second path segment must be exactly "question". Everything
-- else in the bucket, known or not, is closed to students.
--
-- Teachers are untouched. Both tables already carry a separate FOR ALL
-- teacher policy, and RLS policies are OR-ed, so narrowing the student one
-- cannot narrow a teacher. Server routes that use the service role bypass
-- RLS entirely and are likewise unaffected.

-- ---- question_images: students see question rows only ---------------------

DROP POLICY IF EXISTS "Students can view question image records" ON public.question_images;

CREATE POLICY "Students can view question image records"
  ON public.question_images
  FOR SELECT USING (
    image_type = 'question'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'student'
    )
  );

COMMENT ON POLICY "Students can view question image records" ON public.question_images IS
  'Students see question images and nothing else. Teachers read every row through "Teachers can manage question image records". Widening this to markscheme rows re-opens the leak the practice-set work closed.';

-- ---- storage: students read <code>/question/* and nothing else ------------

DROP POLICY IF EXISTS "Students can read question images" ON storage.objects;

CREATE POLICY "Students can read question images"
  ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'question-images'
    AND (storage.foldername(name))[2] = 'question'
    AND public.get_my_role() = 'student'
  );

COMMENT ON POLICY "Students can read question images" ON storage.objects IS
  'Allow-list, not a deny-list: only the second path segment "question" is readable by a student. The bucket also holds raw mark scheme uploads under arbitrary prefixes, so anything matched by shape rather than by exact segment would let those through.';