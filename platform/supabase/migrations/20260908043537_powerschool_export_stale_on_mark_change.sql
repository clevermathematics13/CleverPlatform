-- ---------------------------------------------------------------------------
-- Marking an export stale when the marks behind it change
-- ---------------------------------------------------------------------------
-- The file is regenerated when a student finishes a self-assessment. Teacher
-- marks move independently of that, so between the two the stored file can
-- disagree with the gradebook.
--
-- Rebuilding on every mark write is not an option: the gradebook saves one
-- cell at a time, and a 41-question paper for 20 students is 820 writes. So a
-- write does the cheap thing -- set this flag -- and the rebuild happens when
-- it is worth doing: a few seconds after the teacher stops typing, and, as a
-- backstop, before the file is served. A download can then never hand back a
-- file that is known to be out of date, whichever path wrote the marks.
--
-- Set by the service role from lib/self-assessment-export.ts, cleared by the
-- regeneration that follows.

ALTER TABLE powerschool_export_files
  ADD COLUMN stale boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN powerschool_export_files.stale IS
  'True when marks changed after this file was written. Cleared by the next regeneration; the teacher download regenerates first rather than serve a file known to be out of date.';
