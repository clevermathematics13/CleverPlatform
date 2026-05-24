-- 052: Add auto_graded flag to student_marks
--
-- Allows the gradebook to distinguish auto-generated marks (from the MSA
-- Grader GAS pipeline) from manually entered marks, so teachers can review
-- and override auto-graded values.

ALTER TABLE public.student_marks
  ADD COLUMN IF NOT EXISTS auto_graded boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.student_marks.auto_graded IS
  'true when the mark was written by the MSA Grader pipeline; false when entered manually by a teacher.';
