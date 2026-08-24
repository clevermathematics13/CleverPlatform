-- CleverPlatform Database Schema
-- Run this in Supabase SQL Editor to set up all tables

-- ============================================
-- 1. PROFILES (extends Supabase auth.users)
-- ============================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  role TEXT NOT NULL CHECK (role IN ('teacher', 'student', 'parent')) DEFAULT 'student',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Helper function to get current user's role without recursion
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

-- Users can view own profile, teachers see all
CREATE POLICY "Users can view own profile or teachers see all"
  ON public.profiles FOR SELECT
  USING (
    auth.uid() = id
    OR public.get_my_role() = 'teacher'
  );

-- Users can update their own profile (display name, avatar)
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Allow insert during registration (auth callback)
CREATE POLICY "Allow insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- ============================================
-- 2. COURSES
-- ============================================
CREATE TABLE public.courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Everyone can view courses"
  ON public.courses FOR SELECT
  USING (true);

CREATE POLICY "Teachers can manage courses"
  ON public.courses FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'teacher'
    )
  );

-- Seed default courses
INSERT INTO public.courses (name, description) VALUES
  ('IBDP AAHL', 'IB Diploma Programme Analysis and Approaches Higher Level'),
  ('IBDP AIHL', 'IB Diploma Programme Applications and Interpretation Higher Level');

-- ============================================
-- 3. STUDENTS
-- ============================================
CREATE TABLE public.students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(profile_id, course_id)
);

ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers can view all students"
  ON public.students FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'teacher'
    )
  );

CREATE POLICY "Students can view own enrollment"
  ON public.students FOR SELECT
  USING (profile_id = auth.uid());

CREATE POLICY "Teachers can manage students"
  ON public.students FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'teacher'
    )
  );

-- ============================================
-- 4. REGISTRATION CODES (for parent access)
-- ============================================
CREATE TABLE public.registration_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  used BOOLEAN NOT NULL DEFAULT false,
  used_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ
);

ALTER TABLE public.registration_codes ENABLE ROW LEVEL SECURITY;

-- Teachers can manage registration codes
CREATE POLICY "Teachers can manage registration codes"
  ON public.registration_codes FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'teacher'
    )
  );

-- Anyone can read codes (needed for registration validation)
-- But only unused codes are useful, and the code itself is the secret
CREATE POLICY "Anyone can validate codes"
  ON public.registration_codes FOR SELECT
  USING (true);

-- Allow update when registering (mark as used)
CREATE POLICY "Allow marking codes as used"
  ON public.registration_codes FOR UPDATE
  USING (true)
  WITH CHECK (used = true);

-- ============================================
-- 5. PARENT LINKS
-- ============================================
CREATE TABLE public.parent_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(parent_profile_id, student_id)
);

ALTER TABLE public.parent_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers can manage parent links"
  ON public.parent_links FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'teacher'
    )
  );

CREATE POLICY "Parents can view own links"
  ON public.parent_links FOR SELECT
  USING (parent_profile_id = auth.uid());

CREATE POLICY "Allow insert parent link during registration"
  ON public.parent_links FOR INSERT
  WITH CHECK (parent_profile_id = auth.uid());

-- ============================================
-- 6. TOPICS
-- ============================================
CREATE TABLE public.topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.topics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Everyone can view topics"
  ON public.topics FOR SELECT
  USING (true);

CREATE POLICY "Teachers can manage topics"
  ON public.topics FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'teacher'
    )
  );

-- ============================================
-- 7. LESSONS
-- ============================================
CREATE TABLE public.lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID NOT NULL REFERENCES public.topics(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  mdx_content_path TEXT, -- path to MDX file in the repo
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Everyone can view lessons"
  ON public.lessons FOR SELECT
  USING (true);

CREATE POLICY "Teachers can manage lessons"
  ON public.lessons FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'teacher'
    )
  );

