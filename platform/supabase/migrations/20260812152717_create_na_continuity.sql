-- Durable continuity store for the Nuanced Analysis generator.
-- One row per course. unit_sequence is the full planned spine (source of
-- truth for "what comes next"). packets is a compact digest per NA actually
-- generated/saved — never full packet text, just what a future generation
-- needs to avoid re-deriving or repeating content.
create table if not exists public.na_continuity (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  unit_sequence jsonb not null default '[]'::jsonb,
  packets jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id)
);

create trigger na_continuity_set_updated_at
before update on public.na_continuity
for each row execute function public.set_updated_at();

alter table public.na_continuity enable row level security;

create policy na_continuity_teacher_all
on public.na_continuity
for all
to authenticated
using (public.get_my_role() = 'teacher')
with check (public.get_my_role() = 'teacher');

revoke all on public.na_continuity from public;
grant select, insert, update, delete on public.na_continuity to authenticated;;
