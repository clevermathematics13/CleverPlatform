-- 057_ai_grading.sql
-- AI-assisted grading of scanned student work against the PPQ-generated mark scheme.
--
-- RECONCILIATION NOTE
-- public.ai_grade_runs and public.ai_grade_results already existed in the live
-- database (created out-of-band via MCP, with RLS enabled and teacher-only
-- policies) but had no corresponding migration file in this repo. This file
-- records that schema so the repo and the database stop drifting. Every
-- statement is idempotent: on the live database only the storage bucket and its
-- policies are new; on a fresh database this creates the whole feature.
--
-- Design note: AI output NEVER writes directly to public.student_marks.
-- It lands in public.ai_grade_results as a *proposal* that the teacher reviews
-- and accepts. Accepting goes through the normal mark path so public.mark_changes
-- keeps a complete audit trail and disagreement scoring (student_self_scores vs
-- student_marks) stays meaningful. Marks are displayed as "Clev's Marks".

-- ─────────────────────────────────────────────────────────────────────────────
-- ai_grade_runs — one row per (assessment, student, grading attempt)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_grade_runs (
  id                  uuid primary key default gen_random_uuid(),
  test_id             uuid not null references public.tests(id) on delete cascade,
  student_id          uuid not null references public.profiles(id) on delete cascade,
  created_by          uuid not null references public.profiles(id) on delete cascade,
  status              text not null default 'running'
                        check (status in ('running', 'complete', 'failed')),
  model               text,
  source_storage_path text,
  coverage            jsonb,
  error               text,
  created_at          timestamptz not null default now(),
  completed_at        timestamptz
);

create index if not exists ai_grade_runs_test_student_idx
  on public.ai_grade_runs (test_id, student_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- ai_grade_results — one row per test_item per run
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_grade_results (
  id                uuid primary key default gen_random_uuid(),
  run_id            uuid not null references public.ai_grade_runs(id) on delete cascade,
  test_item_id      uuid not null references public.test_items(id) on delete cascade,
  suggested_marks   integer not null check (suggested_marks >= 0),
  max_marks         integer not null check (max_marks >= 0),
  confidence        text not null check (confidence in ('high', 'medium', 'low')),
  markscheme_source text not null
                      check (markscheme_source in ('part_latex', 'part_text', 'whole_question', 'draft', 'none')),
  work_found        boolean not null default true,
  reasoning         text,
  evidence          text,
  mark_breakdown    jsonb not null default '[]'::jsonb,
  accepted          boolean not null default false,
  accepted_at       timestamptz,
  accepted_by       uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  unique (run_id, test_item_id)
);

create index if not exists ai_grade_results_run_idx
  on public.ai_grade_results (run_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security — teacher-only.
-- Students must not see AI proposals: an unreviewed suggestion is not a mark,
-- and exposing it would corrupt the self-assessment step of the reflection flow.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.ai_grade_runs    enable row level security;
alter table public.ai_grade_results enable row level security;

drop policy if exists "Teachers manage AI grade runs" on public.ai_grade_runs;
create policy "Teachers manage AI grade runs"
  on public.ai_grade_runs
  for all
  using (public.get_my_role() = 'teacher')
  with check (public.get_my_role() = 'teacher');

drop policy if exists "Teachers manage AI grade results" on public.ai_grade_results;
create policy "Teachers manage AI grade results"
  on public.ai_grade_results
  for all
  using (public.get_my_role() = 'teacher')
  with check (public.get_my_role() = 'teacher');

-- ─────────────────────────────────────────────────────────────────────────────
-- Storage bucket for teacher-uploaded scans of completed scripts.
-- Kept separate from 'corrections', which holds student-uploaded correction
-- PDFs from the reflection flow and is readable by the owning student.
-- ─────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('exam-scans', 'exam-scans', false)
on conflict (id) do nothing;

drop policy if exists exam_scans_teacher_select on storage.objects;
create policy exam_scans_teacher_select
  on storage.objects for select
  using (bucket_id = 'exam-scans' and public.get_my_role() = 'teacher');

drop policy if exists exam_scans_teacher_insert on storage.objects;
create policy exam_scans_teacher_insert
  on storage.objects for insert
  with check (bucket_id = 'exam-scans' and public.get_my_role() = 'teacher');

drop policy if exists exam_scans_teacher_update on storage.objects;
create policy exam_scans_teacher_update
  on storage.objects for update
  using (bucket_id = 'exam-scans' and public.get_my_role() = 'teacher');

drop policy if exists exam_scans_teacher_delete on storage.objects;
create policy exam_scans_teacher_delete
  on storage.objects for delete
  using (bucket_id = 'exam-scans' and public.get_my_role() = 'teacher');
