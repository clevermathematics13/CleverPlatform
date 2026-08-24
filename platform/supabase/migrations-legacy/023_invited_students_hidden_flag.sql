-- 023: Add hidden flag to invited_students for soft-hiding

ALTER TABLE public.invited_students ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_invited_students_hidden ON public.invited_students (hidden) WHERE hidden = false;
