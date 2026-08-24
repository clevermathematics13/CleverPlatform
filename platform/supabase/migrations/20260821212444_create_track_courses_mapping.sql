-- Maps a virtual "track" course (e.g. Grade 9 Extended) to the real,
-- roster-bearing class courses whose students actually follow that
-- curriculum track (e.g. 9A, 9C, 9G). Virtual track courses were
-- deliberately designed to hold no roster of their own -- NA content and
-- na_continuity live on the track course, but students, gradebook, tests,
-- and Google Classroom sync all key off the real per-class course. Before
-- this table, that link only existed as free text in courses.description
-- and in conversation history, which meant anything needing "who actually
-- takes this NA packet" (e.g. scan roster matching) had no way to resolve
-- it.
--
-- A track can have several member courses (many-to-many in principle,
-- though in practice each real class belongs to exactly one track).
create table public.track_courses (
  id uuid primary key default gen_random_uuid(),
  track_course_id uuid not null references public.courses(id) on delete cascade,
  member_course_id uuid not null references public.courses(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (track_course_id, member_course_id),
  check (track_course_id != member_course_id)
);

comment on table public.track_courses is
  'Maps a virtual track course (no roster of its own, e.g. Grade 9 Extended) to the real roster-bearing class courses that follow it (e.g. 9A, 9C, 9G). Used to resolve "which real students does this NA packet/track apply to" for roster matching, since NA content lives on the track course but rosters live on the real class courses.';

-- Grade 9 Extended = 9A, 9G (9C does not exist as a course yet -- flagged,
-- not silently omitted; add its row here once the course is created).
insert into public.track_courses (track_course_id, member_course_id) values
  ('b1d3b183-5cbe-4994-ac3c-2a11120ed752', '2abe4055-26e6-4155-a79c-1a8e10045874'), -- Grade 9 Extended -> 9A
  ('b1d3b183-5cbe-4994-ac3c-2a11120ed752', 'e3d14ebd-ce57-489d-8999-4916c2b688ce'); -- Grade 9 Extended -> 9G

-- Grade 9 Standard = 9D
insert into public.track_courses (track_course_id, member_course_id) values
  ('40ef6810-57f1-42f0-b914-97c216ab5f80', 'fc29a912-229e-4d7a-bba8-29d605ef03df'); -- Grade 9 Standard -> 9D;
