-- 'split' is the state right after the batch split step creates this row
-- (the student's own PDF exists in storage) but before page-identity
-- matching or cropping has run. Distinct from 'pending', which the pilot
-- ingestion route used for a row with no split PDF at all yet.
alter table public.na_packet_scans drop constraint na_packet_scans_status_check;
alter table public.na_packet_scans add constraint na_packet_scans_status_check
  check (status = any (array['pending', 'split', 'cropped', 'assessed', 'reviewed', 'released']));;
