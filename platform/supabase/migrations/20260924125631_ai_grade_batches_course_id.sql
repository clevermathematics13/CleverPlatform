-- The class whose scripts a batch scan holds, when it was uploaded as one
-- class's pile. Its cover pages are then matched against that class's
-- students only (app/api/tests/[id]/ai-grade/batch/route.ts): a Grade 9 paper
-- is sat by every class in its track, and matching 9C's pile against all of
-- them sent 9C's only Santiago to 9A's on 15 Sep 2026. Null for a pile of
-- mixed classes, and for every batch uploaded before this column existed.
alter table public.ai_grade_batches
  add column course_id uuid references public.courses(id) on delete set null;

comment on column public.ai_grade_batches.course_id is
  'The class the scan was uploaded as; its cover pages were matched against that class only. Null: a mixed-classes pile, or uploaded before 24 Sep 2026.';