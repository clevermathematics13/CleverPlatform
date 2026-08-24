-- 024: Saved exams — persists ExamBuilder state for later recall and editing

CREATE TABLE IF NOT EXISTS public.saved_exams (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id   UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  curriculum   TEXT        NOT NULL CHECK (curriculum IN ('AA', 'AI')),
  level        TEXT        NOT NULL CHECK (level IN ('HL', 'SL')),
  paper        INT         NOT NULL CHECK (paper IN (1, 2, 3)),
  course_id    UUID,
  exam_date    TEXT,
  -- Ordered JSON array of question objects: [{id, code, section, marks, hasQuestion, hasMarkscheme, curriculum}]
  questions    JSONB       NOT NULL DEFAULT '[]'::JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.saved_exams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers manage their own saved exams"
  ON public.saved_exams FOR ALL
  USING (teacher_id = auth.uid())
  WITH CHECK (teacher_id = auth.uid());

CREATE INDEX IF NOT EXISTS saved_exams_teacher_idx ON public.saved_exams (teacher_id, updated_at DESC);
