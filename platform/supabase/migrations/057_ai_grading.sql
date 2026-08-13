-- 057: AI-assisted grading of scanned student work against the PPQ mark scheme.
-- Suggestions land in a review table. Nothing reaches student_marks without
-- explicit teacher acceptance, preserving the mark_changes audit trail and
-- the disagreement-scoring logic.

CREATE TABLE IF NOT EXISTS public.ai_grade_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID NOT NULL REFERENCES public.tests(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'complete', 'failed')),
  model TEXT,
  source_storage_path TEXT,
  coverage JSONB NOT NULL DEFAULT '{}'::JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.ai_grade_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.ai_grade_runs(id) ON DELETE CASCADE,
  test_item_id UUID NOT NULL REFERENCES public.test_items(id) ON DELETE CASCADE,
  suggested_marks INT NOT NULL CHECK (suggested_marks >= 0),
  max_marks INT NOT NULL CHECK (max_marks >= 0),
  confidence TEXT NOT NULL DEFAULT 'low'
    CHECK (confidence IN ('high', 'medium', 'low')),
  markscheme_source TEXT NOT NULL DEFAULT 'none'
    CHECK (markscheme_source IN ('part_latex', 'part_text', 'whole_question', 'draft', 'none')),
  work_found BOOLEAN NOT NULL DEFAULT true,
  reasoning TEXT,
  evidence TEXT,
  mark_breakdown JSONB NOT NULL DEFAULT '[]'::JSONB,
  accepted BOOLEAN NOT NULL DEFAULT false,
  accepted_at TIMESTAMPTZ,
  accepted_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, test_item_id)
);

ALTER TABLE public.ai_grade_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_grade_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Teachers manage AI grade runs" ON public.ai_grade_runs;
CREATE POLICY "Teachers manage AI grade runs"
  ON public.ai_grade_runs FOR ALL
  USING (public.get_my_role() = 'teacher')
  WITH CHECK (public.get_my_role() = 'teacher');

DROP POLICY IF EXISTS "Teachers manage AI grade results" ON public.ai_grade_results;
CREATE POLICY "Teachers manage AI grade results"
  ON public.ai_grade_results FOR ALL
  USING (public.get_my_role() = 'teacher')
  WITH CHECK (public.get_my_role() = 'teacher');

CREATE INDEX IF NOT EXISTS ai_grade_runs_test_student_idx
  ON public.ai_grade_runs (test_id, student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_grade_results_run_idx
  ON public.ai_grade_results (run_id);

CREATE INDEX IF NOT EXISTS ai_grade_results_item_idx
  ON public.ai_grade_results (test_item_id);
