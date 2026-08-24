alter table public.nuanced_analyses
  add column if not exists course_id uuid references public.courses(id) on delete set null;

alter table public.nuanced_analyses
  add column if not exists owner_id uuid references public.profiles(id) on delete set null;

alter table public.nuanced_analyses
  add column if not exists grade_level text;

alter table public.nuanced_analyses
  add column if not exists section_code text;

alter table public.nuanced_analyses
  add column if not exists draft_content jsonb;

alter table public.nuanced_analyses
  add column if not exists continuity_digest jsonb;

alter table public.nuanced_analyses
  drop constraint if exists nuanced_analyses_continuity_digest_is_object;
alter table public.nuanced_analyses
  add constraint nuanced_analyses_continuity_digest_is_object
  check (continuity_digest is null or jsonb_typeof(continuity_digest) = 'object');

alter table public.nuanced_analyses
  drop constraint if exists nuanced_analyses_draft_content_is_object;
alter table public.nuanced_analyses
  add constraint nuanced_analyses_draft_content_is_object
  check (draft_content is null or jsonb_typeof(draft_content) = 'object');

create index if not exists idx_nuanced_analyses_course
  on public.nuanced_analyses (course_id, sort_order);

create index if not exists idx_nuanced_analyses_owner
  on public.nuanced_analyses (owner_id);

create unique index if not exists uq_nuanced_analyses_course_section
  on public.nuanced_analyses (course_id, section_code)
  where course_id is not null and section_code is not null;

alter table public.nuanced_analyses enable row level security;

drop policy if exists "Teachers can insert nuanced_analyses" on public.nuanced_analyses;
create policy "Teachers can insert nuanced_analyses" on public.nuanced_analyses
  for insert to authenticated
  with check (public.get_my_role() = 'teacher');

drop policy if exists "Teachers can update nuanced_analyses" on public.nuanced_analyses;
create policy "Teachers can update nuanced_analyses" on public.nuanced_analyses
  for update to authenticated
  using      (public.get_my_role() = 'teacher')
  with check (public.get_my_role() = 'teacher');

drop policy if exists "Teachers can delete nuanced_analyses" on public.nuanced_analyses;
create policy "Teachers can delete nuanced_analyses" on public.nuanced_analyses
  for delete to authenticated
  using (public.get_my_role() = 'teacher');

comment on column public.nuanced_analyses.course_id is
  'The course this packet belongs to. NULL for the legacy hand-curated AA HL rows that predate course scoping.';

comment on column public.nuanced_analyses.section_code is
  'Scope-and-sequence coordinate within the unit, e.g. A.1, A.2, B.4. Unique per course.';

comment on column public.nuanced_analyses.draft_content is
  'The AssignmentDraft JSON consumed by DocumentOrchestratorService and the Typst renderer.';

comment on column public.nuanced_analyses.continuity_digest is
  'Compact record of what this packet taught, appended to na_continuity.packets on save.';;
