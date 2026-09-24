-- ---------------------------------------------------------------------------
-- Per-assessment grade boundaries, AI suggestions, teacher guidance, decisions
-- ---------------------------------------------------------------------------
-- Until now every test pointed tests.boundary_set_id at a SHARED preset
-- (A-D for DP course progression, "Grade 9"), so changing the lines for one
-- paper changed them for every paper on that preset, and nothing recorded who
-- chose a paper's lines or why. The teacher asked for each assessment to have
-- its own boundaries, shown to the teacher with the decision to use them
-- stated, plus guidance the AI reads when it suggests boundaries -- scoped to
-- one assessment or a general rule for all of them.
--
-- A test's own boundaries are a grade_boundary_sets row with test_id set, so
-- every existing reader (gradebook, Exam Reflection dashboard, PowerSchool
-- export) keeps reading tests.boundary_set_id -> grade_boundaries unchanged.
-- Presets are the rows with test_id null. Own sets are created by the FIRST
-- decision on a test (decide_test_boundaries below), never by a bulk copy, so
-- a test keeps pointing at its preset until the teacher has decided.
--
-- Schema only: no existing row changes. Writes to grade_boundary_sets and
-- grade_boundaries still have no RLS policy (20260802224213) -- the one path
-- that writes them from the app is the SECURITY DEFINER function below, which
-- does the whole decision in one transaction.

alter table public.grade_boundary_sets
  add column if not exists test_id uuid references public.tests(id) on delete cascade,
  add column if not exists origin_set_id uuid references public.grade_boundary_sets(id) on delete set null;

create unique index if not exists grade_boundary_sets_test_id_key
  on public.grade_boundary_sets (test_id) where test_id is not null;

comment on column public.grade_boundary_sets.test_id is
  'Set when this set is one assessment''s own boundaries (created by decide_test_boundaries); null for a shared preset (A-D, Grade 9).';
comment on column public.grade_boundary_sets.origin_set_id is
  'The preset an assessment''s own set descends from, for labelling ("Grade 9" while the cut-offs are unchanged) and for keeping preset proportions stable.';

-- ---- Guidance the AI reads when it suggests boundaries ----------------------

create table if not exists public.boundary_guidance (
  id uuid primary key default gen_random_uuid(),
  -- null = a general rule for all assessments
  test_id uuid references public.tests(id) on delete cascade,
  note text not null check (char_length(btrim(note)) between 1 and 2000),
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- set when the teacher removes the rule; kept for the record
  archived_at timestamptz
);

comment on table public.boundary_guidance is
  'Teacher guidance for the AI boundary suggestion: test_id set = this assessment only, null = general rule for all assessments. Removed rules keep their row with archived_at set.';

alter table public.boundary_guidance enable row level security;

drop policy if exists "Teachers manage boundary guidance" on public.boundary_guidance;
create policy "Teachers manage boundary guidance"
  on public.boundary_guidance for all
  using (public.get_my_role() = 'teacher')
  with check (public.get_my_role() = 'teacher');

create index if not exists boundary_guidance_active_idx
  on public.boundary_guidance (test_id, created_at)
  where archived_at is null;

-- ---- What the AI suggested (never applied by itself) ------------------------

