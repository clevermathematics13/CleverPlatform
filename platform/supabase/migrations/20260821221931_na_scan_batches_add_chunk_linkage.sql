-- Supports pre-splitting an oversized batch upload (more pages than
-- Anthropic's 100-page PDF document block limit) into several smaller
-- sub-batches, each guaranteed to contain only whole student packets --
-- never a packet torn across two sub-batches.
--
-- The original oversized upload becomes a "parent" row (status will be set
-- to 'chunked', a new terminal status distinct from the existing pipeline
-- stages -- it never itself gets segmented or split, only its children do).
-- Each child row is a normal na_scan_batches row that goes through the
-- existing segment -> confirm -> split flow independently, with
-- parent_batch_id pointing back to the original upload and chunk_index /
-- chunk_count recording its position for the UI to group and order them.
alter table public.na_scan_batches
  add column parent_batch_id uuid references public.na_scan_batches(id) on delete cascade,
  add column chunk_index integer,
  add column chunk_count integer;

comment on column public.na_scan_batches.parent_batch_id is
  'Set on a chunk row produced by pre-splitting an oversized parent upload. Null for a normal (non-chunked) batch, and null on the parent row itself.';
comment on column public.na_scan_batches.chunk_index is
  '1-indexed position of this chunk among its siblings (1..chunk_count), for display ordering. Null unless parent_batch_id is set.';
comment on column public.na_scan_batches.chunk_count is
  'Total number of sibling chunks this batch was split into. Null unless parent_batch_id is set.';

alter table public.na_scan_batches drop constraint na_scan_batches_status_check;
alter table public.na_scan_batches add constraint na_scan_batches_status_check
  check (status = any (array[
    'uploaded', 'presplitting', 'chunked',
    'segmenting', 'segmented', 'split',
    'processing', 'matched', 'cropped', 'failed'
  ]));;
