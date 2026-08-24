-- ============================================
-- 021. Auto-register all invited students
-- ============================================
-- Students imported via Google Classroom or added manually
-- should be considered registered immediately — no login required
-- for now. This marks all existing pending students as registered.
-- ============================================

UPDATE public.invited_students
SET registered = true
WHERE registered = false;
