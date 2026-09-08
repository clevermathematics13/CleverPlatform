-- ---------------------------------------------------------------------------
-- The PowerTeacher Scores Template, kept per class
-- ---------------------------------------------------------------------------
-- Filling in PowerSchool's own scores template is how levels get into
-- PowerTeacher Pro without a column-mapping dialog: the file already names the
-- section, lists exactly its roster, and carries whatever student numbers
-- PowerSchool believes in. Until now the teacher had to export that template
-- from PowerSchool and upload it again for every single assignment, which is
-- the same file every time.
--
-- One row per course, so the upload is a one-off. The five metadata lines that
-- describe the class -- teacher, section, points possible, extra points, score
-- type -- hold for every assignment in it; the two that describe the
-- assignment are rewritten on the way out (see retargetPst in lib/pst-fill.ts)
-- when the template is reused for a different test than it was uploaded from.
--
-- The stored copy has its Score column blanked (clearPstScores), so a template
-- that happened to be uploaded with scores in it can never hand one of those
-- back later as though this platform had just written it.
--
-- Teacher-only: the template is a roster of real student names and
-- school-defined student numbers.

CREATE TABLE powerschool_templates (
  course_id uuid PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,
  template text NOT NULL,
  source_test_id uuid REFERENCES tests(id) ON DELETE SET NULL,
  source_filename text,
  assignment_name text,
  class_name text,
  student_count integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES profiles(id)
);

ALTER TABLE powerschool_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers can manage powerschool templates" ON powerschool_templates
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'teacher')
  );

COMMENT ON TABLE powerschool_templates IS
  'The PowerTeacher Scores Template for one class, uploaded once and re-filled for every assignment. Score column stored blank.';
COMMENT ON COLUMN powerschool_templates.source_test_id IS
  'The test the template was uploaded against. Re-exporting that same test leaves the metadata exactly as PowerSchool wrote it; any other test gets its assignment name and due date rewritten.';
COMMENT ON COLUMN powerschool_templates.assignment_name IS
  'Assignment Name as read from the uploaded template, so the gradebook can say which assignment it came from.';
