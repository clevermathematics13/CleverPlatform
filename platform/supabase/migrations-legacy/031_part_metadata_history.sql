-- 031: Track question part metadata history for server-side revert

CREATE TABLE IF NOT EXISTS public.question_part_metadata_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id UUID NOT NULL REFERENCES public.question_parts(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.ib_questions(id) ON DELETE CASCADE,
  part_label TEXT NOT NULL DEFAULT '',
  marks INT NOT NULL DEFAULT 1,
  command_term TEXT,
  subtopic_codes TEXT[] NOT NULL DEFAULT '{}',
  sort_order INT NOT NULL DEFAULT 0,
  changed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qpmh_part_id_created_at
  ON public.question_part_metadata_history(part_id, created_at DESC);

ALTER TABLE public.question_part_metadata_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Teachers can manage part metadata history" ON public.question_part_metadata_history;
CREATE POLICY "Teachers can manage part metadata history"
  ON public.question_part_metadata_history
  FOR ALL
  USING (public.get_my_role() = 'teacher')
  WITH CHECK (public.get_my_role() = 'teacher');
