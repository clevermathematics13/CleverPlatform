-- Archive the two PDFs a Formative Assessment renders to, so a saved paper is
-- recoverable after the authoring tab closes.
--
-- Until now nothing stored a blank paper anywhere in this system:
-- /api/assignments/generate-pdf and /api/assignments/mark-scheme stream a PDF
-- to the browser and keep nothing, and the sandbox cannot reload a saved
-- assessment. Formative Assessment 1 -- sat by 50 students -- had no
-- retrievable copy as a result.
--
-- These are storage PATHS in the private `exam-scans` bucket, deliberately NOT
-- reusing tests.paper_url / tests.mark_scheme_url. Those two are free-text URLs
-- a teacher types into the test detail form and students see as links on the
-- reflection page; a private-bucket object can only be handed out as a signed
-- URL minted on demand, which would expire if stored in a text column.
alter table tests
  add column paper_pdf_storage_path text,
  add column mark_scheme_pdf_storage_path text,
  add column assessment_formatting jsonb,
  add column pdfs_generated_at timestamptz;

comment on column tests.paper_pdf_storage_path is
  'Path in the private `exam-scans` bucket to the archived blank student paper, written by POST /api/formative-assessments on save. Null for tests not created via the Formative Assessment creator. Served to a teacher as a short-lived signed URL by GET /api/formative-assessments/[testId]/pdf.';
comment on column tests.mark_scheme_pdf_storage_path is
  'Path in the private `exam-scans` bucket to the archived teacher mark scheme (answers + M/A/R codes + marking principles + reteach guide). Teacher-only: no storage policy grants students read on this prefix.';
comment on column tests.assessment_formatting is
  'The FormattingRequirements the archived PDFs were rendered with (school/teacher name, font size, margins, answer-box style). The creator holds this in React state and it was previously never persisted, so a re-render of an older draft could not reproduce the paper the class actually sat. Null means lib/formative-assessment-pdf-body.ts DEFAULT_ASSESSMENT_FORMATTING.';
comment on column tests.pdfs_generated_at is
  'When the archived PDFs were last written. Older than the test''s last edit means the archive is stale -- re-saving the assessment regenerates both.';