-- ============================================
-- 8. QUESTIONS (question bank)
-- ============================================
CREATE TABLE public.questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID REFERENCES public.topics(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('multiple_choice', 'short_answer', 'long_answer', 'file_upload')) DEFAULT 'short_answer',
  content JSONB NOT NULL, -- { question, options?, images?, hints? }
  solution JSONB, -- { answer, working, mark_scheme }
  marks INT NOT NULL DEFAULT 1,
  source TEXT, -- e.g. "2023 May P1 Q3" for past papers
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers can manage questions"
  ON public.questions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'teacher'
    )
  );

CREATE POLICY "Students can view assigned questions"
  ON public.questions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('student', 'teacher')
    )
  );

-- ============================================
-- 9. ASSIGNMENTS
-- ============================================
CREATE TABLE public.assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  course_id UUID REFERENCES public.courses(id) ON DELETE SET NULL,
  question_ids UUID[] NOT NULL DEFAULT '{}',
  assigned_to UUID[] NOT NULL DEFAULT '{}', -- student profile IDs
  due_date TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'closed')) DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers can manage assignments"
  ON public.assignments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'teacher'
    )
  );

CREATE POLICY "Students can view their assignments"
  ON public.assignments FOR SELECT
  USING (auth.uid() = ANY(assigned_to));

-- ============================================
-- 10. SUBMISSIONS
-- ============================================
CREATE TABLE public.submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  answers JSONB, -- student's answers
  file_urls TEXT[] DEFAULT '{}',
  ai_grade JSONB, -- { score, max_score, feedback, per_question: [...] }
  human_grade JSONB, -- teacher override
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'submitted', 'graded')) DEFAULT 'in_progress',
  submitted_at TIMESTAMPTZ,
  graded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers can view all submissions"
  ON public.submissions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'teacher'
    )
  );

CREATE POLICY "Students can manage own submissions"
  ON public.submissions FOR ALL
  USING (student_id = auth.uid());

-- ============================================
-- 11. GRADES (aggregated scores)
-- ============================================
CREATE TABLE public.grades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assessment_type TEXT NOT NULL, -- 'assignment', 'exam', 'pre-assessment', 'self-assessment'
  assessment_id UUID, -- references assignment/exam id
  title TEXT NOT NULL,
  score NUMERIC NOT NULL,
  max_score NUMERIC NOT NULL,
  percentage NUMERIC GENERATED ALWAYS AS (ROUND(score / NULLIF(max_score, 0) * 100, 1)) STORED,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.grades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers can manage all grades"
  ON public.grades FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'teacher'
    )
  );

CREATE POLICY "Students can view own grades"
  ON public.grades FOR SELECT
  USING (student_id = auth.uid());

CREATE POLICY "Parents can view linked student grades"
  ON public.grades FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.parent_links pl
      WHERE pl.parent_profile_id = auth.uid()
        AND pl.student_id IN (
          SELECT s.id FROM public.students s
          WHERE s.profile_id = public.grades.student_id
        )
    )
  );

-- ============================================
-- 12. STUDENT GOALS
-- ============================================
CREATE TABLE public.student_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  goal_text TEXT NOT NULL,
  target_date DATE,
  status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'abandoned')) DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.student_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers can manage all goals"
  ON public.student_goals FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'teacher'
    )
  );

CREATE POLICY "Students can manage own goals"
  ON public.student_goals FOR ALL
  USING (student_id = auth.uid());

CREATE POLICY "Parents can view linked student goals"
  ON public.student_goals FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.parent_links pl
      WHERE pl.parent_profile_id = auth.uid()
        AND pl.student_id IN (
          SELECT s.id FROM public.students s
          WHERE s.profile_id = public.student_goals.student_id
        )
    )
  );

-- ============================================
-- HELPER: Auto-update updated_at on profiles
-- ============================================
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_profile_updated
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- ============================================
-- STORAGE: File uploads bucket
-- ============================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('uploads', 'uploads', false);

-- Teachers can upload anything
CREATE POLICY "Teachers can upload files"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'uploads' AND
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'teacher'
    )
  );

-- Students can upload to their own folder
CREATE POLICY "Students can upload own files"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'uploads' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

-- Teachers can view all uploads
CREATE POLICY "Teachers can view all uploads"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'uploads' AND
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'teacher'
    )
  );

-- Students can view their own uploads
CREATE POLICY "Students can view own uploads"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'uploads' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );
