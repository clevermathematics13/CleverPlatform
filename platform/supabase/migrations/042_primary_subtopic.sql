-- Add primary_subtopic_code to question_parts for hierarchical skill tagging.
-- primary_subtopic_code: the single capstone/target skill a part is assessing.
-- The existing subtopic_codes array holds all skills (primary + component prerequisites).
ALTER TABLE public.question_parts
  ADD COLUMN IF NOT EXISTS primary_subtopic_code TEXT;
