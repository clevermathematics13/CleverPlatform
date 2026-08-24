-- 011: Audit log for teacher mark adjustments in the reflection dashboard

CREATE TABLE IF NOT EXISTS public.mark_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_item_id UUID NOT NULL REFERENCES public.test_items(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  changed_by UUID NOT NULL REFERENCES public.profiles(id),
  old_marks INT,
  new_marks INT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.mark_changes ENABLE ROW LEVEL SECURITY;

-- Teachers can view and insert
CREATE POLICY "Teachers can manage mark changes"
  ON public.mark_changes FOR ALL
  USING (public.get_my_role() = 'teacher');

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_mark_changes_student_item
  ON public.mark_changes (student_id, test_item_id);
