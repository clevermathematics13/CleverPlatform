-- Two virtual "courses" used only to group Nuanced Analysis content and its
-- continuity record across the Grade 9 class sections that share a single
-- curriculum track. These are NOT roster courses: no students, gradebook
-- entries, tests, or Google Classroom sync should ever reference them.
-- Real per-class roster courses (9A, 9C, 9D, 9G) are untouched and remain
-- the FK target for students/gradebook/tests/syllabus_coverage/etc.
--
-- Grade 9 Extended = 9A, 9C, 9G (shared curriculum track)
-- Grade 9 Standard = 9D
insert into public.courses (id, name, description)
values
  (gen_random_uuid(), 'Grade 9 Extended', 'Nuanced Analysis grouping (virtual, not a roster) — covers 9A, 9C, 9G, which share one Grade 9 Extended curriculum track. Do not enroll students in this course; use the individual class courses (9A/9C/9G) for rosters and gradebook.'),
  (gen_random_uuid(), 'Grade 9 Standard', 'Nuanced Analysis grouping (virtual, not a roster) — covers 9D, which follows the Grade 9 Standard curriculum track. Do not enroll students in this course; use 9D for rosters and gradebook.');
;
