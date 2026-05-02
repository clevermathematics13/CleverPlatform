-- 029: Add stem_latex columns to ib_questions
-- Stores the introductory/stem text that appears before the labelled parts
-- in multi-part IB questions (e.g. the function definition common to parts (a), (b), (c)).

ALTER TABLE public.ib_questions
  ADD COLUMN IF NOT EXISTS stem_latex            TEXT,
  ADD COLUMN IF NOT EXISTS stem_markscheme_latex TEXT;
