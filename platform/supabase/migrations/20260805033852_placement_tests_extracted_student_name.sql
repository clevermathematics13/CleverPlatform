-- Student name can now be read off the front page by Claude vision instead of
-- being typed by the teacher, so it may be absent/uncertain at upload time.
alter table public.placement_tests
  alter column student_name drop not null;

alter table public.placement_tests
  add column student_name_source text not null default 'manual'
    check (student_name_source in ('manual', 'extracted')),
  add column student_name_confidence text
    check (student_name_confidence in ('high', 'medium', 'low')),
  add column student_name_notes text;

comment on column public.placement_tests.student_name_source is
  'manual = teacher typed it at upload; extracted = read from the scanned front page by Claude vision. Teacher edits flip this back to manual.';
comment on column public.placement_tests.student_name_confidence is
  'Only set when student_name_source = extracted. low/medium flags the name for teacher review (amber in UI), same convention as placement_test_marks.confidence.';
;
