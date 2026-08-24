-- Add teacher_notes column to ib_questions for per-question teacher annotations
ALTER TABLE public.ib_questions
  ADD COLUMN IF NOT EXISTS teacher_notes TEXT;
