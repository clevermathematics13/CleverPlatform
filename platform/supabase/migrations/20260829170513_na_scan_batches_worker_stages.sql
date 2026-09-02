-- Supports the bulk-upload background worker: a teacher can now queue many
-- single-student packet PDFs at once (one na_scan_batches row each,
-- status='queued') for a Railway-hosted worker to process unattended,
-- instead of driving every batch through the browser tab one at a time.
--
-- Status literals added: 'queued' (bulk-created, nothing processed yet),
-- 'cropping'/'assessing'/'assessed' (the worker mirrors stage 4/5 progress
-- onto na_scan_batches so the "Recent batches" list can show it without a
-- join, since a bulk upload is one PDF = one student = one na_scan_batches
-- row 1:1 once split). The existing 'segmented' status is reused, not
-- replaced, for the case where a "bulk" PDF turns out not to be a single
-- clean student packet (more than one segment, or low confidence) -- the
-- worker leaves it there for the teacher to resolve through the existing
-- review UI, exactly as today's single-upload flow already does.
alter table public.na_scan_batches drop constraint na_scan_batches_status_check;
alter table public.na_scan_batches add constraint na_scan_batches_status_check
  check (status = any (array[
    'uploaded', 'presplitting', 'chunked',
    'segmenting', 'segmented', 'split',
    'processing', 'matched', 'cropped', 'failed',
    'queued', 'cropping', 'assessing', 'assessed'
  ]));

alter table public.na_scan_batches
  add column claimed_by text,
  add column claimed_at timestamptz;

comment on column public.na_scan_batches.claimed_by is
  'Worker instance id that last claimed this row for processing. Set by claim_next_na_scan_batch, cleared by nothing (kept for audit); status is the source of truth for whether a claim is still live.';
comment on column public.na_scan_batches.claimed_at is
  'When claimed_by last claimed this row. A worker loop treats a row stuck in an in-flight status (segmenting/cropping/assessing) with a stale claimed_at as a crashed run and resets it to failed rather than leaving it stuck forever.';

-- Atomic claim-and-advance: SELECT ... FOR UPDATE SKIP LOCKED inside a
-- SECURITY DEFINER function is the standard way to get exactly-once claim
-- semantics across concurrent workers without a client-side lock table --
-- PostgREST (what the service-role Supabase client actually speaks) has no
-- direct way to express FOR UPDATE SKIP LOCKED itself, hence the RPC.
-- Generic over from/to status so one function serves every stage transition
-- the worker claims through (queued->segmenting, split->cropping,
-- cropped->assessing) instead of one bespoke function per stage.
create or replace function public.claim_next_na_scan_batch(
  p_worker_id text,
  p_from_status text,
  p_to_status text
)
returns setof public.na_scan_batches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select b.id into v_id
  from na_scan_batches b
  where b.status = p_from_status
  order by b.created_at
  for update skip locked
  limit 1;

  if v_id is null then
    return;
  end if;

  update na_scan_batches
  set status = p_to_status, claimed_by = p_worker_id, claimed_at = now()
  where na_scan_batches.id = v_id;

  return query select * from na_scan_batches where id = v_id;
end;
$$;

revoke execute on function public.claim_next_na_scan_batch(text, text, text) from public;
grant execute on function public.claim_next_na_scan_batch(text, text, text) to service_role;

-- Tracks one Anthropic Message Batches API submission for stage 5
-- (assessment). Submitted per student, not one giant batch for all queued
-- packets: turnaround is governed by Anthropic's own queue rather than
-- batch size, and per-student granularity maps 1:1 onto the existing
-- per-na_scan_batches-row status the UI already displays, so one slow
-- submission never blocks visibility into every other student.
create table public.na_assessment_batches (
  id uuid primary key default gen_random_uuid(),
  anthropic_batch_id text not null unique,
  packet_scan_id uuid not null references public.na_packet_scans(id) on delete cascade,
  status text not null default 'submitted'
    check (status in ('submitted', 'in_progress', 'ended', 'results_written', 'failed')),
  request_count integer not null,
  submitted_at timestamptz not null default now(),
  ended_at timestamptz,
  results_written_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

create index idx_na_assessment_batches_status
  on public.na_assessment_batches(status) where status in ('submitted', 'in_progress');

alter table public.na_response_crops
  add column pending_assessment_batch_id uuid references public.na_assessment_batches(id);

create index idx_na_response_crops_pending_batch
  on public.na_response_crops(pending_assessment_batch_id) where pending_assessment_batch_id is not null;

comment on column public.na_response_crops.pending_assessment_batch_id is
  'Set while this crop''s assessment is in flight in an Anthropic Message Batch submitted by the bulk-upload worker. Cleared once the batch''s results are written to na_feedback. Null for crops assessed the normal synchronous way.';

alter table public.na_assessment_batches enable row level security;
create policy "teachers full access" on public.na_assessment_batches
  for all using (public.get_my_role() = 'teacher');
