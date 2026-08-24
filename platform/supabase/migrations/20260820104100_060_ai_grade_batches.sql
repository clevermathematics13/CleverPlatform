-- 060_ai_grade_batches.sql
-- Batch-scan segmentation for AI grading: one uploaded PDF covering several
-- students' scripts, delimited by a cover/divider page per student and not
-- guaranteed to keep each student's pages contiguous (a student's overflow
-- work can be appended after the next student's cover page).
--
-- Segmentation runs once per uploaded batch, proposes a page-range mapping
-- per detected student, and the teacher confirms/corrects it before any
-- splitting or grading happens. Splitting produces ordinary per-student PDFs
-- fed through the EXISTING single-student grading path unchanged — this
-- table and its route are purely an attribution step ahead of that path.

create table if not exists public.ai_grade_batches (
  id                  uuid primary key default gen_random_uuid(),
  test_id             uuid not null references public.tests(id) on delete cascade,
  created_by          uuid not null references public.profiles(id) on delete cascade,
  status              text not null default 'uploaded'
                        check (status in ('uploaded', 'segmenting', 'segmented', 'failed', 'split')),
  source_storage_path text not null,
  file_name           text,
  page_count          integer,
  -- Model's proposed segmentation, before teacher review:
  -- [{ "label": "Pedro Costa", "pages": [1,2,3,4,5,6,7,8], "matchedStudentId": "uuid"|null,
  --    "confidence": "high"|"medium"|"low", "note": "..." }, ...]
  proposed_segments   jsonb not null default '[]'::jsonb,
  -- Teacher-confirmed segmentation, same shape, null until confirmed.
  -- Splitting reads ONLY this column, never proposed_segments.
  confirmed_segments  jsonb,
  unassigned_pages    jsonb not null default '[]'::jsonb,
  error               text,
  created_at          timestamptz not null default now(),
  segmented_at        timestamptz,
  split_at            timestamptz
);

create index if not exists ai_grade_batches_test_idx
  on public.ai_grade_batches (test_id, created_at desc);

alter table public.ai_grade_batches enable row level security;

drop policy if exists "Teachers manage AI grade batches" on public.ai_grade_batches;
create policy "Teachers manage AI grade batches"
  on public.ai_grade_batches
  for all
  using (public.get_my_role() = 'teacher')
  with check (public.get_my_role() = 'teacher');

-- Batch uploads land in the same teacher-only bucket as single-student scans,
-- under a batches/ prefix so cleanup and browsing can distinguish them.
-- No new bucket or storage policy needed — exam-scans already grants
-- teacher select/insert/update/delete on the whole bucket (migration 057).;
