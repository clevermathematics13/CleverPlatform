-- The plain-text question_text already shown in the "why this mark" panel
-- doesn't always match what's actually visible in the answer crop -- some
-- anchor boxes happen to include the printed prompt above the working
-- lines (e.g. A.1 Q1(e)), others start right at the answer (e.g. Q7),
-- with no visual confirmation of what was actually printed on the page.
-- This stores a ONE-TIME rendered crop of the printed question prompt
-- itself, per anchor (not per student -- the printed content is
-- identical for every student, only the handwritten answer varies), so
-- the review UI can show it alongside the plain-text question and the
-- student's own answer crop.
alter table na_anchors
  add column prompt_crop_storage_path text;

comment on column na_anchors.prompt_crop_storage_path is
  'Storage path (exam-scans bucket) of a one-time rendered crop of this anchor''s printed question prompt, as it appears on the page -- distinct from question_text (plain text) and from na_response_crops (the per-student handwritten answer crop). Null until backfilled.';
