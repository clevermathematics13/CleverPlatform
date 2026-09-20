-- A teacher's marking notes on one part of one paper, read by the AI marker.
--
-- Every disagreement between a teacher and the marker so far has clustered by
-- PART, not by student: a mark scheme read two ways (Formative Assessment 1
-- Q8(a), Key Assessment 1 Q13(b)). The teacher's ruling was written into
-- mark_changes.reason and never reached the marker, so every later student
-- on the same part was marked the old way and flagged again. This column is
-- where that ruling lives: lib/ai-grading.ts (assembleMarkScheme) carries it
-- on the grading unit and buildUnitBlock prints it after the part's mark
-- scheme, on every path that marks the paper (interactive, overnight,
-- regrade, eval).
--
-- On test_items, not on the shared IB bank scheme: a ruling is about this
-- paper's wording and this class's answers. Nullable; nothing changes for a
-- part without one.

alter table public.test_items add column if not exists marking_notes text;

comment on column public.test_items.marking_notes is
  'Teacher rulings for marking this part, read by the AI marker after the mark scheme (lib/ai-grading.ts buildUnitBlock). Null when there are none.';
