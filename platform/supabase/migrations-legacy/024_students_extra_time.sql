-- 024: Add extra_time field to students for accommodations
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS extra_time INTEGER CHECK (extra_time IN (0, 25, 50)) NOT NULL DEFAULT 0;
-- 0 = no extra time, 25 = 25% extra, 50 = 50% extra
