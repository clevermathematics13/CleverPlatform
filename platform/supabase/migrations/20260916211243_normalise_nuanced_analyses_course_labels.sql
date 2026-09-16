-- Collapse the free-text course label on nuanced_analyses to one spelling per
-- course. The generator wrote the same course several ways, and the Manage
-- Saved Packets filter grouped on the raw string, so its menu listed four
-- courses for two. lib/na-course-label.ts now canonicalises the label on
-- every write; this brings the existing rows in line with it.
--
-- Before (2026-09-16), nine rows:
--   "Grade 9 Extended Mathematics"                  x2  ->  "Grade 9 Mathematics (Extended)"
--   "Grade 9 Mathematics (Extended)"                x4  (already canonical)
--   "IBDP Mathematics AA HL"                        x2  ->  "IBDP Mathematics: Analysis & Approaches HL"
--   "IBDP Mathematics: Analysis & Approaches HL"    x1  (already canonical)
--
-- draft_content.course is the same label as the editor loads it, so it is
-- rewritten in step, or the preview would still show the old spelling.

update public.nuanced_analyses
set course = 'Grade 9 Mathematics (Extended)',
    draft_content = case
      when draft_content is null then null
      else jsonb_set(draft_content, '{course}', to_jsonb('Grade 9 Mathematics (Extended)'::text))
    end
where course = 'Grade 9 Extended Mathematics';

update public.nuanced_analyses
set course = 'IBDP Mathematics: Analysis & Approaches HL',
    draft_content = case
      when draft_content is null then null
      else jsonb_set(draft_content, '{course}', to_jsonb('IBDP Mathematics: Analysis & Approaches HL'::text))
    end
where course = 'IBDP Mathematics AA HL';
