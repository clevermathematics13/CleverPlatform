-- 030: Add parts draft staging columns to ib_questions
-- Stores the full OCR-extracted IBPart block for all labelled parts of a question
-- before the reviewer distributes content into individual question_parts rows.

ALTER TABLE public.ib_questions
  ADD COLUMN IF NOT EXISTS parts_draft_latex            TEXT,
  ADD COLUMN IF NOT EXISTS parts_draft_markscheme_latex TEXT;
