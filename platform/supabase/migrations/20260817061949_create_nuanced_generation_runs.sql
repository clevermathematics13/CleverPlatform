-- Ground truth for "is this generation run alive, finished, or dead?".
-- The client polls /api/claude/status/[runId] against this instead of
-- inferring run health from whether an SSE socket happens to be open.
create table if not exists public.nuanced_generation_runs (
  run_id      text primary key,
  status      text not null default 'running'
              check (status in ('running','succeeded','failed')),
  phase       text,
  pass_count  integer not null default 0,
  char_count  integer not null default 0,
  result_text text,
  error       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists nuanced_generation_runs_created_at_idx
  on public.nuanced_generation_runs (created_at desc);

drop trigger if exists set_updated_at on public.nuanced_generation_runs;
create trigger set_updated_at
  before update on public.nuanced_generation_runs
  for each row execute function public.set_updated_at();

-- No policies: only the service-role key (workflow steps + the status route,
-- which is itself teacher-gated by getApiTeacher) may read or write.
alter table public.nuanced_generation_runs enable row level security;;
