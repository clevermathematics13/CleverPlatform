-- The `corrections` bucket has carried INSERT and SELECT policies since
-- migrations-legacy/010_reflection_portal.sql and has never had an UPDATE or a
-- DELETE one. Two consequences, both live until now:
--
--   * clearPdfUpload() (lib/exam-service.ts) calls storage .remove() with the
--     student's own JWT. With no DELETE policy the removal did nothing, while
--     the pdf_uploads row was deleted regardless, so the object was stranded.
--     Verified against production on 10 Sep 2026: 6 objects in the bucket, 0 of
--     them referenced by a live pdf_uploads row.
--
--   * UploadSection uploads with { upsert: true }. Writing to a key that
--     already exists takes the update path, which no policy allowed, so a
--     student re-uploading under a filename they had used before would get
--     "new row violates row-level security policy". Correction keys now carry a
--     unique prefix, so that path is no longer reached in practice, but the
--     grant belongs on the bucket rather than resting on a key-naming detail.
--
-- Shape follows the four policies exam-scans got in
-- 20260813120227_ai_grading_exam_scans_bucket.sql. The three policies already on
-- this bucket keep their original quoted names; the ones added here use the
-- snake_case convention the newer migrations follow.
--
-- Teachers get DELETE but deliberately not UPDATE: nothing writes to this
-- bucket as a teacher, so there is no path that would need it.

-- Students may overwrite an object inside their own folder.
-- `with check` matters here in a way it does not for the teacher-only policies
-- on exam-scans: without it, an UPDATE could rename an object out of the
-- student's own folder and into another student's.
drop policy if exists corrections_student_update on storage.objects;
create policy corrections_student_update
  on storage.objects for update
  using (
    bucket_id = 'corrections'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'corrections'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Students may delete inside their own folder, which is what the
-- "Remove & Re-upload" button has been asking for all along.
drop policy if exists corrections_student_delete on storage.objects;
create policy corrections_student_delete
  on storage.objects for delete
  using (
    bucket_id = 'corrections'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Teachers may delete anything in the bucket, so the stranded objects above can
-- be cleared and a wrongly uploaded correction can be removed.
drop policy if exists corrections_teacher_delete on storage.objects;
create policy corrections_teacher_delete
  on storage.objects for delete
  using (
    bucket_id = 'corrections'
    and public.get_my_role() = 'teacher'
  );
