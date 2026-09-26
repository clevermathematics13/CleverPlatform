-- ---------------------------------------------------------------------------
-- The bulk mark-scheme build: one row per attempt, and the two functions
-- that change question_parts from it
-- ---------------------------------------------------------------------------
-- scripts/build-mark-schemes.ts transcribes a PPQ question's mark-scheme
-- images (lib/markscheme-transcribe.ts), checks the result and plans the
-- part changes (lib/markscheme-build.ts). Every attempt is a row here: the
-- transcription, the checks, the plan, and -- once applied -- the parts as
-- they were before and after. State lives here rather than in a local file
-- because agent sessions are wiped; a pending Message Batch is found again
-- by anthropic_batch_id.
--
-- A flagged row is a proposal waiting for the teacher in LaTeX Review. It is
-- never written anywhere the grader reads: assembleMarkScheme takes the
-- first non-empty of markscheme_latex, markscheme_text,
-- stem_markscheme_latex and parts_draft_markscheme_latex, so a staged
-- proposal in any of those would be marked against.
--
-- apply_markscheme_build() applies one question's plan in one transaction:
-- it locks the question, re-checks whether a test or saved exam now uses it,
-- and changes a part only if it is still exactly as planned (same label,
-- same scheme text, not verified). Anything else raises and changes nothing.
-- rollback_markscheme_build() restores the snapshot, and refuses if the
-- question is in use or any part it wrote has changed since.
--
-- Both are SECURITY INVOKER: the build script calls them with the service
-- role, LaTeX Review's Accept with the teacher's session, and each caller's
-- own RLS applies. They admit only those two callers.
-- markscheme_question_in_use() is SECURITY DEFINER so that it sees every
-- saved exam, not just the caller's; it returns a boolean and nothing else.

create table public.markscheme_builds (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.ib_questions(id) on delete cascade,
  source text not null check (source in ('ms_images', 'drive_pdf')),
  source_ref jsonb not null default '{}'::jsonb,
  model text,
  prompt_version text,
  run_id text not null,
  anthropic_batch_id text,
  transcription jsonb,
  checks jsonb,
  plan jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'applied', 'flagged', 'failed', 'accepted', 'dismissed', 'rolled_back')),
  before jsonb,
  after jsonb,
  error text,
  usage jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  applied_at timestamptz,
  decided_at timestamptz,
  decided_by uuid references public.profiles(id)
);

comment on table public.markscheme_builds is
  'One attempt of the bulk mark-scheme build per row (scripts/build-mark-schemes.ts). flagged = waiting for the teacher in LaTeX Review, never visible to the grader. before/after snapshot the question''s parts for rollback_markscheme_build().';

create index markscheme_builds_question_id_idx on public.markscheme_builds (question_id, created_at desc);
create index markscheme_builds_status_idx on public.markscheme_builds (status);
create index markscheme_builds_batch_idx on public.markscheme_builds (anthropic_batch_id)
  where anthropic_batch_id is not null;
-- At most one open attempt per question, so a question is never submitted twice.
create unique index markscheme_builds_one_open_per_question on public.markscheme_builds (question_id)
  where status in ('pending', 'flagged');

create trigger markscheme_builds_set_updated_at
  before update on public.markscheme_builds
  for each row execute function public.set_updated_at();

alter table public.markscheme_builds enable row level security;

-- Teachers read and decide (LaTeX Review). The script writes with the
-- service role, which bypasses RLS. Students have no access at all: the
-- rows hold mark schemes.
create policy "teachers_read_markscheme_builds"
  on public.markscheme_builds
  for select
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher'));

create policy "teachers_update_markscheme_builds"
  on public.markscheme_builds
  for update
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher'));

-- ---- is a question in use? --------------------------------------------------

create or replace function public.markscheme_question_in_use(p_question_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
           select 1
             from public.saved_exams s
            cross join lateral jsonb_array_elements(
              case when jsonb_typeof(s.questions) = 'array' then s.questions else '[]'::jsonb end) e
            where e->>'id' = p_question_id::text)
      or exists (
           select 1
             from public.archived_saved_exams s
            cross join lateral jsonb_array_elements(
              case when jsonb_typeof(s.questions) = 'array' then s.questions else '[]'::jsonb end) e
            where e->>'id' = p_question_id::text)
      or exists (
           select 1
             from public.test_items ti
             join public.ib_questions q on q.code = ti.ib_question_code
            where q.id = p_question_id);
$function$;

revoke all on function public.markscheme_question_in_use(uuid) from public, anon;
grant execute on function public.markscheme_question_in_use(uuid) to authenticated, service_role;

-- ---- apply ------------------------------------------------------------------

