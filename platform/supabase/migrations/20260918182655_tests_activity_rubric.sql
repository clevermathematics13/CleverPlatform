-- A Math Medic Exploration or a homework is an ACTIVITY, not an assessment.
-- It is reported as Got it / Almost / Not yet per LEARNING TARGET, not as
-- marks into a 1-7 (Grade 9 Extended) and not as performance levels per
-- strand (Grade 9 Standard). The activity rubric -- which parts are evidence
-- of which learning target, the target wording from the lesson's QuickNotes,
-- and the outcome bands -- is data on the test, validated by
-- ActivityRubricSchema in platform/lib/activity-rubric.ts.
--
-- Null (the default, and every existing test) means "not an activity":
-- graded and reported exactly as before. Non-null makes lib/ai-grading.ts
-- load the Exploration/homework marking policy IN PLACE OF BOTH the
-- Formative Assessment and the Standard Level policies, and makes the
-- activity report page compute learning-target outcomes from Clev's Marks.
--
-- Deliberately a second column rather than a widened assessment_kind or a
-- reuse of standards_rubric: an activity and a Standard Level paper answer
-- different questions about the same student, and a test carrying both is a
-- mistake the app warns about rather than a state the schema blesses.
alter table public.tests
  add column if not exists activity_rubric jsonb;

comment on column public.tests.activity_rubric is
  'Learning-target rubric for a Math Medic Exploration or homework; see platform/lib/activity-rubric.ts. Non-null makes the test an ACTIVITY: marked under the Exploration/homework policy and reported as Got it / Almost / Not yet per learning target. Null = graded and reported as before.';
