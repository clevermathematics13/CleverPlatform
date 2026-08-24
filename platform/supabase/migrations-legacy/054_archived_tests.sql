-- 054: Archive deleted tests so teachers can access removed exams from settings

CREATE TABLE IF NOT EXISTS public.archived_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  original_test_id UUID,
  deleted_by UUID REFERENCES public.profiles(id),
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  test_name TEXT NOT NULL,
  course_id UUID REFERENCES public.courses(id),
  test_date DATE,
  exam_time TIME,
  release_at TIMESTAMPTZ,
  total_marks INT,
  hidden BOOLEAN NOT NULL DEFAULT false,
  paper_url TEXT,
  mark_scheme_url TEXT,
  archived_payload JSONB NOT NULL DEFAULT '{}'::JSONB
);

ALTER TABLE public.archived_tests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Teachers can manage archived tests" ON public.archived_tests;
CREATE POLICY "Teachers can manage archived tests"
  ON public.archived_tests FOR ALL
  USING (teacher_id = auth.uid())
  WITH CHECK (teacher_id = auth.uid());

CREATE INDEX IF NOT EXISTS archived_tests_teacher_deleted_idx
  ON public.archived_tests (teacher_id, deleted_at DESC);

CREATE INDEX IF NOT EXISTS archived_tests_original_test_idx
  ON public.archived_tests (original_test_id);
