-- 045: Add exam paper and mark scheme URL columns to tests table
ALTER TABLE public.tests
  ADD COLUMN IF NOT EXISTS paper_url TEXT,
  ADD COLUMN IF NOT EXISTS mark_scheme_url TEXT;
