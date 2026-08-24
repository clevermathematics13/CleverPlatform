-- 018: Exam builder fields — curriculum, section, and cover page templates

-- ============================================
-- 1. Add curriculum (AA/AI) to ib_questions
-- ============================================
ALTER TABLE public.ib_questions
  ADD COLUMN IF NOT EXISTS curriculum TEXT[] DEFAULT ARRAY['AA']::TEXT[];

-- ============================================
-- 2. Add section (A/B) to ib_questions
-- P3 questions keep section = NULL (not applicable)
-- P1/P2: H_1..H_7 → A, H_8+ → B
-- ============================================
ALTER TABLE public.ib_questions
  ADD COLUMN IF NOT EXISTS section TEXT CHECK (section IN ('A', 'B'));

-- Auto-populate section for existing P1/P2 questions based on question number in code
-- Code format: e.g. "22M.2.AHL.TZ1.H_6" — extract the integer after H_
UPDATE public.ib_questions
SET section = CASE
  WHEN (regexp_replace(code, '^.*H_', ''))::int <= 7 THEN 'A'
  ELSE 'B'
END
WHERE paper IN (1, 2)
  AND code ~ 'H_[0-9]+$';

-- ============================================
-- 3. Exam cover page templates table
-- Keyed by curriculum × level × paper (10 combinations)
-- ============================================
CREATE TABLE IF NOT EXISTS public.exam_templates (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum            TEXT NOT NULL CHECK (curriculum IN ('AA', 'AI')),
  level                 TEXT NOT NULL CHECK (level IN ('HL', 'SL')),
  paper                 INT  NOT NULL CHECK (paper IN (1, 2, 3)),
  slide_presentation_id TEXT NOT NULL,
  -- Normalized coordinates (0–1) of the {Name} text box on slide 1
  -- Populated by the cover API route the first time it inspects the slide
  name_field_x          FLOAT,
  name_field_y          FLOAT,
  name_field_w          FLOAT,
  name_field_h          FLOAT,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (curriculum, level, paper)
);

-- Seed all 10 templates
INSERT INTO public.exam_templates (curriculum, level, paper, slide_presentation_id) VALUES
  ('AA', 'HL', 1, '1U78I4Kb0YiAqc0R6ToUIlBcUjZBfAytHiOy8S6Tvb44'),
  ('AA', 'HL', 2, '1NHn0YHpXI2vSe93Eb5ZqjpOOrja7bIk7RWIQ04YghJM'),
  ('AA', 'HL', 3, '1kHNlxofIGvKswyjChXhTdwUugHh1q_p1QdesWJSSUas'),
  ('AA', 'SL', 1, '1TxYOgV2EGgreU0oDz82ANyFrWZ0V0DFqgmqKUE2pwOg'),
  ('AA', 'SL', 2, '1wmW3sKhwDMcqQ1ExyVrrngge1b2hgngi8icAsiE-fPc'),
  ('AI', 'HL', 1, '1e2SU7CMdVzIDZMm7p3Sn6w8-3ze375da6heseGUUYTs'),
  ('AI', 'HL', 2, '1FGmu2L1-CB1LlNUC0fko8EUG9T5Skj_iXJ-KdriMNOk'),
  ('AI', 'HL', 3, '1EoEoHNvRgbT3rfWFVm8RPwbJGMtsv9juty9N1jaoGuQ'),
  ('AI', 'SL', 1, '1bbilLJFXIUSBQ5107DwnF_rMt9-xGrUiBuCWWFBkHHU'),
  ('AI', 'SL', 2, '1TbES-KYjCbc_aznH_5061dYJizBo2fYhJz2HTuxYkxs')
ON CONFLICT (curriculum, level, paper) DO NOTHING;

-- RLS: teachers can manage; students have no access
ALTER TABLE public.exam_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers can manage exam templates"
  ON public.exam_templates FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'teacher'
  ));
