-- ---------------------------------------------------------------------------
-- A PowerSchool export regenerated as students finish self-assessing
-- ---------------------------------------------------------------------------
-- Every time a student submits a self-assessment, the filled scores template
-- for their class is rebuilt and stored, named for how many of that class have
-- now completed it: 9C_Form1_6.csv. The teacher does not have to be in the app
-- for the file to be current.
--
-- One row per (course, test), overwritten. The count lives in the filename,
-- not the path, so the stored object keeps a stable path and only the recorded
-- filename changes -- that makes the update an upsert rather than a
-- delete-and-recreate, and there is never a moment with no file.
--
-- Written only by the service role, from the route that regenerates it. The
-- student whose submit triggers it must never be able to write here, and never
-- sees the file: it carries every classmate's achievement level. Hence SELECT
-- for teachers and no INSERT/UPDATE policy at all.

ALTER TABLE tests ADD COLUMN short_name text;

COMMENT ON COLUMN tests.short_name IS
  'Short label for filenames, e.g. "Form1" for "Formative Assessment 1". Falls back to an abbreviation of name when null -- see lib/assessment-short-name.ts.';

CREATE TABLE powerschool_export_files (
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  test_id uuid NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  filename text NOT NULL,
  completed_count integer NOT NULL,
  roster_count integer NOT NULL,
  filled_count integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (course_id, test_id)
);

ALTER TABLE powerschool_export_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers can read powerschool export files" ON powerschool_export_files
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'teacher')
  );

COMMENT ON TABLE powerschool_export_files IS
  'The auto-regenerated PowerSchool scores file for one class and assessment. Written by the service role only; read by teachers. The object itself lives in the powerschool-exports bucket at storage_path.';
COMMENT ON COLUMN powerschool_export_files.filename IS
  'What the download is called: [class]_[short name]_[completed count].csv, e.g. 9C_Form1_6.csv.';
COMMENT ON COLUMN powerschool_export_files.completed_count IS
  'Students in this course with at least one non-null self_marks for this test -- the number in the filename.';

-- Private bucket. No storage policies: the only reader is the download route,
-- which uses the service role and checks the teacher itself.
INSERT INTO storage.buckets (id, name, public)
VALUES ('powerschool-exports', 'powerschool-exports', false)
ON CONFLICT (id) DO NOTHING;
