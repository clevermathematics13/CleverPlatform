-- A Grade 9 Standard Level assessment is graded by STRANDS into performance
-- levels (Exceeding / Meeting / Approaching / Beginning), not by a grade
-- boundary set into a 1-7 level. The strand rubric -- which parts feed which
-- strand, the standards each strand assesses, the level bands and the level
-- descriptors -- is data on the test, validated by StandardsRubricSchema in
-- platform/lib/standards-rubric.ts. Null (the default, and every existing
-- test) means "not standards-referenced": graded and reported exactly as
-- before. Non-null makes lib/ai-grading.ts load the Standard Level marking
-- policy in place of the Formative Assessment one, and makes the review UI
-- and the standards report page compute strand levels from Clev's Marks.
alter table public.tests
  add column if not exists standards_rubric jsonb;

comment on column public.tests.standards_rubric is
  'Strand rubric for a Grade 9 Standard Level (standards-referenced) assessment; see platform/lib/standards-rubric.ts. Null = graded by marks and boundary set as usual.';
