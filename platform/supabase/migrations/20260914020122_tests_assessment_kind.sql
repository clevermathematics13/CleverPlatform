-- Formative or summative, for a test authored in the assessment creator.
--
-- Both kinds are authored from the same draft and graded through the same
-- pipeline, so this is a flag rather than a separate content type. What it
-- turns on is collected in platform/lib/assessment-kind.ts; the rule that
-- reaches the database is the grading one -- batch accept stops covering any
-- AI-suggested mark the model was not fully confident about, so a summative
-- mark below high confidence waits for a teacher to look at it.
--
-- Defaults to 'formative' so every existing test, including the six that
-- predate this column, keeps behaving exactly as it did.
alter table public.tests
  add column if not exists assessment_kind text not null default 'formative';

alter table public.tests
  drop constraint if exists tests_assessment_kind_check;

alter table public.tests
  add constraint tests_assessment_kind_check
  check (assessment_kind in ('formative', 'summative'));

comment on column public.tests.assessment_kind is
  'formative | summative. Set by the assessment creator (POST /api/formative-assessments). A summative prints exam conditions on both PDFs, carries no hints, requires a grade boundary set and self-assessment, and holds every below-high-confidence AI grade for teacher review. See platform/lib/assessment-kind.ts.';