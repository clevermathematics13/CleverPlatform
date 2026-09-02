-- Per-call token accounting for every Anthropic request the platform's
-- per-student pipelines make (AI grading, batch segmentation, NA per-crop
-- assessment, NA cover-page checks). Until now nothing recorded
-- response.usage, so the only way to see what a pipeline costs was the
-- Anthropic Console -- and the only way to tell whether a caching change
-- worked was to guess. One row per model call, written by
-- lib/ai-usage.ts's recordUsage (app routes, as the teacher) and by the
-- bulk-upload worker (service role).
create table public.ai_usage_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- 'ai_grade' | 'ai_regrade' | 'ai_grade_segment' | 'na_assess' |
  -- 'na_assess_wide' | 'na_assess_batch' | 'na_cover_page'
  pipeline text not null,
  model text not null,
  input_tokens integer not null default 0,
  cache_creation_input_tokens integer not null default 0,
  cache_read_input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  -- true when the call went through the Message Batches API (50% rate on
  -- every token type), so cost queries can apply the right multiplier.
  batch boolean not null default false,
  -- What the call was for: 'ai_grade_run' | 'ai_grade_result' |
  -- 'ai_grade_batch' | 'na_crop' | 'na_scan_batch'. Loose references on
  -- purpose (no FK): a usage row must outlive the run/crop it describes.
  ref_type text,
  ref_id uuid
);

create index ai_usage_log_created_at_idx on public.ai_usage_log (created_at desc);
create index ai_usage_log_pipeline_created_at_idx on public.ai_usage_log (pipeline, created_at desc);

alter table public.ai_usage_log enable row level security;

-- Teachers read and insert. App routes write with the teacher's own session
-- client (RLS applies), so insert must be allowed for that role; the worker
-- writes with the service-role key, which bypasses RLS. Nobody updates or
-- deletes: this is an append-only ledger.
create policy "teachers_read_ai_usage_log"
  on public.ai_usage_log
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'teacher'
    )
  );

create policy "teachers_insert_ai_usage_log"
  on public.ai_usage_log
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'teacher'
    )
  );
