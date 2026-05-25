-- 055: Archive deleted saved exams from Question Bank so they can be reviewed later

CREATE TABLE IF NOT EXISTS public.archived_saved_exams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  original_saved_exam_id UUID,
  archived_by UUID REFERENCES public.profiles(id),
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  exam_name TEXT NOT NULL,
  curriculum TEXT CHECK (curriculum IN ('AA', 'AI')),
  level TEXT CHECK (level IN ('HL', 'SL')),
  paper INT CHECK (paper IN (1, 2, 3)),
  course_id UUID REFERENCES public.courses(id),
  exam_date TEXT,
  exam_time TEXT,
  questions JSONB NOT NULL DEFAULT '[]'::JSONB,
  archived_payload JSONB NOT NULL DEFAULT '{}'::JSONB
);

ALTER TABLE public.archived_saved_exams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Teachers can manage archived saved exams" ON public.archived_saved_exams;
CREATE POLICY "Teachers can manage archived saved exams"
  ON public.archived_saved_exams FOR ALL
  USING (teacher_id = auth.uid())
  WITH CHECK (teacher_id = auth.uid());

CREATE INDEX IF NOT EXISTS archived_saved_exams_teacher_archived_idx
  ON public.archived_saved_exams (teacher_id, archived_at DESC);

CREATE INDEX IF NOT EXISTS archived_saved_exams_original_idx
  ON public.archived_saved_exams (original_saved_exam_id);
