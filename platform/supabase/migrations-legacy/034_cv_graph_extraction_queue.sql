-- 034: Batch CV extraction review queue for graph detection/extraction runs.

CREATE TABLE IF NOT EXISTS public.graph_extraction_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_image_id UUID NOT NULL UNIQUE REFERENCES public.question_images(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.ib_questions(id) ON DELETE CASCADE,
  part_id UUID REFERENCES public.question_parts(id) ON DELETE SET NULL,
  image_type TEXT NOT NULL CHECK (image_type IN ('question', 'markscheme')),
  storage_path TEXT NOT NULL,

  status TEXT NOT NULL CHECK (status IN ('pending_review', 'auto_accepted', 'processing_error')),
  confidence_level TEXT,
  manual_review_required BOOLEAN NOT NULL DEFAULT true,

  extractor TEXT NOT NULL DEFAULT 'cv_batch_v1',
  graph_spec JSONB,
  graph_meta JSONB,
  metadata JSONB,
  warnings JSONB,
  feedback JSONB,
  error TEXT,

  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  review_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_graph_extraction_queue_status
  ON public.graph_extraction_queue(status);
CREATE INDEX IF NOT EXISTS idx_graph_extraction_queue_question
  ON public.graph_extraction_queue(question_id);
CREATE INDEX IF NOT EXISTS idx_graph_extraction_queue_part
  ON public.graph_extraction_queue(part_id) WHERE part_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_graph_extraction_queue_attempted_at
  ON public.graph_extraction_queue(attempted_at DESC);

ALTER TABLE public.graph_extraction_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Teachers can manage graph extraction queue" ON public.graph_extraction_queue;
CREATE POLICY "Teachers can manage graph extraction queue"
  ON public.graph_extraction_queue FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'teacher'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'teacher'
  ));

DROP POLICY IF EXISTS "Students can view graph extraction queue" ON public.graph_extraction_queue;
CREATE POLICY "Students can view graph extraction queue"
  ON public.graph_extraction_queue FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('student', 'teacher')
  ));
