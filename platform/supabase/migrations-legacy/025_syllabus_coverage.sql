-- 025: Syllabus coverage per class
-- Tracks which subtopics have been covered for each course/class.

CREATE TABLE IF NOT EXISTS public.syllabus_coverage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  subtopic_code TEXT NOT NULL REFERENCES public.subtopics(code) ON DELETE CASCADE,
  covered BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (course_id, subtopic_code)
);

ALTER TABLE public.syllabus_coverage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers can manage syllabus coverage"
  ON public.syllabus_coverage FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'teacher'
    )
  );

CREATE POLICY "Students can view syllabus coverage"
  ON public.syllabus_coverage FOR SELECT
  USING (true);
