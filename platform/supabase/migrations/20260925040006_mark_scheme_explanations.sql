-- Written explanations for the student mark scheme: one per part of a test.
--
-- The student mark scheme (lib/student-mark-scheme.ts) shows each part as a
-- card. With a row here the card leads with a short, plain answer, then how
-- the marks work, a few "watch out" notes, and an "Explain more" section a
-- student opens -- a short slideshow of worked steps with typeset maths and
-- diagrams. Rows are written from the teacher's own answer and mark scheme
-- on the teacher's request (app/api/tests/[id]/mark-scheme/explanations),
-- checked before they are stored (lib/mark-scheme-explanation.ts).
--
-- Keyed on (test_id, question_number, part_label), the natural key
-- test_items is unique on, rather than on test_items.id: a Formative
-- Assessment re-save recreates its items with new ids, and an unchanged
-- part's explanation should survive that. source_hash is a hash of what the
-- row was written from (the part's words, the teacher's answer and scheme,
-- its marks); a student is shown the row only while it still matches the
-- part, so editing a scheme can never leave an explanation that contradicts
-- it in front of a student.
--
-- Teachers read and write the rows of tests they own. Students have NO
-- policy: an explanation carries the answer to every part of a paper, and
-- whether a student may see it depends on things no row policy here can
-- express -- the test is released to their track family, not hidden, its
-- released mark scheme is the platform's own page, and their own class has
-- sat it (test_course_dates). The server checks those and then reads the
-- rows with the service role (lib/mark-scheme-explanation-store.ts).

create table if not exists public.mark_scheme_explanations (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.tests(id) on delete cascade,
  question_number integer not null,
  part_label text not null default '',
  source_hash text not null,
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  model text not null,
  prompt_version integer not null,
  generated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mark_scheme_explanations_one_per_part unique (test_id, question_number, part_label)
);

comment on table public.mark_scheme_explanations is
  'A written explanation of one part of a test''s mark scheme for students: the answer, how the marks work, watch-out notes and the "Explain more" steps (lib/mark-scheme-explanation.ts). Shown on the student mark scheme only while source_hash matches the part as it stands. Teachers of the test read and write; students read nothing directly -- the server reads with the service role after its release gates.';
comment on column public.mark_scheme_explanations.source_hash is
  'sha256 of what the explanation was written from: the part''s stem and words, the teacher''s answer and mark scheme, and its marks (explanationSourceHash). A mismatch means the part changed since, and the explanation is not shown.';
comment on column public.mark_scheme_explanations.content is
  'The explanation, validated by MarkSchemeExplanationSchema and checkExplanation before it is stored.';

drop trigger if exists set_updated_at on public.mark_scheme_explanations;
create trigger set_updated_at
  before update on public.mark_scheme_explanations
  for each row execute function public.set_updated_at();

alter table public.mark_scheme_explanations enable row level security;

-- New tables inherit full rights for anon and authenticated from the default
-- privileges, which would leave RLS as the only barrier. anon gets nothing.
revoke all on public.mark_scheme_explanations from anon;

drop policy if exists "Teachers read explanations on their tests" on public.mark_scheme_explanations;
create policy "Teachers read explanations on their tests"
  on public.mark_scheme_explanations for select to authenticated
  using (exists (
    select 1 from public.tests t
    where t.id = mark_scheme_explanations.test_id
      and t.teacher_id = (select auth.uid())
  ));

drop policy if exists "Teachers write explanations on their tests" on public.mark_scheme_explanations;
create policy "Teachers write explanations on their tests"
  on public.mark_scheme_explanations for insert to authenticated
  with check (exists (
    select 1 from public.tests t
    where t.id = mark_scheme_explanations.test_id
      and t.teacher_id = (select auth.uid())
  ));

drop policy if exists "Teachers rewrite explanations on their tests" on public.mark_scheme_explanations;
create policy "Teachers rewrite explanations on their tests"
  on public.mark_scheme_explanations for update to authenticated
  using (exists (
    select 1 from public.tests t
    where t.id = mark_scheme_explanations.test_id
      and t.teacher_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.tests t
    where t.id = mark_scheme_explanations.test_id
      and t.teacher_id = (select auth.uid())
  ));

drop policy if exists "Teachers remove explanations on their tests" on public.mark_scheme_explanations;
create policy "Teachers remove explanations on their tests"
  on public.mark_scheme_explanations for delete to authenticated
  using (exists (
    select 1 from public.tests t
    where t.id = mark_scheme_explanations.test_id
      and t.teacher_id = (select auth.uid())
  ));

create index if not exists mark_scheme_explanations_generated_by_idx
  on public.mark_scheme_explanations (generated_by);
