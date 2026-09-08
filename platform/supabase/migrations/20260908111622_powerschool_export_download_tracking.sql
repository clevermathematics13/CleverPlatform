-- ---------------------------------------------------------------------------
-- Knowing which exports have scores the teacher has not taken yet
-- ---------------------------------------------------------------------------
-- The gradebook offers one button that collects every class whose scores have
-- moved since the last time they were downloaded. To light it up honestly we
-- have to know two things: what the file says now, and what it said when the
-- teacher last took it.
--
-- Both are hashes of the CSV itself rather than timestamps. A timestamp says
-- the file was rebuilt, which happens whenever a student self-assesses or a
-- mark is touched -- including edits that put a value back where it was. A
-- hash says the bytes that would be imported are different, which is the only
-- thing that justifies asking the teacher to import again.
--
-- content_sha moves on every rebuild; downloaded_sha only when the file is
-- actually handed over. The two differing is the whole definition of "has new
-- scores", so a first-ever download correctly offers everything (downloaded
-- null, content set) and a rebuild that changed nothing correctly offers
-- nothing.

ALTER TABLE powerschool_export_files
  ADD COLUMN content_sha text,
  ADD COLUMN downloaded_sha text,
  ADD COLUMN downloaded_at timestamptz;

COMMENT ON COLUMN powerschool_export_files.content_sha IS
  'sha256 of the CSV as last written. Compared against downloaded_sha to decide whether this class has scores the teacher has not taken yet.';
COMMENT ON COLUMN powerschool_export_files.downloaded_sha IS
  'content_sha at the moment the file was last included in a Download new scores batch. Null until the first download, which is why the first one offers everything.';
COMMENT ON COLUMN powerschool_export_files.downloaded_at IS
  'When this file was last included in a download batch.';
