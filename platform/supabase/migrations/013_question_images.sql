-- 013: Separate image storage for question content extracted from Google Docs
--
-- Images (and sometimes text) are extracted from Google Docs and stored
-- individually. Multiple images from a single Doc are grouped by question.
-- The google_doc_id / google_ms_id columns on ib_questions remain as backup.

-- ============================================
-- 1. Storage bucket for question images
-- ============================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('question-images', 'question-images', false)
ON CONFLICT (id) DO NOTHING;

-- Teachers can upload/manage images
CREATE POLICY "Teachers can manage question images"
  ON storage.objects FOR ALL
  USING (
    bucket_id = 'question-images'
    AND public.get_my_role() = 'teacher'
  )
  WITH CHECK (
    bucket_id = 'question-images'
    AND public.get_my_role() = 'teacher'
  );

-- Students can read question images
CREATE POLICY "Students can read question images"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'question-images'
    AND public.get_my_role() IN ('student', 'teacher')
  );

-- ============================================
-- 2. Question images table
-- ============================================
CREATE TABLE IF NOT EXISTS public.question_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES public.ib_questions(id) ON DELETE CASCADE,
  part_id UUID REFERENCES public.question_parts(id) ON DELETE SET NULL,
  image_type TEXT NOT NULL CHECK (image_type IN ('question', 'markscheme')),
  storage_path TEXT NOT NULL,            -- path within question-images bucket
  source_google_doc_id TEXT,             -- Google Doc this image was extracted from (backup ref)
  sort_order INT NOT NULL DEFAULT 0,     -- display order within the question/part
  alt_text TEXT,                         -- description of the image content
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique constraint for upsert (one image per question+type+order position)
ALTER TABLE public.question_images
  ADD CONSTRAINT uq_question_images_type_order UNIQUE (question_id, image_type, sort_order);

CREATE INDEX idx_question_images_question ON public.question_images(question_id);
CREATE INDEX idx_question_images_part ON public.question_images(part_id) WHERE part_id IS NOT NULL;
CREATE INDEX idx_question_images_type ON public.question_images(question_id, image_type);

ALTER TABLE public.question_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers can manage question image records"
  ON public.question_images FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'teacher'
  ));

CREATE POLICY "Students can view question image records"
  ON public.question_images FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('student', 'teacher')
  ));
