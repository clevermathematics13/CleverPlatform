-- Overnight marking: a class is sent to Anthropic's Message Batches API
-- (half price on every token) instead of being marked one request at a time
-- from the teacher's browser.
--
-- There is no background worker in this design, deliberately. The submit
-- happens in the request that the teacher's click makes, and results are
-- collected by POST /api/tests/[id]/ai-grade/collect, which the AI grade
-- page calls when it loads and while any batch is still open. Anthropic
-- keeps a batch's results for 29 days, so nothing is lost if nobody opens
-- the page for a while, and no always-on service has to stay funded.
--
-- 'submitted' is the one new run status: the request is with Anthropic and
-- no result has been written yet. It is produced only by the queue route.
-- The synchronous marking route still only ever writes running/complete/
-- failed, so a 'submitted' run is unambiguous evidence of the overnight
-- path.
alter table public.ai_grade_runs drop constraint ai_grade_runs_status_check;

alter table public.ai_grade_runs add constraint ai_grade_runs_status_check
  check (status in ('submitted', 'running', 'complete', 'failed'));

comment on column public.ai_grade_runs.status is
  'submitted = sent to the Message Batches API by the overnight path, awaiting collection. running/complete/failed are written by the synchronous marking route.';

create table public.ai_grade_message_batches (
  id uuid primary key default gen_random_uuid(),
  -- Anthropic's own batch id (msgbatch_...). Unique so a double submit can
  -- never produce two rows tracking the same batch.
  anthropic_batch_id text not null unique,
  test_id uuid not null references public.tests(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  status text not null default 'submitted'
    check (status in ('submitted', 'in_progress', 'ended', 'results_written', 'failed')),
  request_count integer not null,
  submitted_at timestamptz not null default now(),
  ended_at timestamptz,
  results_written_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

-- The collect route's working set: batches that may still have results to
-- fetch. Partial, because rows only ever leave this set.
create index idx_ai_grade_message_batches_open
  on public.ai_grade_message_batches (test_id, submitted_at)
  where status in ('submitted', 'in_progress', 'ended');

alter table public.ai_grade_message_batches enable row level security;

drop policy if exists "Teachers manage AI grade message batches" on public.ai_grade_message_batches;
create policy "Teachers manage AI grade message batches"
  on public.ai_grade_message_batches
  for all
  using (public.get_my_role() = 'teacher')
  with check (public.get_my_role() = 'teacher');

-- Which batch a submitted run is waiting on. Cleared when its result is
-- written, so a non-null value plus status 'submitted' is exactly the set
-- the collect route still owes an answer for.
alter table public.ai_grade_runs
  add column pending_message_batch_id uuid references public.ai_grade_message_batches(id) on delete set null;

create index idx_ai_grade_runs_pending_batch
  on public.ai_grade_runs (pending_message_batch_id)
  where pending_message_batch_id is not null;