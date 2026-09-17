-- Records where A.3's print master is kept, matching what A.2 did in
-- 20260909124702. This is the column A.1 leaves null, and HANDOFF.md ss15
-- records what that cost: A.1's Q26(a) backfill had to borrow a student's split
-- scan to stand in for the master, and its three orphan scans could not be
-- backfilled at all. The file is byte-identical to the PDF uploaded as
-- source_materials b368756b-4db9-452b-9270-bb681429faa5 (md5
-- 1b6acc3b6bfdf52c3acdbf603bd4da1d), which is where the anchor geometry in
-- the preceding migration came from. Re-derive from Storage, never from a
-- re-render: the two rendering fixes that landed after 7 Sep 2026 would move
-- the layout, and nothing downstream can tell a well-formed wrong box from a
-- right one.
update na_packet_versions
set master_pdf_storage_path = 'na-masters/997390bb-c0ab-43fe-a123-cfe5f3d80fbe/master.pdf'
where id = '997390bb-c0ab-43fe-a123-cfe5f3d80fbe';