create or replace function public.apply_markscheme_build(p_build_id uuid, p_plan jsonb default null)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $function$
declare
  v_is_teacher boolean := coalesce(public.get_my_role() = 'teacher', false);
  v_actor uuid := auth.uid();
  v_build public.markscheme_builds%rowtype;
  v_plan jsonb;
  v_question_id uuid;
  v_action jsonb;
  v_part public.question_parts%rowtype;
  v_marks integer;
  v_before jsonb;
  v_images jsonb;
  v_after jsonb;
  v_new_id uuid;
  v_inserted uuid[] := '{}';
begin
  if coalesce(auth.role(), '') <> 'service_role' and not v_is_teacher then
    raise exception 'Unauthorized';
  end if;

  select * into v_build from public.markscheme_builds where id = p_build_id for update;
  if not found then
    raise exception 'Build % not found', p_build_id;
  end if;
  if v_build.status not in ('pending', 'flagged') then
    raise exception 'Build % is %, not pending or flagged', p_build_id, v_build.status;
  end if;

  v_plan := coalesce(p_plan, v_build.plan);
  if v_plan is null or jsonb_typeof(v_plan->'actions') is distinct from 'array'
     or jsonb_array_length(v_plan->'actions') = 0 then
    raise exception 'Build % has nothing to apply', p_build_id;
  end if;
  if jsonb_array_length(coalesce(v_plan->'flags', '[]'::jsonb)) > 0 then
    raise exception 'Build % still has flags; a flagged plan is never applied', p_build_id;
  end if;

  v_question_id := v_build.question_id;
  perform 1 from public.ib_questions where id = v_question_id for update;
  if not found then
    raise exception 'Question % not found', v_question_id;
  end if;
  if public.markscheme_question_in_use(v_question_id)
     and not coalesce((v_plan->>'inUse')::boolean, false) then
    raise exception 'A test or saved exam now uses this question; plan it again';
  end if;

  select coalesce(jsonb_agg(to_jsonb(p) order by p.sort_order, p.part_label), '[]'::jsonb)
    into v_before
    from public.question_parts p
   where p.question_id = v_question_id;
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'part_id', i.part_id)), '[]'::jsonb)
    into v_images
    from public.question_images i
   where i.question_id = v_question_id and i.image_type = 'markscheme' and i.part_id is not null;

  for v_action in select value from jsonb_array_elements(v_plan->'actions') loop
    if v_action->>'kind' in ('fill', 'relabel') then
      select * into v_part
        from public.question_parts
       where id = (v_action->>'partId')::uuid and question_id = v_question_id
         for update;
      if not found then
        raise exception 'Part % is gone', v_action->>'partId';
      end if;
      if v_part.part_label is distinct from coalesce(v_action->>'expectedLabel', '') then
        raise exception 'Part % is labelled "%" now, not "%"', v_part.id, v_part.part_label, v_action->>'expectedLabel';
      end if;
      if btrim(coalesce(v_part.markscheme_latex, '')) is distinct from btrim(coalesce(v_action->>'expectedLatex', '')) then
        raise exception 'Part % has a different mark scheme than when it was planned', v_part.id;
      end if;
      if v_part.latex_verified then
        raise exception 'Part % was verified by a teacher', v_part.id;
      end if;

      v_marks := case when jsonb_typeof(v_action->'marks') = 'number' then (v_action->>'marks')::integer end;

      -- The part's state before this change, as the part-metadata route records it.
      if v_action->>'kind' = 'relabel' or (v_marks is not null and v_marks is distinct from v_part.marks) then
        insert into public.question_part_metadata_history
          (part_id, question_id, part_label, marks, command_term, subtopic_codes, sort_order, changed_by)
        values
          (v_part.id, v_question_id, coalesce(v_part.part_label, ''), coalesce(v_part.marks, 1), v_part.command_term,
           coalesce(v_part.subtopic_codes, '{}'), coalesce(v_part.sort_order, 0), v_actor);
      end if;

      if v_action->>'kind' = 'relabel' then
        update public.question_parts
           set part_label = v_action->>'label',
               sort_order = (v_action->>'sortOrder')::integer,
               marks = coalesce(v_marks, marks),
               markscheme_latex = v_action->>'latex',
               mark_attributions = '{}'::jsonb
         where id = v_part.id;
      else
        update public.question_parts
           set markscheme_latex = v_action->>'latex',
               marks = coalesce(v_marks, marks),
               mark_attributions = '{}'::jsonb
         where id = v_part.id;
      end if;
    elsif v_action->>'kind' = 'insert' then
      insert into public.question_parts
        (question_id, part_label, marks, sort_order, markscheme_latex, subtopic_codes, primary_subtopic_code)
      values
        (v_question_id,
         coalesce(v_action->>'label', ''),
         (v_action->>'marks')::integer,
         (v_action->>'sortOrder')::integer,
         v_action->>'latex',
         array(select jsonb_array_elements_text(coalesce(v_action->'subtopicCodes', '[]'::jsonb))),
         nullif(v_action->>'primarySubtopicCode', ''))
      returning id into v_new_id;
      v_inserted := v_inserted || v_new_id;
    else
      raise exception 'Unknown action "%"', v_action->>'kind';
    end if;
  end loop;

  -- A split re-labels the parts, so a positional image-to-part link would
  -- now point at the wrong part (or hide the image from the new ones).
  if coalesce((v_plan->>'resetImagePartIds')::boolean, false) then
    update public.question_images
       set part_id = null
     where question_id = v_question_id and image_type = 'markscheme' and part_id is not null;
  end if;

  select coalesce(jsonb_agg(to_jsonb(p) order by p.sort_order, p.part_label), '[]'::jsonb)
    into v_after
    from public.question_parts p
   where p.question_id = v_question_id;

  update public.markscheme_builds
     set status = case when v_is_teacher then 'accepted' else 'applied' end,
         plan = v_plan,
         before = jsonb_build_object('parts', v_before, 'image_part_ids', v_images),
         after = jsonb_build_object('parts', v_after, 'inserted', to_jsonb(v_inserted)),
         applied_at = now(),
         decided_at = case when v_is_teacher then now() else decided_at end,
         decided_by = case when v_is_teacher then v_actor else decided_by end,
         error = null
   where id = p_build_id;

  return jsonb_build_object(
    'build_id', p_build_id,
    'question_id', v_question_id,
    'actions', jsonb_array_length(v_plan->'actions'),
    'inserted', to_jsonb(v_inserted));
