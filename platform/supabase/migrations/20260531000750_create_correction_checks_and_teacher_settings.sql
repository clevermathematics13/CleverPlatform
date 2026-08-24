
-- Teacher global settings (one row per teacher)
CREATE TABLE teacher_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  show_corrections boolean NOT NULL DEFAULT false,
  show_feedback boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(teacher_id)
);

ALTER TABLE teacher_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers manage own settings"
  ON teacher_settings
  FOR ALL
  USING (teacher_id = auth.uid())
  WITH CHECK (teacher_id = auth.uid());

CREATE POLICY "Students can read teacher settings"
  ON teacher_settings
  FOR SELECT
  USING (true);

-- Correction check results (one row per pdf_upload)
CREATE TABLE correction_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  test_id uuid NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  pdf_upload_id uuid NOT NULL REFERENCES pdf_uploads(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'done', 'error')),
  extracted_latex jsonb,
  question_feedback jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(pdf_upload_id)
);

ALTER TABLE correction_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers can read all correction checks"
  ON correction_checks
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'teacher'
  ));

CREATE POLICY "Students can read own correction checks"
  ON correction_checks
  FOR SELECT
  USING (student_id = auth.uid());

CREATE INDEX correction_checks_student_test_idx
  ON correction_checks(student_id, test_id);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER correction_checks_updated_at
  BEFORE UPDATE ON correction_checks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER teacher_settings_updated_at
  BEFORE UPDATE ON teacher_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
;
