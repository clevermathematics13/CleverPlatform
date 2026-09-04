-- Pages the segmentation model confidently identified as blank (no
-- handwriting or content) get tracked separately from unassigned_pages, so
-- the batch review UI can skip the "needs your review" warning for a page
-- that was never going to have work on it (e.g. a fixed-length printed
-- booklet's unused last page) while still flagging genuinely ambiguous ones.
alter table ai_grade_batches
  add column blank_pages jsonb not null default '[]'::jsonb;

comment on column ai_grade_batches.blank_pages is 'Page numbers (1-indexed) the segmentation model confidently identified as blank -- distinct from unassigned_pages, which is for pages that need a teacher''s judgement.';
