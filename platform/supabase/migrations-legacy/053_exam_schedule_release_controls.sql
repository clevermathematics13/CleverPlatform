-- 053: Add exam scheduling time and delayed-release controls for tests and exam builder

ALTER TABLE public.tests
  ADD COLUMN IF NOT EXISTS exam_time TIME,
  ADD COLUMN IF NOT EXISTS release_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tests_release_at
  ON public.tests (release_at)
  WHERE hidden = false;

-- Saved Exam metadata now tracks explicit exam time from the question builder.
ALTER TABLE public.saved_exams
  ADD COLUMN IF NOT EXISTS exam_time TEXT;

-- Backfill release time for rows that already have a date+time.
UPDATE public.tests
SET release_at = ((test_date::text || ' ' || exam_time::text)::timestamp AT TIME ZONE 'UTC') + INTERVAL '80 minutes'
WHERE release_at IS NULL
  AND test_date IS NOT NULL
  AND exam_time IS NOT NULL;