create table if not exists public.boundary_suggestions (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.tests(id) on delete cascade,
  model text not null,
  total_marks integer not null,
  -- the guidance rules the model was given, as they read at the time
  guidance jsonb not null default '[]'::jsonb,
  -- the anonymised score data the model was given (no names, ids or classes)
  input jsonb not null,
  -- the model's validated answer: cut-offs in marks, rationale, notes
  output jsonb not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.boundary_suggestions is
  'Each AI grade-boundary suggestion for a test, with the anonymised input and the guidance it was given. A suggestion changes nothing; a teacher decision does.';

alter table public.boundary_suggestions enable row level security;

drop policy if exists "Teachers manage boundary suggestions" on public.boundary_suggestions;
create policy "Teachers manage boundary suggestions"
  on public.boundary_suggestions for all
  using (public.get_my_role() = 'teacher')
  with check (public.get_my_role() = 'teacher');

create index if not exists boundary_suggestions_test_idx
  on public.boundary_suggestions (test_id, created_at desc);

-- ---- The stated decision to use a set of boundaries ---------------------------

create table if not exists public.test_boundary_decisions (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.tests(id) on delete cascade,
  -- {bands: {"2": p, ..., "7": p}, cutoffs: [{grade, min_marks, min_proportion}], origin_set_id}
  boundaries jsonb not null,
  total_marks integer,
  source text not null check (source in ('preset', 'ai_suggestion', 'teacher', 'kept')),
  suggestion_id uuid references public.boundary_suggestions(id) on delete set null,
  statement text not null check (char_length(btrim(statement)) between 1 and 4000),
  -- anonymised level counts at the moment of deciding
  distribution jsonb,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz not null default now()
);

comment on table public.test_boundary_decisions is
  'One row per decision on a test''s grade boundaries (adopt or keep), newest = current. Written only by decide_test_boundaries().';

alter table public.test_boundary_decisions enable row level security;

drop policy if exists "Teachers read boundary decisions" on public.test_boundary_decisions;
create policy "Teachers read boundary decisions"
  on public.test_boundary_decisions for select
  using (public.get_my_role() = 'teacher');

create index if not exists test_boundary_decisions_test_idx
  on public.test_boundary_decisions (test_id, decided_at desc);

-- ---- decide_test_boundaries: the one write path -------------------------------
-- p_mode 'adopt' writes p_bands ([{grade: 2..7, min_proportion}]); 'keep'
-- copies whatever the test uses now. Either way the test ends up on its own
-- set and a decision row states why. p_expected_decision_id is the newest
-- decision the caller saw (null = none): a mismatch means another tab decided
-- first, raised as SQLSTATE PT409 so PostgREST answers 409.

create or replace function public.decide_test_boundaries(
  p_test_id uuid,
  p_mode text,
  p_bands jsonb,
  p_cutoffs jsonb,
  p_source text,
  p_statement text,
  p_suggestion_id uuid,
  p_origin_set_id uuid,
  p_distribution jsonb,
  p_expected_decision_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_test record;
  v_latest uuid;
  v_prev jsonb;
  v_new jsonb;
  v_n integer;
  v_nd integer;
  v_min integer;
  v_max integer;
  v_own_set_id uuid;
  v_origin uuid;
  v_decision_id uuid;
begin
  if public.get_my_role() is distinct from 'teacher' then
    raise exception 'Unauthorized';
  end if;

  select id, teacher_id, boundary_set_id, total_marks, (activity_rubric is not null) as is_activity
    into v_test
    from public.tests
   where id = p_test_id
     for update;
  if not found then
    raise exception 'Test not found';
  end if;
  if v_test.teacher_id is distinct from v_uid then
    raise exception 'Unauthorized';
  end if;
  if v_test.is_activity then
    raise exception 'Activities are reported by learning target, not 1-7 levels';
  end if;
  if v_test.total_marks is null or v_test.total_marks <= 0 then
    raise exception 'Set the total marks on this assessment before deciding its boundaries';
  end if;

  if p_mode is null or p_mode not in ('adopt', 'keep') then
    raise exception 'Unknown decision mode %', p_mode;
  end if;
  if p_source is null or p_source not in ('preset', 'ai_suggestion', 'teacher', 'kept') then
    raise exception 'Unknown decision source %', p_source;
  end if;
  if (p_mode = 'keep') <> (p_source = 'kept') then
    raise exception 'Source % does not match mode %', p_source, p_mode;
  end if;
  if p_statement is null or btrim(p_statement) = '' then
    raise exception 'A decision needs a statement of why';
  end if;
  if p_suggestion_id is not null and not exists (
    select 1 from public.boundary_suggestions where id = p_suggestion_id and test_id = p_test_id
  ) then
    raise exception 'That suggestion belongs to a different assessment';
  end if;

  select id into v_latest
    from public.test_boundary_decisions
   where test_id = p_test_id
   order by decided_at desc, id desc
   limit 1;
  if v_latest is distinct from p_expected_decision_id then
    raise exception using
      errcode = 'PT409',
      message = 'The boundaries for this assessment were decided in another tab. Reload to see that decision.';
  end if;

  -- The lines in force now (levels 2..7), from whatever set the test uses.
  select coalesce(jsonb_object_agg(grade::text, min_proportion), '{}'::jsonb)
    into v_prev
    from public.grade_boundaries
   where set_id = v_test.boundary_set_id
     and grade between 2 and 7;

  if p_mode = 'adopt' then
    if jsonb_typeof(p_bands) is distinct from 'array' then
      raise exception 'Boundaries must be a list of levels';
    end if;
    select count(*), count(distinct (b->>'grade')::int), min((b->>'grade')::int), max((b->>'grade')::int)
      into v_n, v_nd, v_min, v_max
      from jsonb_array_elements(p_bands) b;
    if v_n <> 6 or v_nd <> 6 or v_min <> 2 or v_max <> 7 then
      raise exception 'Boundaries must give levels 2 to 7 exactly once each';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_bands) b
       where (b->>'min_proportion') is null
          or (b->>'min_proportion')::numeric <= 0
          or (b->>'min_proportion')::numeric > 1
          or (b->>'min_proportion')::numeric <> round((b->>'min_proportion')::numeric, 4)
    ) then
      raise exception 'Each boundary must be a proportion above 0 and at most 1, to 4 decimal places';
    end if;
    if exists (
      select 1
        from jsonb_array_elements(p_bands) a, jsonb_array_elements(p_bands) b
       where (a->>'grade')::int > (b->>'grade')::int
         and (a->>'min_proportion')::numeric <= (b->>'min_proportion')::numeric
    ) then
      raise exception 'Each level must need more marks than the level below it';
    end if;
    select jsonb_object_agg(b->>'grade', round((b->>'min_proportion')::numeric, 4))
      into v_new
      from jsonb_array_elements(p_bands) b;
  else
    if v_test.boundary_set_id is null or v_prev = '{}'::jsonb then
      raise exception 'This assessment has no boundaries to keep yet';
    end if;
    v_new := v_prev;
  end if;

  -- The test's own set, created on its first decision.
  select id into v_own_set_id from public.grade_boundary_sets where test_id = p_test_id;
  v_origin := case
    when p_origin_set_id is not null
     and exists (select 1 from public.grade_boundary_sets where id = p_origin_set_id and test_id is null)
      then p_origin_set_id
    else null
  end;
  if v_own_set_id is null then
    if v_origin is null then
      select s.id into v_origin
        from public.grade_boundary_sets s
       where s.id = v_test.boundary_set_id and s.test_id is null;
    end if;
    insert into public.grade_boundary_sets (name, description, test_id, origin_set_id)
    values ('test ' || p_test_id::text, 'Grade boundaries decided for one assessment', p_test_id, v_origin)
    returning id into v_own_set_id;
  elsif v_origin is not null then
    update public.grade_boundary_sets set origin_set_id = v_origin where id = v_own_set_id;
  end if;

  insert into public.grade_boundaries (set_id, grade, min_proportion)
  select v_own_set_id, e.key::int, e.value::numeric
    from jsonb_each_text(v_new) e
  on conflict (set_id, grade) do update set min_proportion = excluded.min_proportion;

  insert into public.grade_boundaries (set_id, grade, min_proportion)
  values (v_own_set_id, 1, 0.0100)
  on conflict (set_id, grade) do nothing;

  update public.tests
     set boundary_set_id = v_own_set_id
   where id = p_test_id
     and boundary_set_id is distinct from v_own_set_id;

  insert into public.test_boundary_decisions
    (test_id, boundaries, total_marks, source, suggestion_id, statement, distribution, decided_by)
  values (
    p_test_id,
    jsonb_build_object(
      'bands', v_new,
      'cutoffs', coalesce(p_cutoffs, '[]'::jsonb),
      'origin_set_id', (select origin_set_id from public.grade_boundary_sets where id = v_own_set_id)
    ),
    v_test.total_marks,
    p_source,
    p_suggestion_id,
    btrim(p_statement),
    p_distribution,
    v_uid
  )
  returning id into v_decision_id;

  -- Levels moved, so the stored PowerSchool files are out of date.
  if v_prev is distinct from v_new then
    update public.powerschool_export_files set stale = true where test_id = p_test_id;
  end if;

  return v_decision_id;
end;
$function$;

revoke all on function public.decide_test_boundaries(uuid, text, jsonb, jsonb, text, text, uuid, uuid, jsonb, uuid) from public, anon;
grant execute on function public.decide_test_boundaries(uuid, text, jsonb, jsonb, text, text, uuid, uuid, jsonb, uuid) to authenticated;
