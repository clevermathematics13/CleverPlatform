-- Grade level is read off the front page instead of the teacher picking a
-- course. The paper is labelled with the grade the student is coming FROM,
-- so the effective placement grade is one higher (a "Grade 9" paper means a
-- Grade 10 student). Both values are stored: printed_grade_level is exactly
-- what was written on the paper, grade_level is the +1 adjusted value used
-- for placement.
alter table public.placement_tests
  add column printed_grade_level integer,
  add column grade_level integer,
  add column grade_level_source text not null default 'extracted'
    check (grade_level_source in ('manual', 'extracted')),
  add column grade_level_confidence text
    check (grade_level_confidence in ('high', 'medium', 'low')),
  add column grade_level_notes text;

comment on column public.placement_tests.printed_grade_level is
  'The grade level exactly as written/printed on the front page of the test, before adjustment.';
comment on column public.placement_tests.grade_level is
  'Effective placement grade = printed_grade_level + 1. The test paper is labelled with the grade the student is coming from, so a Grade 9 paper indicates a Grade 10 student.';
comment on column public.placement_tests.grade_level_confidence is
  'Only set when grade_level_source = extracted. low/medium flags for teacher review, same convention as student_name_confidence.';
;
