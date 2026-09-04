-- Server-side tracking for automatic batch runs (stage 4 crop + stage 5
-- assess) on the NA scan-test page, so an in-progress run survives a page
-- refresh, a closed tab, or a dropped connection. The actual per-student
-- resume logic already lives in na_packet_scans/na_response_crops/na_feedback
-- (autoCropAndAssessAll skips whatever's already done there) -- this table
-- is the audit/monitoring ledger on top of that: "is a run in flight for
-- this batch right now, and how far did it get".
--
-- Deviation from the original spec worth recording: the requested column
-- list included both `packet_scan_id` and `batch_id`, but a batch run spans
-- every student in the batch (one na_packet_scans row each), so a single
-- packet_scan_id doesn't fit at this granularity. Used packet_version_id
-- instead (derived server-side from na_scan_batches.packet_version_id, not
-- client-supplied) -- it's the one extra piece of context actually useful
-- for a run listing (which packet this run belongs to) and has no
-- multi-row ambiguity.
create table public.na_batch_runs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.na_scan_batches(id) on delete cascade,
  packet_version_id uuid not null references public.na_packet_versions(id),
  teacher_id uuid references public.profiles(id),
  stage text not null default 'cropping'
    check (stage in ('cropping', 'assessing')),
  total_students integer not null default 0,
  students_done integer not null default 0,
  -- invited_students.id values (na_packet_scans.invited_student_id) still
  -- to be processed, in the same order the client walks them.
  student_ids_pending jsonb not null default '[]'::jsonb,
  status text not null default 'active'
    check (status in ('active', 'paused', 'completed', 'failed', 'stale')),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create index idx_na_batch_runs_batch on public.na_batch_runs(batch_id);
create index idx_na_batch_runs_status on public.na_batch_runs(status);

-- One live run per batch at a time -- POST create is idempotent against
-- this (finds and returns the existing active/paused row instead of
-- inserting a duplicate), which is also what makes "reopen the page" and
-- "the auto-resume effect fires twice" both land on the same run row.
create unique index idx_na_batch_runs_one_active_per_batch
  on public.na_batch_runs(batch_id)
  where status in ('active', 'paused');

create trigger set_updated_at before update on public.na_batch_runs
  for each row execute function public.set_updated_at();

alter table public.na_batch_runs enable row level security;

-- Same convention as every other na_* table (see 20260821043732): this is a
-- single-teacher platform, RLS gates by role, not per-row ownership.
-- teacher_id is still recorded on every row for the audit trail.
create policy "teachers full access" on public.na_batch_runs
  for all using (public.get_my_role() = 'teacher');
