-- Records where A.2's print master now lives in Storage. A.1 never kept one
-- (master_pdf_storage_path is null there), which is why its Q26(a) crop
-- backfill had to borrow one student's already-split scan as the crop source
-- and why its 3 orphaned pilot scans could not be backfilled at all. Keeping
-- the master means A.2's anchor geometry can be re-derived, re-audited or
-- re-cropped later from the exact document the students were handed, with no
-- dependency on Drive or on a particular student's upload.
update na_packet_versions
set master_pdf_storage_path = 'na-masters/2f8a4c31-6b7e-4d92-a1f5-8c3e07b9d240/master.pdf'
where id = '2f8a4c31-6b7e-4d92-a1f5-8c3e07b9d240';
