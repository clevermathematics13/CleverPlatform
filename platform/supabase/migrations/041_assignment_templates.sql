-- Create assignment_templates table for storing reusable formatting/input presets
CREATE TABLE public.assignment_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  template_name TEXT NOT NULL,
  grade_level TEXT NOT NULL CHECK (grade_level IN ('Grade 9', 'Grade 10', 'Grade 11', 'Grade 12')),
  document_kind TEXT NOT NULL,
  formatting_requirements JSONB NOT NULL,
  assignment_input JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for efficient lookup by user and grade
CREATE INDEX idx_assignment_templates_user_grade
  ON public.assignment_templates(user_id, grade_level);

-- Create index for efficient lookup by template name
CREATE INDEX idx_assignment_templates_name
  ON public.assignment_templates(user_id, template_name);

-- Enable RLS
ALTER TABLE public.assignment_templates ENABLE ROW LEVEL SECURITY;

-- Only teachers can insert/read/update/delete their own templates
CREATE POLICY "Teachers can manage their own templates"
  ON public.assignment_templates
  FOR ALL
  USING (
    (auth.uid() = user_id)
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'teacher'
    )
  )
  WITH CHECK (
    (auth.uid() = user_id)
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'teacher'
    )
  );
