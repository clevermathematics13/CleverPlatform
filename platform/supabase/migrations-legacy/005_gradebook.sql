-- 005: Gradebook — tests, test items, and student marks

-- ============================================
-- 1. TESTS (an exam / assessment)
-- ============================================
CREATE TABLE IF NOT EXISTS public.tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES public.profiles(id),
  course_id UUID REFERENCES public.courses(id),
  name TEXT NOT NULL,               -- e.g. "27AH [P01] P1"
  test_date DATE,
  total_marks INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Teachers can manage tests" ON public.tests;
CREATE POLICY "Teachers can manage tests" ON public.tests FOR ALL
  USING (teacher_id = auth.uid());
DROP POLICY IF EXISTS "Students can view their tests" ON public.tests;
CREATE POLICY "Students can view their tests" ON public.tests FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.students s WHERE s.profile_id = auth.uid() AND s.course_id = tests.course_id
  ));

-- ============================================
-- 2. TEST ITEMS (each scoreable question/part on a test)
-- ============================================
CREATE TABLE IF NOT EXISTS public.test_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID NOT NULL REFERENCES public.tests(id) ON DELETE CASCADE,
  question_number INT NOT NULL,       -- position on test (0-based from your sheet)
  ib_question_code TEXT NOT NULL,     -- e.g. "EXM.1.SL.TZ0.1"
  part_label TEXT NOT NULL DEFAULT '', -- e.g. '', 'a', 'b'
  max_marks INT NOT NULL,
  subtopic_codes TEXT[] DEFAULT '{}',
  google_doc_id TEXT,                 -- Google Slides question ID
  google_ms_id TEXT,                  -- Google Slides markscheme ID
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(test_id, question_number, part_label)
);

ALTER TABLE public.test_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Teachers can manage test items" ON public.test_items;
CREATE POLICY "Teachers can manage test items" ON public.test_items FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.tests t WHERE t.id = test_items.test_id AND t.teacher_id = auth.uid()
  ));
DROP POLICY IF EXISTS "Students can view test items" ON public.test_items;
CREATE POLICY "Students can view test items" ON public.test_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.tests t
    JOIN public.students s ON s.course_id = t.course_id
    WHERE t.id = test_items.test_id AND s.profile_id = auth.uid()
  ));

-- ============================================
-- 3. STUDENT MARKS (marks awarded per student per test item)
-- ============================================
CREATE TABLE IF NOT EXISTS public.student_marks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_item_id UUID NOT NULL REFERENCES public.test_items(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id),
  marks_awarded INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(test_item_id, student_id)
);

ALTER TABLE public.student_marks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Teachers can manage student marks" ON public.student_marks;
CREATE POLICY "Teachers can manage student marks" ON public.student_marks FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.test_items ti
    JOIN public.tests t ON t.id = ti.test_id
    WHERE ti.id = student_marks.test_item_id AND t.teacher_id = auth.uid()
  ));
DROP POLICY IF EXISTS "Students can view own marks" ON public.student_marks;
CREATE POLICY "Students can view own marks" ON public.student_marks FOR SELECT
  USING (student_id = auth.uid());

-- ============================================
-- Useful views
-- ============================================

-- Test summary: total marks per student per test
CREATE OR REPLACE VIEW public.test_scores AS
SELECT
  sm.student_id,
  t.id AS test_id,
  t.name AS test_name,
  t.test_date,
  t.total_marks AS max_total,
  SUM(sm.marks_awarded) AS marks_earned,
  ROUND(100.0 * SUM(sm.marks_awarded) / NULLIF(t.total_marks, 0), 1) AS percentage
FROM public.student_marks sm
JOIN public.test_items ti ON ti.id = sm.test_item_id
JOIN public.tests t ON t.id = ti.test_id
GROUP BY sm.student_id, t.id, t.name, t.test_date, t.total_marks;
