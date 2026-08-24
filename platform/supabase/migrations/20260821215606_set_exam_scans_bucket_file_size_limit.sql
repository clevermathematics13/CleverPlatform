-- Sets an explicit per-bucket limit on exam-scans now that the project is on
-- Pro (global limit raised in the dashboard, which isn't visible via SQL --
-- storage.buckets.file_size_limit was null before and after that change,
-- since it only reflects an override, not the inherited global value).
--
-- 500MB is generous headroom for a full-class multi-student batch scan PDF
-- at high resolution, without leaving this bucket able to accept literally
-- anything up to whatever the org-wide global limit is set to.
update storage.buckets
set file_size_limit = 524288000  -- 500 MB in bytes
where id = 'exam-scans';;
