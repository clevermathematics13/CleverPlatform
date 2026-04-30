-- 026: Named seating chart layouts
CREATE TABLE IF NOT EXISTS public.seating_layouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_group TEXT NOT NULL,
  name TEXT NOT NULL,
  seats JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (class_group, name)
);

ALTER TABLE public.seating_layouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers manage seating layouts"
  ON public.seating_layouts FOR ALL
  USING (public.get_my_role() = 'teacher')
  WITH CHECK (public.get_my_role() = 'teacher');

CREATE POLICY "Students read seating layouts"
  ON public.seating_layouts FOR SELECT
  USING (auth.role() = 'authenticated');
