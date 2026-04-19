-- 012: Add hidden flag to students for soft-hiding (e.g. transfers)

ALTER TABLE public.students ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT false;

-- Index for filtering
CREATE INDEX IF NOT EXISTS idx_students_hidden ON public.students (hidden) WHERE hidden = false;
