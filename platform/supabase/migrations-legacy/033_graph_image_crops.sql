-- 033: Persist cropped graph images and attach optional part / choice-correctness metadata.

-- ============================================
-- 1. Storage bucket for graph crops
-- ============================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('graph-crops', 'graph-crops', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Teachers can manage graph crops" ON storage.objects;
CREATE POLICY "Teachers can manage graph crops"
  ON storage.objects FOR ALL
  USING (
    bucket_id = 'graph-crops'
    AND public.get_my_role() = 'teacher'
  )
  WITH CHECK (
    bucket_id = 'graph-crops'
    AND public.get_my_role() = 'teacher'
  );

DROP POLICY IF EXISTS "Students can read graph crops" ON storage.objects;
CREATE POLICY "Students can read graph crops"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'graph-crops'
    AND public.get_my_role() IN ('student', 'teacher')
  );

-- ============================================
-- 2. Graph crop records
-- ============================================
CREATE TABLE IF NOT EXISTS public.graph_image_crops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES public.ib_questions(id) ON DELETE CASCADE,
  question_image_id UUID NOT NULL REFERENCES public.question_images(id) ON DELETE CASCADE,
  part_id UUID REFERENCES public.question_parts(id) ON DELETE SET NULL,
  storage_path TEXT NOT NULL UNIQUE,
  crop_bbox JSONB,
  graph_spec JSONB,
  graph_meta JSONB,
  extractor TEXT NOT NULL DEFAULT 'manual',
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_graph_image_crops_question ON public.graph_image_crops(question_id);
CREATE INDEX IF NOT EXISTS idx_graph_image_crops_question_image ON public.graph_image_crops(question_image_id);
CREATE INDEX IF NOT EXISTS idx_graph_image_crops_part ON public.graph_image_crops(part_id) WHERE part_id IS NOT NULL;

ALTER TABLE public.graph_image_crops ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Teachers can manage graph crop records" ON public.graph_image_crops;
CREATE POLICY "Teachers can manage graph crop records"
  ON public.graph_image_crops FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'teacher'
  ));

DROP POLICY IF EXISTS "Students can view graph crop records" ON public.graph_image_crops;
CREATE POLICY "Students can view graph crop records"
  ON public.graph_image_crops FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('student', 'teacher')
  ));

-- ============================================
-- 3. Choice-correctness associations for crops
-- ============================================
CREATE TABLE IF NOT EXISTS public.graph_crop_choice_associations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  graph_crop_id UUID NOT NULL REFERENCES public.graph_image_crops(id) ON DELETE CASCADE,
  part_id UUID REFERENCES public.question_parts(id) ON DELETE SET NULL,
  choice_key TEXT NOT NULL,
  is_correct BOOLEAN NOT NULL,
  rationale TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(graph_crop_id, choice_key)
);

CREATE INDEX IF NOT EXISTS idx_graph_crop_choice_associations_crop ON public.graph_crop_choice_associations(graph_crop_id);
CREATE INDEX IF NOT EXISTS idx_graph_crop_choice_associations_part ON public.graph_crop_choice_associations(part_id) WHERE part_id IS NOT NULL;

ALTER TABLE public.graph_crop_choice_associations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Teachers can manage graph crop choice associations" ON public.graph_crop_choice_associations;
CREATE POLICY "Teachers can manage graph crop choice associations"
  ON public.graph_crop_choice_associations FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'teacher'
  ));

DROP POLICY IF EXISTS "Students can view graph crop choice associations" ON public.graph_crop_choice_associations;
CREATE POLICY "Students can view graph crop choice associations"
  ON public.graph_crop_choice_associations FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('student', 'teacher')
  ));
