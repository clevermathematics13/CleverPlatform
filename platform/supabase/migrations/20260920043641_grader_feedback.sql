-- Feedback a teacher typed to the AI marker about one part, and the marking
-- ruling a model drafted from it.
--
-- test_items.marking_notes is what the marker READS. This table is how a
-- note gets written from a teacher's own words: the teacher says, in the
-- Why? panel of any part, what the marker got wrong or should do differently
-- ("too harsh on a substitution shown but not finished"); the app sends that
-- with the part's question, mark scheme, current notes and the case in front
-- of the teacher to a model, which drafts a precise ruling; the teacher
-- reviews the draft and saves it as the part's marking note. Every round is
-- kept here, so a ruling can be traced back to the feedback that produced
-- it, and so the calibration script can one day ask which feedback moved
-- the marker's record.

create table if not exists public.grader_feedback (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.tests(id) on delete cascade,
  test_item_id uuid not null references public.test_items(id) on delete cascade,
  -- The graded result the teacher was looking at, when there was one.
  result_id uuid references public.ai_grade_results(id) on delete set null,
  feedback text not null,
  previous_notes text,
  proposed_notes text,
  summary text,
  model text,
  -- Set when the teacher saved the proposed notes onto the item.
  applied_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.grader_feedback enable row level security;

drop policy if exists "Teachers manage grader feedback" on public.grader_feedback;
create policy "Teachers manage grader feedback"
  on public.grader_feedback for all
  using (public.get_my_role() = 'teacher')
  with check (public.get_my_role() = 'teacher');

create index if not exists grader_feedback_item_idx
  on public.grader_feedback (test_item_id, created_at desc);
