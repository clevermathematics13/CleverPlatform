
-- The rubric (answer key) has until now existed only INSIDE the activity
-- record: buried in nuanced_analyses.parts[].questions[].answer and
-- duplicated, in a terser and materially different form, in
-- teacher_companion.answerSketches. That caused real problems:
--   * two competing keys with no defined precedence -- grading silently
--     used the terser one and marked a student down for wording that the
--     authored key explicitly accepted;
--   * no way to view, query, or edit the rubric without parsing JSONB;
--   * no way to export it.
--
-- This table makes the rubric a first-class, queryable, editable object,
-- separate from the activity it belongs to. na_anchors (geometry) can
-- reference it rather than carrying its own copy.
create table if not exists na_rubric_items (
  id uuid primary key default gen_random_uuid(),
  nuanced_analysis_id uuid not null references nuanced_analyses(id) on delete cascade,

  -- Question identity. qid matches na_anchors.qid where an anchor exists
  -- ("Q1", "Q1(e)"); question_number is the ordinal within the activity,
  -- which is what maps back to parts[].questions[].
  qid text not null,
  base_qid text not null,
  question_number integer not null,

  question_text text,
  answer_key text,
  open_rubric text,
  misconception_context text,
  command_term text,

  -- marks: this item's own share. question_marks: the whole base
  -- question's total. Kept separate deliberately -- conflating them is
  -- exactly how A.1 ended up with sub-part shares summing to more than
  -- the question was worth (Q1: 4+1=5 against a true total of 4).
  marks integer,
  question_marks integer,

  -- Free-text space for a teacher to record marking decisions that
  -- aren't in the original key ("accept 'agree' or 'the same'").
  teacher_notes text,

  source text not null default 'generated',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (nuanced_analysis_id, qid)
);

create index if not exists na_rubric_items_na_idx
  on na_rubric_items (nuanced_analysis_id, question_number);

create trigger set_na_rubric_items_updated_at
  before update on na_rubric_items
  for each row execute function set_updated_at();

alter table na_rubric_items enable row level security;

-- Teachers read and write; students never see the answer key.
create policy na_rubric_items_teacher_all on na_rubric_items
  for all to authenticated
  using (get_my_role() = 'teacher')
  with check (get_my_role() = 'teacher');

comment on table na_rubric_items is
  'The marking rubric / answer key for a nuanced analysis, one row per question. First-class and editable, as opposed to being buried inside nuanced_analyses.parts JSONB. na_anchors.rubric_item_id links a physical answer box to its rubric entry.';
;
