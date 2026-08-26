-- Adds evidence_image_path to ai_grade_results: the storage path (in the
-- exam-scans bucket) of the cropped scan region the model localised as the
-- student's work for this part. Populated best-effort by the grading route
-- via the CV service's /crop endpoint; null when the model did not
-- localise the work or the crop service is unavailable.
ALTER TABLE public.ai_grade_results
  ADD COLUMN IF NOT EXISTS evidence_image_path TEXT;
