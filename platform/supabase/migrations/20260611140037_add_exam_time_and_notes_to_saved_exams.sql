
ALTER TABLE public.saved_exams
  ADD COLUMN IF NOT EXISTS exam_time text,
  ADD COLUMN IF NOT EXISTS notes    text;

COMMENT ON COLUMN public.saved_exams.exam_time IS 'Optional scheduled time for the exam (HH:MM format).';
COMMENT ON COLUMN public.saved_exams.notes     IS 'Auto-set flags, e.g. "no_datetime" when exam is saved without a date or time.';
;
