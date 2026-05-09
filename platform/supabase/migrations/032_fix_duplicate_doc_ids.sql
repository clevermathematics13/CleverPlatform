-- 032: Clear google_doc_id where it equals google_ms_id
-- This happens when the same markscheme document was stored in both the
-- question and markscheme Drive folders, causing the import route to assign
-- the same doc ID to both fields.

-- Step 1: Delete question images that were extracted from the markscheme doc
-- (identified by their source_google_doc_id matching the question's google_ms_id
--  in rows where google_doc_id = google_ms_id, i.e. both fields are wrong).
DELETE FROM public.question_images qi
USING public.ib_questions iq
WHERE qi.question_id = iq.id
  AND qi.image_type = 'question'
  AND iq.google_doc_id IS NOT NULL
  AND iq.google_ms_id IS NOT NULL
  AND iq.google_doc_id = iq.google_ms_id
  AND qi.source_google_doc_id = iq.google_ms_id;

-- Step 2: NULL out google_doc_id where it equals google_ms_id.
UPDATE public.ib_questions
SET google_doc_id = NULL
WHERE google_doc_id IS NOT NULL
  AND google_ms_id IS NOT NULL
  AND google_doc_id = google_ms_id;
