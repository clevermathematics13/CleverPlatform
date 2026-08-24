-- 010: CleverReflection portal — self-scores, PDF uploads, override tokens, debug log

-- ============================================
-- 1. STUDENT SELF-SCORES (student's self-assessment per test item)
-- ============================================
CREATE TABLE IF NOT EXISTS public.student_self_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_item_id UUID NOT NULL REFERENCES public.test_items(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  self_marks INT NOT NULL DEFAULT 0,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  override_by UUID REFERENCES public.profiles(id),
  override_at TIMESTAMPTZ,
  UNIQUE(test_item_id, student_id)
);

ALTER TABLE public.student_self_scores ENABLE ROW LEVEL SECURITY;

-- Students can insert/update their own self-scores
CREATE POLICY "Students can manage own self-scores"
  ON public.student_self_scores FOR ALL
  USING (student_id = auth.uid())
  WITH CHECK (student_id = auth.uid());

-- Teachers can view all self-scores
CREATE POLICY "Teachers can view all self-scores"
  ON public.student_self_scores FOR SELECT
  USING (public.get_my_role() = 'teacher');

-- Teachers can update self-scores (for overrides)
CREATE POLICY "Teachers can update self-scores"
  ON public.student_self_scores FOR UPDATE
  USING (public.get_my_role() = 'teacher');

-- Teachers can insert self-scores (for overrides on missing rows)
CREATE POLICY "Teachers can insert self-scores"
  ON public.student_self_scores FOR INSERT
  WITH CHECK (public.get_my_role() = 'teacher');

-- ============================================
-- 2. PDF UPLOADS (tracking corrections uploads)
-- ============================================
CREATE TABLE IF NOT EXISTS public.pdf_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  test_id UUID NOT NULL REFERENCES public.tests(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(student_id, test_id)
);

ALTER TABLE public.pdf_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students can manage own uploads"
  ON public.pdf_uploads FOR ALL
  USING (student_id = auth.uid())
  WITH CHECK (student_id = auth.uid());

CREATE POLICY "Teachers can view all uploads"
  ON public.pdf_uploads FOR SELECT
  USING (public.get_my_role() = 'teacher');

-- ============================================
-- 3. OVERRIDE TOKENS (one-time tokens for teacher overrides)
-- ============================================
CREATE TABLE IF NOT EXISTS public.override_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  teacher_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  test_id UUID NOT NULL REFERENCES public.tests(id) ON DELETE CASCADE,
  used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '5 minutes')
);

ALTER TABLE public.override_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers can manage override tokens"
  ON public.override_tokens FOR ALL
  USING (teacher_id = auth.uid());

-- ============================================
-- 4. DEBUG LOG
-- ============================================
CREATE TABLE IF NOT EXISTS public.debug_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id),
  action TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.debug_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers can view debug log"
  ON public.debug_log FOR SELECT
  USING (public.get_my_role() = 'teacher');

CREATE POLICY "Anyone can insert debug log"
  ON public.debug_log FOR INSERT
  WITH CHECK (true);

-- ============================================
-- 5. CORRECTIONS STORAGE BUCKET
-- ============================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('corrections', 'corrections', false)
ON CONFLICT (id) DO NOTHING;

-- Students can upload to their own folder
CREATE POLICY "Students can upload corrections"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'corrections'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Students can read their own corrections
CREATE POLICY "Students can read own corrections"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'corrections'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Teachers can read all corrections
CREATE POLICY "Teachers can read all corrections"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'corrections'
    AND public.get_my_role() = 'teacher'
  );
