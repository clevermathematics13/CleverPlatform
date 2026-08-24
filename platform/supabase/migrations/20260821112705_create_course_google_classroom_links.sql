create table public.course_google_classroom_links (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  google_course_id text not null,
  google_course_name text not null,
  google_course_section text,
  linked_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id)
);

comment on table public.course_google_classroom_links is
  'Maps a CleverPlatform course to a Google Classroom course. One CP course links to at most one GC course; a GC course may be linked from multiple CP courses (e.g. one GC class split into Extended/Standard CP courses). Used to scope the Classroom grading page''s course picker and (in future) to drive roster sync.';

create index course_google_classroom_links_google_course_id_idx
  on public.course_google_classroom_links (google_course_id);

alter table public.course_google_classroom_links enable row level security;

create policy "Teachers manage classroom links"
  on public.course_google_classroom_links
  for all
  using (public.get_my_role() = 'teacher')
  with check (public.get_my_role() = 'teacher');

create trigger set_updated_at
  before update on public.course_google_classroom_links
  for each row
  execute function public.set_updated_at();
;
