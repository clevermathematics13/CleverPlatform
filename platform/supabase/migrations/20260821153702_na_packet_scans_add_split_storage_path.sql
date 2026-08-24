-- The split step (stage 2) produces one PDF per student, cut out of the
-- batch scan. Page-identity matching (stage 3) needs to read that split
-- PDF back from storage, so its path must be persisted on the row it
-- belongs to.
alter table public.na_packet_scans
  add column split_storage_path text;

comment on column public.na_packet_scans.split_storage_path is
  'Storage path (na-scans bucket) of this student''s split-out PDF, produced by the batch split step. Read by page-identity matching (stage 3) and crop extraction (stage 4).';;