end;
$function$;

revoke all on function public.apply_markscheme_build(uuid, jsonb) from public, anon;
grant execute on function public.apply_markscheme_build(uuid, jsonb) to authenticated, service_role;

-- ---- rollback ---------------------------------------------------------------

create or replace function public.rollback_markscheme_build(p_build_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $function$
declare
  v_build public.markscheme_builds%rowtype;
  v_question_id uuid;
  v_row jsonb;
  v_current public.question_parts%rowtype;
  v_deleted integer := 0;
  v_restored integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' and coalesce(public.get_my_role(), '') <> 'teacher' then
    raise exception 'Unauthorized';
  end if;

  select * into v_build from public.markscheme_builds where id = p_build_id for update;
  if not found then
    raise exception 'Build % not found', p_build_id;
  end if;
  if v_build.status not in ('applied', 'accepted') then
    raise exception 'Build % is %; only an applied build can be rolled back', p_build_id, v_build.status;
  end if;

  v_question_id := v_build.question_id;
  perform 1 from public.ib_questions where id = v_question_id for update;
  if public.markscheme_question_in_use(v_question_id) then
    raise exception 'A test or saved exam uses this question; roll it back by hand';
  end if;

  -- Every part the build left must still be exactly as it left it.
  if (select count(*) from public.question_parts where question_id = v_question_id)
     <> jsonb_array_length(v_build.after->'parts') then
    raise exception 'Parts were added or removed since the build';
  end if;
  for v_row in select value from jsonb_array_elements(v_build.after->'parts') loop
    select * into v_current from public.question_parts where id = (v_row->>'id')::uuid;
    if not found then
      raise exception 'Part % has been deleted since the build', v_row->>'id';
    end if;
    if v_current.part_label is distinct from v_row->>'part_label'
       or v_current.marks is distinct from (v_row->>'marks')::integer
       or coalesce(v_current.markscheme_latex, '') is distinct from coalesce(v_row->>'markscheme_latex', '')
       or v_current.latex_verified then
      raise exception 'Part % ("%") has changed since the build', v_current.id, v_current.part_label;
    end if;
  end loop;

  -- Inserted parts go first, so the labels they hold are free again.
  delete from public.question_parts
   where id in (select jsonb_array_elements_text(coalesce(v_build.after->'inserted', '[]'::jsonb))::uuid);
  get diagnostics v_deleted = row_count;

  for v_row in select value from jsonb_array_elements(v_build.before->'parts') loop
    update public.question_parts
       set part_label = v_row->>'part_label',
           marks = (v_row->>'marks')::integer,
           sort_order = (v_row->>'sort_order')::integer,
           markscheme_latex = v_row->>'markscheme_latex',
           mark_attributions = coalesce(v_row->'mark_attributions', '{}'::jsonb)
     where id = (v_row->>'id')::uuid;
    v_restored := v_restored + 1;
  end loop;

  update public.question_images i
     set part_id = (x->>'part_id')::uuid
    from jsonb_array_elements(coalesce(v_build.before->'image_part_ids', '[]'::jsonb)) x
   where i.id = (x->>'id')::uuid;

  update public.markscheme_builds
     set status = 'rolled_back', decided_at = now(), decided_by = auth.uid()
   where id = p_build_id;

  return jsonb_build_object('build_id', p_build_id, 'deleted', v_deleted, 'restored', v_restored);
end;
$function$;

revoke all on function public.rollback_markscheme_build(uuid) from public, anon;
grant execute on function public.rollback_markscheme_build(uuid) to authenticated, service_role;
