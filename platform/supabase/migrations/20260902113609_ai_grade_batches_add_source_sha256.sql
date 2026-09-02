-- Content hash of the uploaded batch PDF, so a re-upload of a byte-identical
-- file can reuse the earlier segmentation instead of paying for another
-- whole-document Opus call. Found because the same 90-page BiStats batch
-- was uploaded 14 times (identical file name and page count) and each
-- upload ran segmentation from scratch -- 13 of those calls bought nothing.
-- See POST /api/tests/[id]/ai-grade/batch for the lookup.
alter table public.ai_grade_batches
  add column source_sha256 text;

comment on column public.ai_grade_batches.source_sha256 is
  'SHA-256 hex digest of the uploaded batch PDF bytes. Null for batches created before this column existed. Same test + same digest = same document, so its proposed_segments can be reused.';

create index ai_grade_batches_test_sha256_idx
  on public.ai_grade_batches (test_id, source_sha256);
