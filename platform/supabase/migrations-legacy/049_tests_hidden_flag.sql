-- 049: Add hidden flag to tests for reflection visibility control

ALTER TABLE public.tests
  ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_tests_hidden_false
  ON public.tests (hidden)
  WHERE hidden = false;
