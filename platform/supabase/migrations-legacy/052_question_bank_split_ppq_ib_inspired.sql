-- 052: Split question banks into PPQ and IB-inspired

-- Canonical bank registry
CREATE TABLE IF NOT EXISTS public.question_banks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  student_visible BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT question_banks_id_check CHECK (id IN ('ppq', 'ib_inspired'))
);

INSERT INTO public.question_banks (id, name, description, is_active, student_visible)
VALUES
  ('ppq', 'Past Paper Questions (PPQ)', 'Legacy and existing past paper question set', true, true),
  ('ib_inspired', 'IB-inspired Questions', 'New custom IB-inspired question bank', true, false)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_active = EXCLUDED.is_active,
  student_visible = EXCLUDED.student_visible;

ALTER TABLE public.question_banks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Everyone can view question banks" ON public.question_banks;
CREATE POLICY "Everyone can view question banks"
  ON public.question_banks FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Teachers can manage question banks" ON public.question_banks;
CREATE POLICY "Teachers can manage question banks"
  ON public.question_banks FOR ALL
  USING (public.get_my_role() = 'teacher')
  WITH CHECK (public.get_my_role() = 'teacher');

-- Existing ib_questions are now explicitly PPQ
ALTER TABLE public.ib_questions
  ADD COLUMN IF NOT EXISTS bank_id TEXT NOT NULL DEFAULT 'ppq';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ib_questions_bank_id_fkey'
      AND conrelid = 'public.ib_questions'::regclass
  ) THEN
    ALTER TABLE public.ib_questions
      ADD CONSTRAINT ib_questions_bank_id_fkey
      FOREIGN KEY (bank_id) REFERENCES public.question_banks(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ib_questions_bank_id_code
  ON public.ib_questions(bank_id, code);

COMMENT ON TABLE public.ib_questions IS 'Past Paper Questions (PPQ) question table';
COMMENT ON COLUMN public.ib_questions.bank_id IS 'Question bank source; existing rows are ppq';

-- New IB-inspired question bank table
CREATE TABLE IF NOT EXISTS public.ib_inspired_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  level TEXT CHECK (level IN ('SL', 'AHL')),
  difficulty INT CHECK (difficulty BETWEEN 1 AND 10),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'published', 'archived')),
  source_note TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  bank_id TEXT NOT NULL DEFAULT 'ib_inspired' REFERENCES public.question_banks(id),
  CONSTRAINT ib_inspired_questions_bank_id_check CHECK (bank_id = 'ib_inspired')
);

ALTER TABLE public.ib_inspired_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Teachers can manage IB inspired questions" ON public.ib_inspired_questions;
CREATE POLICY "Teachers can manage IB inspired questions"
  ON public.ib_inspired_questions FOR ALL
  USING (public.get_my_role() = 'teacher')
  WITH CHECK (public.get_my_role() = 'teacher');

DROP POLICY IF EXISTS "Students can view published IB inspired questions" ON public.ib_inspired_questions;
CREATE POLICY "Students can view published IB inspired questions"
  ON public.ib_inspired_questions FOR SELECT
  USING (status = 'published');

CREATE TABLE IF NOT EXISTS public.ib_inspired_question_parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES public.ib_inspired_questions(id) ON DELETE CASCADE,
  part_label TEXT NOT NULL DEFAULT '',
  marks INT NOT NULL DEFAULT 1,
  subtopic_codes TEXT[] NOT NULL DEFAULT '{}',
  command_terms TEXT[] NOT NULL DEFAULT '{}',
  content_text TEXT,
  markscheme_text TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (question_id, part_label)
);

ALTER TABLE public.ib_inspired_question_parts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Teachers can manage IB inspired question parts" ON public.ib_inspired_question_parts;
CREATE POLICY "Teachers can manage IB inspired question parts"
  ON public.ib_inspired_question_parts FOR ALL
  USING (public.get_my_role() = 'teacher')
  WITH CHECK (public.get_my_role() = 'teacher');

DROP POLICY IF EXISTS "Students can view IB inspired question parts" ON public.ib_inspired_question_parts;
CREATE POLICY "Students can view IB inspired question parts"
  ON public.ib_inspired_question_parts FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.ib_inspired_questions q
      WHERE q.id = ib_inspired_question_parts.question_id
        AND q.status = 'published'
    )
  );

CREATE INDEX IF NOT EXISTS idx_ib_inspired_questions_status
  ON public.ib_inspired_questions(status, code);

CREATE INDEX IF NOT EXISTS idx_ib_inspired_question_parts_subtopics
  ON public.ib_inspired_question_parts USING gin(subtopic_codes);
