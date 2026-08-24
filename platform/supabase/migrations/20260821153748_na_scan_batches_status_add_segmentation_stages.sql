-- The original status vocabulary (uploaded, processing, matched, cropped,
-- failed) predates the segmentation/split stages this pipeline adds.
-- 'segmenting'/'segmented'/'split' are new, distinct lifecycle points
-- between upload and per-page matching -- mapping them onto the existing
-- values (e.g. calling a freshly-split batch "matched") would misrepresent
-- what actually happened at that row, so the vocabulary is extended
-- instead.
alter table public.na_scan_batches drop constraint na_scan_batches_status_check;
alter table public.na_scan_batches add constraint na_scan_batches_status_check
  check (status = any (array[
    'uploaded', 'segmenting', 'segmented', 'split',
    'processing', 'matched', 'cropped', 'failed'
  ]));;
