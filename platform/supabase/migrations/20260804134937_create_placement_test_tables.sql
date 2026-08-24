-- Placement Tests: AI-assessed scanned student placement tests.
-- Pipeline: upload PDF -> segment into questions (AI infers markscheme too)
-- -> grade each question -> aggregate into an AISL/AASL/AAHL recommendation.

create table public.placement_tests (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id),
  student_name text not null,
  course_id uuid references public.courses(id),
  storage_path text not null,
  file_name text not null,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'segmenting', 'grading', 'complete', 'error')),
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index placement_tests_teacher_id_idx on public.placement_tests(teacher_id);
create index placement_tests_status_idx on public.placement_tests(status);

comment on table public.placement_tests is
  'One row per uploaded scanned placement-test PDF. student_name is manually tagged by the teacher at upload time (no student account link required).';

create table public.placement_test_questions (
  id uuid primary key default gen_random_uuid(),
  placement_test_id uuid not null references public.placement_tests(id) on delete cascade,
  question_number integer not null,
  page_numbers integer[] not null default '{}',
  inferred_question_latex text,
  inferred_markscheme_latex text,
  inferred_max_marks integer not null default 0,
  inferred_level_hint text check (inferred_level_hint in ('SL', 'HL')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index placement_test_questions_test_id_idx on public.placement_test_questions(placement_test_id);

comment on table public.placement_test_questions is
  'AI-segmented questions detected within a placement test PDF. Markscheme is AI-inferred, not teacher-authored — this is a placement test, not a bank question.';

create table public.placement_test_marks (
  id uuid primary key default gen_random_uuid(),
  placement_test_question_id uuid not null references public.placement_test_questions(id) on delete cascade,
  marks_awarded numeric not null,
  max_marks integer not null,
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  confidence_notes text,
  student_work_transcription text,
  created_at timestamptz not null default now()
);

create index placement_test_marks_question_id_idx on public.placement_test_marks(placement_test_question_id);

comment on table public.placement_test_marks is
  'AI-graded mark for each placement test question. confidence = low flags for teacher review (fully automatic pipeline, confidence-flagged rather than review-gated).';

create table public.placement_recommendations (
  id uuid primary key default gen_random_uuid(),
  placement_test_id uuid not null unique references public.placement_tests(id) on delete cascade,
  recommended_curriculum text not null check (recommended_curriculum in ('AA', 'AI')),
  recommended_level text not null check (recommended_level in ('SL', 'HL')),
  recommended_label text not null check (recommended_label in ('AISL', 'AASL', 'AAHL')),
  overall_percentage numeric not null,
  reasoning text not null,
  subtopic_breakdown jsonb not null default '{}',
  low_confidence_count integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.placement_recommendations is
  'Final AISL/AASL/AAHL placement recommendation for a placement test, aggregated from placement_test_marks.';

-- RLS: enabled but intentionally left permissive for now (deferred), matching
-- the rest of the platform's current migration status (see nuanced_analyses,
-- grade_boundary_sets). Revisit alongside the other deferred RLS policies.
alter table public.placement_tests enable row level security;
alter table public.placement_test_questions enable row level security;
alter table public.placement_test_marks enable row level security;
alter table public.placement_recommendations enable row level security;

create policy "Teachers can manage placement tests" on public.placement_tests
  for all using (true) with check (true);
create policy "Teachers can manage placement test questions" on public.placement_test_questions
  for all using (true) with check (true);
create policy "Teachers can manage placement test marks" on public.placement_test_marks
  for all using (true) with check (true);
create policy "Teachers can manage placement recommendations" on public.placement_recommendations
  for all using (true) with check (true);
;
