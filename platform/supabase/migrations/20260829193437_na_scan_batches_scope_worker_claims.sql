-- Emergency fix: the bulk-upload worker's claim function had no way to
-- distinguish a batch created via the new bulk-upload endpoint from any
-- pre-existing batch sitting at status='split'/'cropped' from the normal
-- single-upload flow (that status has been used by the manual pipeline for
-- months). Within minutes of first deploying, the worker claimed and marked
-- 'failed' 10 real production batches, including db4d3a05 (the live A.1
-- batch with 7 real students' grades documented in HANDOFF.md) -- its
-- assumption of exactly one na_packet_scans row per batch (true only for a
-- bulk single-student upload) doesn't hold for real multi-student batches,
-- so its lookup failed and it wrote status='failed' over real data. Those
-- 10 rows were manually reverted to their correct prior status via
-- execute_sql immediately before this migration. This migration closes the
-- actual hole so it cannot recur: the worker may now only ever claim rows
-- explicitly marked as its own.

alter table public.na_scan_batches
  add column is_bulk_upload boolean not null default false;

comment on column public.na_scan_batches.is_bulk_upload is
  'True only for rows created by POST /api/na-review/batch/bulk. The worker (platform/worker/) must never claim a row where this is false -- see claim_next_na_scan_batch, which enforces this at the DB level regardless of what the worker code itself does.';

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
    and b.is_bulk_upload = true
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
