-- Lets a teacher release Clev's Marks/feedback to students on a test without
-- requiring them to submit a self-assessment first (app/dashboard/reflection
-- gates marks_awarded on student_self_scores existing for the CleverReflection
-- portal). Defaults to true so every existing test keeps today's behavior.
alter table tests
  add column require_self_assessment boolean not null default true;

comment on column tests.require_self_assessment is 'When true (default), a student must submit a self-assessment (student_self_scores) before app/dashboard/reflection reveals teacher/AI marks for this test. When false, marks are visible immediately.';
