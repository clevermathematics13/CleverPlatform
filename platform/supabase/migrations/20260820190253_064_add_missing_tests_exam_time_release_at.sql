-- 064: complete migration 053, which added exam_time/release_at to
-- saved_exams successfully but never actually added them to public.tests --
-- confirmed directly: tests had no exam_time/release_at columns at all,
-- while every route in the app (GET/POST /api/tests, GET/PATCH /api/tests/[id],
-- lib/exam-service.ts, gradebook/tests/route.ts, tests-client.tsx) has been
-- selecting/inserting those columns since 053 was written. The manual
-- "+ Create Test" form's INSERT would have failed outright on every attempt;
-- SELECTs with .single() failed and were being reported to users as
-- "Test not found" (a misleading fallback message, not the real cause).

ALTER TABLE public.tests
  ADD COLUMN IF NOT EXISTS exam_time TIME,
  ADD COLUMN IF NOT EXISTS release_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tests_release_at
  ON public.tests (release_at)
  WHERE hidden = false;

-- Backfill is a no-op today (no existing row has exam_time set, since the
-- column didn't exist until this migration), but kept for parity with 053
-- in case any row is ever inserted with test_date+exam_time but no
-- release_at going forward via a path that doesn't derive it itself.
UPDATE public.tests
SET release_at = ((test_date::text || ' ' || exam_time::text)::timestamp AT TIME ZONE 'UTC') + INTERVAL '80 minutes'
WHERE release_at IS NULL
  AND test_date IS NOT NULL
  AND exam_time IS NOT NULL;;
