-- Liveness for the background workers, so "is it running?" is a question the
-- database can answer.
--
-- Written after the 6 Sep 2026 Railway restarts, when the bulk-upload worker
-- had claimed nothing for ten days and there was no way to tell an idle
-- worker from a dead one without opening the Railway dashboard: the worker
-- only writes to na_scan_batches when there is work, and there was none
-- queued. A row here is updated every pipeline tick whether or not the tick
-- found anything to do, so a stale last_seen_at means the worker is gone,
-- full stop.
create table public.worker_heartbeats (
  -- The worker's own WORKER_ID. One row per worker process, reused across
  -- restarts when WORKER_ID is set explicitly, so a service that keeps
  -- restarting leaves one row with a moving started_at rather than a pile of
  -- rows nobody prunes.
  worker_id text primary key,
  service text not null default 'bulk-upload-worker',
  -- When this process started. A started_at that keeps moving while
  -- last_seen_at stays fresh is the signature of a restart loop.
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- Free-form: the tick summary, interval config, whatever a future loop
  -- wants to surface. Deliberately not a set of columns -- this table exists
  -- to be read by a human in a hurry, not joined against.
  detail jsonb not null default '{}'::jsonb
);

create index worker_heartbeats_last_seen_idx
  on public.worker_heartbeats (last_seen_at desc);

alter table public.worker_heartbeats enable row level security;

-- Teachers read it (it is operational status, not student data); the worker
-- writes with the service role, which bypasses RLS. No insert or update
-- policy on purpose: nothing but the service role should ever claim a
-- worker is alive.
drop policy if exists "Teachers read worker heartbeats" on public.worker_heartbeats;
create policy "Teachers read worker heartbeats"
  on public.worker_heartbeats
  for select
  using (public.get_my_role() = 'teacher');