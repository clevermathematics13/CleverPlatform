-- How a batch's proposed_segments were produced.
--   'deep'  = the whole PDF was read by the segmentation model (Opus), the
--             original behaviour and the only one before this column existed,
--             hence the default for every pre-existing row.
--   'quick' = every page was checked individually with the Haiku cover-page
--             check (lib/cover-page-segmentation.ts), ~4x cheaper.
--
-- Read by the source_sha256 dedupe in
-- app/api/tests/[id]/ai-grade/batch/route.ts. The reuse rule is deliberately
-- ASYMMETRIC: a quick request may reuse a prior 'quick' or 'deep' proposal (a
-- deep read finds everything a quick read does and more, so it is never a
-- downgrade), but a deep request reuses only 'deep'. That direction matters
-- because asking for a deep read is exactly the teacher's "the quick read got
-- a loose sheet wrong, read it properly" retry, and serving them the quick
-- proposal back would silently ignore it.
alter table public.ai_grade_batches
  add column read_mode text not null default 'deep'
    check (read_mode in ('quick', 'deep'));

comment on column public.ai_grade_batches.read_mode is
  'quick = per-page Haiku cover check; deep = whole-document segmentation model. A quick request may reuse a deep proposal, never the reverse.';