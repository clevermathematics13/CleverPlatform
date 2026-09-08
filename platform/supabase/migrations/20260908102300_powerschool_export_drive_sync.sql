-- ---------------------------------------------------------------------------
-- Mirroring each PowerSchool export into the teacher's Google Drive
-- ---------------------------------------------------------------------------
-- Every time the file is rebuilt -- a student finishes a self-assessment, or
-- marks change -- the new content is pushed to a folder in the teacher's Drive
-- as well as to Supabase Storage, so the current file is somewhere they
-- already look without opening the app.
--
-- drive_file_id is the whole point of keeping this rather than searching by
-- name on every sync. Updating the SAME Drive file gives Drive's own revision
-- history: one file that accumulates versions, rather than a folder filling up
-- with 9C_Form1_7.csv, 9C_Form1_8.csv, 9C_Form1_9.csv. The file is renamed on
-- each sync so its name still carries the current count.
--
-- drive_error records why the last sync failed and is displayed to the
-- teacher. A Drive failure never fails the rebuild: the file in Storage is the
-- source of truth and the download works regardless of whether Google was
-- reachable.
--
-- The folder lives on teacher_settings because it is a property of the teacher
-- (where MY exports go), not of a class or an assessment -- one folder for all
-- of them. Writing into a folder the teacher created, rather than one the app
-- created, needs the full drive scope; drive.file only reaches files the app
-- itself made. See lib/google-drive.ts.

ALTER TABLE teacher_settings ADD COLUMN powerschool_drive_folder_id text;

COMMENT ON COLUMN teacher_settings.powerschool_drive_folder_id IS
  'Google Drive folder id that PowerSchool exports are mirrored into. Null disables the mirror; the files still live in the powerschool-exports bucket.';

ALTER TABLE powerschool_export_files
  ADD COLUMN drive_file_id text,
  ADD COLUMN drive_synced_at timestamptz,
  ADD COLUMN drive_error text;

COMMENT ON COLUMN powerschool_export_files.drive_file_id IS
  'The Drive file this export is mirrored to. Reused on every sync so Drive keeps revision history instead of accumulating one file per rebuild.';
COMMENT ON COLUMN powerschool_export_files.drive_error IS
  'Why the last Drive sync failed, or null. Never fatal: Storage is the source of truth and the download works without Drive.';
