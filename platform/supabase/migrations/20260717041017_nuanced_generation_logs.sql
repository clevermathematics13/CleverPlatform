-- Generation logging for Nuanced Analysis. Every raw Claude generation
-- (both workflow passes and the generate-packet single pass) is persisted
-- here BEFORE any parsing, so truncated/malformed outputs remain
-- diagnosable even when the teacher never saves the draft.
create table if not exists public.nuanced_generation_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source text not null,          -- 'activity-generator-workflow' | 'generate-packet'
  pass text not null,            -- 'first-half' | 'second-half' | 'single'
  model text,
  stop_reason text,
  char_count integer,
  raw_text text,
  error text
);

create index if not exists nuanced_generation_logs_created_at_idx
  on public.nuanced_generation_logs (created_at desc);

alter table public.nuanced_generation_logs enable row level security;

-- Writes happen only through the service-role key (which bypasses RLS).
-- Reads are limited to teachers, matching the platform's role gating.
create policy "teachers_read_generation_logs"
  on public.nuanced_generation_logs
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'teacher'
    )
  );;
