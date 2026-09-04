-- Live "Kahoot-style" question game, built for the Integration Techniques
-- slide deck but general-purpose (any teacher-authored question bank).
--
-- Scoring is deliberately NOT "fastest wins biggest": the SECOND correct
-- answer for a question outscores the first (see the base-points case
-- expression in submit_game_answer below), which rewards actually reading
-- the question instead of mashing the first option, while speed still
-- matters overall since ranks 3+ taper off. Anything landing after the
-- question's time limit (15s) earns zero credit regardless of correctness.
-- A streak bonus and a rubber-band "underdog" bonus for trailing players
-- keep the leaderboard from being decided in the first two questions, and
-- one random scored answer per question gets a small "lucky bonus" at
-- reveal time for delight. platform/lib/game-scoring.ts is the executable
-- spec for this formula in TypeScript -- keep the two in sync.
--
-- All scoring writes go through the SECURITY DEFINER functions below, never
-- through direct table access, so a student client cannot forge points: the
-- functions lock the session row (`for update`) before reading/writing, so
-- concurrent submissions for the same question rank correctly.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.game_question_banks (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.game_questions (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.game_question_banks(id) on delete cascade,
  sort_order int not null,
  unique (bank_id, sort_order),
  prompt_latex text not null,
  question_text text not null,
  -- [{ "text": string, "is_correct": boolean }, ...]
  choices jsonb not null,
  hint text,
  explanation text not null,
  feedback_correct text,
  feedback_incorrect text,
  tags text[] not null default '{}',
  time_limit_seconds int not null default 15,
  created_at timestamptz not null default now()
);
create index game_questions_bank_idx on public.game_questions(bank_id, sort_order);

create table public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.game_question_banks(id),
  host_id uuid not null references public.profiles(id),
  room_code text not null unique,
  status text not null default 'lobby'
    check (status in ('lobby', 'question', 'reveal', 'finished')),
  current_question_index int not null default -1,
  current_question_started_at timestamptz,
  -- shuffled game_questions.id list, fixed once the session starts
  question_order uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz
);

create table public.game_players (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  profile_id uuid not null references public.profiles(id),
  nickname text not null,
  joined_at timestamptz not null default now(),
  total_score int not null default 0,
  current_streak int not null default 0,
  best_streak int not null default 0,
  unique (session_id, profile_id)
);
create index game_players_session_idx on public.game_players(session_id);

create table public.game_answers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  player_id uuid not null references public.game_players(id) on delete cascade,
  question_id uuid not null references public.game_questions(id),
  question_index int not null,
  choice_index int not null,
  is_correct boolean not null,
  response_ms int not null,
  base_points int not null default 0,
  streak_bonus int not null default 0,
  underdog_bonus int not null default 0,
  lucky_bonus int not null default 0,
  points_awarded int not null default 0,
  -- 1-based rank among correct, on-time answers for this question; null if this answer scored nothing
  correct_rank int,
  answered_at timestamptz not null default now(),
  unique (session_id, player_id, question_index)
);
create index game_answers_session_question_idx on public.game_answers(session_id, question_index);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.game_question_banks enable row level security;
alter table public.game_questions enable row level security;
alter table public.game_sessions enable row level security;
alter table public.game_players enable row level security;
alter table public.game_answers enable row level security;

-- Bank titles/slugs aren't sensitive; any logged-in user can browse them
-- (a teacher picks one when creating a session).
create policy "authenticated can read banks" on public.game_question_banks
  for select using (auth.role() = 'authenticated');
create policy "teachers manage banks" on public.game_question_banks
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher')
  ) with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher')
  );

-- Question content (and the answer key inside `choices`) is never exposed
-- to students directly -- only teachers can select the raw table. Students
-- see the active question only through get_active_question(), which is
-- SECURITY DEFINER and deliberately strips the answer key while a question
-- is still live.
create policy "teachers manage questions" on public.game_questions
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher')
  ) with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher')
  );

create policy "host or player can read a session" on public.game_sessions
  for select using (
    host_id = auth.uid()
    or exists (
      select 1 from public.game_players gp
      where gp.session_id = game_sessions.id and gp.profile_id = auth.uid()
    )
  );
create policy "teachers create sessions" on public.game_sessions
  for insert with check (
    host_id = auth.uid()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher')
  );
create policy "host manages own session" on public.game_sessions
  for update using (host_id = auth.uid()) with check (host_id = auth.uid());
create policy "host deletes own session" on public.game_sessions
  for delete using (host_id = auth.uid());

-- No insert/update policy for game_players on purpose: joining goes through
-- join_game_session() and score changes go through submit_game_answer() /
-- advance_game_session(), both SECURITY DEFINER, so a client cannot write a
-- player row or a score directly.
create policy "session participants can read players" on public.game_players
  for select using (
    exists (
      select 1 from public.game_sessions s
      where s.id = game_players.session_id and s.host_id = auth.uid()
    )
    or exists (
      select 1 from public.game_players me
      where me.session_id = game_players.session_id and me.profile_id = auth.uid()
    )
  );
create policy "host can remove a player" on public.game_players
  for delete using (
    exists (
      select 1 from public.game_sessions s
      where s.id = game_players.session_id and s.host_id = auth.uid()
    )
  );

-- No insert/update/delete policy for game_answers: writes only happen
-- inside submit_game_answer() / advance_game_session().
create policy "host or the answering player can read answers" on public.game_answers
  for select using (
    exists (
      select 1 from public.game_sessions s
      where s.id = game_answers.session_id and s.host_id = auth.uid()
    )
    or exists (
      select 1 from public.game_players gp
      where gp.id = game_answers.player_id and gp.profile_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Realtime: host and player clients subscribe to postgres_changes on these
-- three tables (session phase, roster/score changes, live answer counts).
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.game_sessions;
alter publication supabase_realtime add table public.game_players;
alter publication supabase_realtime add table public.game_answers;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

create or replace function public.join_game_session(p_room_code text, p_nickname text)
returns public.game_players
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.game_sessions;
  v_player public.game_players;
  v_display_name text;
begin
  select * into v_session
  from game_sessions
  where room_code = upper(trim(p_room_code));

  if not found then
    raise exception 'Game not found';
  end if;
  if v_session.status <> 'lobby' then
    raise exception 'This game has already started';
  end if;

  select display_name into v_display_name from profiles where id = auth.uid();

  insert into game_players (session_id, profile_id, nickname)
  values (
    v_session.id,
    auth.uid(),
    coalesce(nullif(trim(p_nickname), ''), v_display_name, 'Player')
  )
  on conflict (session_id, profile_id) do update set nickname = excluded.nickname
  returning * into v_player;

  return v_player;
end;
$$;
revoke all on function public.join_game_session(text, text) from public;
grant execute on function public.join_game_session(text, text) to authenticated;

create or replace function public.get_active_question(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.game_sessions;
  v_question public.game_questions;
  v_question_id uuid;
  v_choices jsonb;
begin
  select * into v_session from game_sessions where id = p_session_id;
  if not found then
    raise exception 'Game not found';
  end if;
  if v_session.host_id <> auth.uid()
     and not exists (
       select 1 from game_players gp
       where gp.session_id = p_session_id and gp.profile_id = auth.uid()
     ) then
    raise exception 'Forbidden';
  end if;

  if v_session.current_question_index < 0 then
    return null;
  end if;

  v_question_id := v_session.question_order[v_session.current_question_index + 1];
  select * into v_question from game_questions where id = v_question_id;

  if v_session.status = 'question' then
    -- No answer key, no explanation, no per-option feedback while live.
    select jsonb_agg(jsonb_build_object('index', idx - 1, 'text', c ->> 'text') order by idx)
      into v_choices
      from jsonb_array_elements(v_question.choices) with ordinality as t(c, idx);

    return jsonb_build_object(
      'status', v_session.status,
      'questionIndex', v_session.current_question_index,
      'totalQuestions', array_length(v_session.question_order, 1),
      'promptLatex', v_question.prompt_latex,
      'questionText', v_question.question_text,
      'hint', v_question.hint,
      'timeLimitSeconds', v_question.time_limit_seconds,
      'questionStartedAt', v_session.current_question_started_at,
      'choices', coalesce(v_choices, '[]'::jsonb)
    );
  end if;

  -- reveal / finished: safe to show the full answer key.
  select jsonb_agg(
           jsonb_build_object(
             'index', idx - 1,
             'text', c ->> 'text',
             'isCorrect', (c ->> 'is_correct')::boolean
           ) order by idx
         )
    into v_choices
    from jsonb_array_elements(v_question.choices) with ordinality as t(c, idx);

  return jsonb_build_object(
    'status', v_session.status,
    'questionIndex', v_session.current_question_index,
    'totalQuestions', array_length(v_session.question_order, 1),
    'promptLatex', v_question.prompt_latex,
    'questionText', v_question.question_text,
    'hint', v_question.hint,
    'timeLimitSeconds', v_question.time_limit_seconds,
    'questionStartedAt', v_session.current_question_started_at,
    'choices', coalesce(v_choices, '[]'::jsonb),
    'explanation', v_question.explanation,
    'feedbackCorrect', v_question.feedback_correct,
    'feedbackIncorrect', v_question.feedback_incorrect,
    'tags', to_jsonb(v_question.tags)
  );
end;
$$;
revoke all on function public.get_active_question(uuid) from public;
grant execute on function public.get_active_question(uuid) to authenticated;

create or replace function public.submit_game_answer(p_session_id uuid, p_choice_index int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.game_sessions;
  v_player public.game_players;
  v_question_id uuid;
  v_time_limit_seconds int;
  v_choices jsonb;
  v_correct_index int;
  v_elapsed_ms int;
  v_is_correct boolean;
  v_within_time boolean;
  v_scored boolean;
  v_correct_rank int;
  v_base_points int := 0;
  v_streak_bonus int := 0;
  v_underdog_bonus int := 0;
  v_points_awarded int := 0;
  v_new_streak int := 0;
  v_total_players int;
  v_player_rank_before int;
  v_answer_id uuid;
  v_existing public.game_answers;
begin
  select * into v_session from game_sessions where id = p_session_id for update;
  if not found then
    raise exception 'Game not found';
  end if;
  if v_session.status <> 'question' then
    raise exception 'Not accepting answers right now';
  end if;

  select * into v_player from game_players
  where session_id = p_session_id and profile_id = auth.uid();
  if not found then
    raise exception 'You are not in this game';
  end if;

  v_question_id := v_session.question_order[v_session.current_question_index + 1];
  select time_limit_seconds, choices into v_time_limit_seconds, v_choices
  from game_questions where id = v_question_id;

  select (idx - 1) into v_correct_index
  from jsonb_array_elements(v_choices) with ordinality as t(c, idx)
  where (c ->> 'is_correct')::boolean is true
  limit 1;

  v_elapsed_ms := greatest(
    0,
    (extract(epoch from (now() - v_session.current_question_started_at)) * 1000)::int
  );
  v_is_correct := (p_choice_index = v_correct_index);
  v_within_time := v_elapsed_ms <= v_time_limit_seconds * 1000;
  v_scored := v_is_correct and v_within_time;

  if v_scored then
    select count(*) + 1 into v_correct_rank
    from game_answers
    where session_id = p_session_id
      and question_index = v_session.current_question_index
      and correct_rank is not null;

    -- Base points by rank: rank 2 deliberately outscores rank 1 (see the
    -- header comment on this migration for why), then tapers off with a floor.
    v_base_points := case
      when v_correct_rank = 1 then 800
      when v_correct_rank = 2 then 1000
      when v_correct_rank = 3 then 700
      when v_correct_rank = 4 then 600
      when v_correct_rank = 5 then 500
      else greatest(300, 500 - (v_correct_rank - 5) * 50)
    end;

    v_streak_bonus := round(v_base_points * least(v_player.current_streak, 5) * 0.1);

    select count(*) into v_total_players from game_players where session_id = p_session_id;
    select count(*) + 1 into v_player_rank_before
    from game_players gp2
    where gp2.session_id = p_session_id
      and (
        gp2.total_score > v_player.total_score
        or (gp2.total_score = v_player.total_score and gp2.joined_at < v_player.joined_at)
      );

    if v_total_players > 1 and v_player_rank_before > ceil(v_total_players / 2.0) then
      v_underdog_bonus := round((v_base_points + v_streak_bonus) * 0.2);
    end if;

    v_points_awarded := v_base_points + v_streak_bonus + v_underdog_bonus;
    v_new_streak := v_player.current_streak + 1;
  end if;

  insert into game_answers (
    session_id, player_id, question_id, question_index, choice_index,
    is_correct, response_ms, base_points, streak_bonus, underdog_bonus,
    points_awarded, correct_rank
  ) values (
    p_session_id, v_player.id, v_question_id, v_session.current_question_index, p_choice_index,
    v_is_correct, v_elapsed_ms, v_base_points, v_streak_bonus, v_underdog_bonus,
    v_points_awarded, v_correct_rank
  )
  on conflict (session_id, player_id, question_index) do nothing
  returning id into v_answer_id;

  if v_answer_id is null then
    select * into v_existing from game_answers
    where session_id = p_session_id and player_id = v_player.id
      and question_index = v_session.current_question_index;
    return jsonb_build_object(
      'alreadyAnswered', true,
      'isCorrect', v_existing.is_correct,
      'withinTimeLimit', v_existing.response_ms <= v_time_limit_seconds * 1000,
      'pointsAwarded', v_existing.points_awarded,
      'correctRank', v_existing.correct_rank
    );
  end if;

  update game_players
  set total_score = total_score + v_points_awarded,
      current_streak = v_new_streak,
      best_streak = greatest(best_streak, v_new_streak)
  where id = v_player.id;

  return jsonb_build_object(
    'alreadyAnswered', false,
    'isCorrect', v_is_correct,
    'withinTimeLimit', v_within_time,
    'pointsAwarded', v_points_awarded,
    'correctRank', v_correct_rank,
    'newStreak', v_new_streak
  );
end;
$$;
revoke all on function public.submit_game_answer(uuid, int) from public;
grant execute on function public.submit_game_answer(uuid, int) to authenticated;

create or replace function public.advance_game_session(p_session_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.game_sessions;
  v_order uuid[];
  v_next_index int;
  v_lucky_answer_id uuid;
  v_lucky_player_id uuid;
begin
  select * into v_session from game_sessions where id = p_session_id for update;
  if not found then
    raise exception 'Game not found';
  end if;
  if v_session.host_id <> auth.uid() then
    raise exception 'Forbidden';
  end if;

  if p_action = 'start' then
    if v_session.status <> 'lobby' then
      raise exception 'Game already started';
    end if;
    select array_agg(id order by random()) into v_order
    from game_questions where bank_id = v_session.bank_id;
    if v_order is null or array_length(v_order, 1) = 0 then
      raise exception 'This question bank has no questions';
    end if;
    update game_sessions
    set status = 'question', question_order = v_order, current_question_index = 0,
        current_question_started_at = now(), started_at = now()
    where id = p_session_id;

  elsif p_action = 'reveal' then
    if v_session.status <> 'question' then
      raise exception 'No active question to reveal';
    end if;
    -- Lucky bonus: one random scored answer for this question gets a small
    -- surprise on top, revealed alongside the correct answer.
    select id, player_id into v_lucky_answer_id, v_lucky_player_id
    from game_answers
    where session_id = p_session_id
      and question_index = v_session.current_question_index
      and points_awarded > 0
    order by random()
    limit 1;

    if v_lucky_answer_id is not null then
      update game_answers
      set lucky_bonus = 50, points_awarded = points_awarded + 50
      where id = v_lucky_answer_id;
      update game_players
      set total_score = total_score + 50
      where id = v_lucky_player_id;
    end if;

    update game_sessions set status = 'reveal' where id = p_session_id;

  elsif p_action = 'next' then
    if v_session.status <> 'reveal' then
      raise exception 'Reveal the current question before advancing';
    end if;
    v_next_index := v_session.current_question_index + 1;
    if v_next_index >= array_length(v_session.question_order, 1) then
      update game_sessions set status = 'finished', ended_at = now() where id = p_session_id;
    else
      update game_sessions
      set status = 'question', current_question_index = v_next_index,
          current_question_started_at = now()
      where id = p_session_id;
    end if;

  else
    raise exception 'Unknown action %', p_action;
  end if;

  return (select to_jsonb(s) from game_sessions s where s.id = p_session_id);
end;
$$;
revoke all on function public.advance_game_session(uuid, text) from public;
grant execute on function public.advance_game_session(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Seed: "Integration Techniques" question bank, transcribed from the
-- standalone quiz at platform/public/integration-quiz.html (which stays as
-- the untimed, no-login practice version -- this bank powers the live game).
-- ---------------------------------------------------------------------------

insert into public.game_question_banks (slug, title)
values ('integration-techniques', 'Choosing an Integration Technique')
on conflict (slug) do nothing;

insert into public.game_questions (
  bank_id, sort_order, prompt_latex, question_text, choices, hint,
  explanation, feedback_correct, feedback_incorrect, tags, time_limit_seconds
)
select
  (select id from public.game_question_banks where slug = 'integration-techniques'),
  (q ->> 'sort_order')::int,
  q ->> 'prompt_latex',
  q ->> 'question_text',
  q -> 'choices',
  q ->> 'hint',
  q ->> 'explanation',
  q ->> 'feedback_correct',
  q ->> 'feedback_incorrect',
  (select array_agg(t) from jsonb_array_elements_text(q -> 'tags') as t),
  (q ->> 'time_limit_seconds')::int
from jsonb_array_elements($seed$
[
  {
    "sort_order": 1,
    "prompt_latex": "\\int x\\,e^{x^{2}}\\,dx",
    "question_text": "What is the most appropriate technique?",
    "choices": [
      { "text": "Substitution $u = x^{2}$", "is_correct": true },
      { "text": "Integration by parts with $u = x$, $dv = e^{x^{2}}\\,dx$", "is_correct": false },
      { "text": "Rewrite as a standard integral of the form $\\int e^{kx}\\,dx$", "is_correct": false },
      { "text": "Partial fractions", "is_correct": false }
    ],
    "hint": "Is one factor the derivative (up to a constant) of the inside of the other?",
    "explanation": "The integrand has the structure $f'(x)\\,g(f(x))$: $x$ is a constant multiple of $\\frac{d}{dx}(x^{2})$. Substitution $u = x^{2}$ converts it to $\\int \\tfrac12 e^{u}\\,du$. By parts fails because $e^{x^{2}}$ has no elementary antiderivative; $e^{x^{2}}$ is not of the form $e^{kx}$; and partial fractions apply only to rational functions.",
    "feedback_correct": "Spotted the derivative.",
    "feedback_incorrect": "Look at the pairing of $x$ and $x^{2}$.",
    "tags": ["Substitution"],
    "time_limit_seconds": 15
  },
  {
    "sort_order": 2,
    "prompt_latex": "\\int x\\,e^{x}\\,dx",
    "question_text": "What is the most appropriate technique?",
    "choices": [
      { "text": "Substitution $u = x$", "is_correct": false },
      { "text": "Integration by parts with $u = x$, $dv = e^{x}\\,dx$", "is_correct": true },
      { "text": "Partial fractions", "is_correct": false },
      { "text": "Substitution $u = e^{x}$", "is_correct": false }
    ],
    "hint": "The two factors are unrelated — neither is the derivative of the other's inside.",
    "explanation": "Compare with Q1: here $x$ is not the derivative of anything inside $e^{x}$, so substitution gains nothing. A polynomial times an exponential is the classic by-parts case: differentiate the polynomial (it simplifies), integrate the exponential (it doesn't get worse). Partial fractions only apply to rational functions.",
    "feedback_correct": "Correct — the classic by-parts pairing.",
    "feedback_incorrect": "Contrast this with the previous question.",
    "tags": ["Integration by parts"],
    "time_limit_seconds": 15
  },
  {
    "sort_order": 3,
    "prompt_latex": "\\int \\frac{1}{x^{2}-5x+6}\\,dx",
    "question_text": "What is the most appropriate approach?",
    "choices": [
      { "text": "Complete the square in the denominator, then use the arctan form", "is_correct": false },
      { "text": "Factorise the denominator, then use partial fractions", "is_correct": true },
      { "text": "Substitution $u = x^{2}-5x+6$", "is_correct": false },
      { "text": "Polynomial division", "is_correct": false }
    ],
    "hint": "Check the discriminant of the denominator before deciding.",
    "explanation": "The discriminant is $25-24 = 1 > 0$, so the denominator factorises over the reals: $(x-2)(x-3)$. Partial fractions then give two $\\ln$ terms. Completing the square would produce a difference of squares, not a sum, so no arctan appears. Substitution $u = $ denominator needs $(2x-5)$ in the numerator, which is absent. Division is only for improper fractions.",
    "feedback_correct": "Two steps, correctly ordered.",
    "feedback_incorrect": "Factorise first — the discriminant is positive.",
    "tags": ["Factoring", "Partial fractions"],
    "time_limit_seconds": 15
  },
  {
    "sort_order": 4,
    "prompt_latex": "\\int \\frac{x^{2}+3}{x+1}\\,dx",
    "question_text": "What must be done first?",
    "choices": [
      { "text": "Partial fractions", "is_correct": false },
      { "text": "Polynomial (long) division", "is_correct": true },
      { "text": "Substitution $u = x^{2}+3$", "is_correct": false },
      { "text": "Integration by parts with $u = x^{2}+3$", "is_correct": false }
    ],
    "hint": "Compare the degrees of numerator and denominator.",
    "explanation": "The fraction is improper (degree 2 over degree 1). Partial fractions can only be applied to proper fractions, so division must come first: $\\frac{x^{2}+3}{x+1} = x-1+\\frac{4}{x+1}$. Each resulting term is then a standard integral. Substitution $u = x^{2}+3$ would need a numerator proportional to $2x$.",
    "feedback_correct": "Yes — divide before anything else.",
    "feedback_incorrect": "Is the fraction proper?",
    "tags": ["Polynomial division"],
    "time_limit_seconds": 15
  },
  {
    "sort_order": 5,
    "prompt_latex": "\\int \\frac{1}{x^{2}+4x+13}\\,dx",
    "question_text": "What is the most appropriate approach?",
    "choices": [
      { "text": "Factorise the denominator, then partial fractions", "is_correct": false },
      { "text": "Complete the square, then use the arctan standard form", "is_correct": true },
      { "text": "Substitution $u = x^{2}+4x+13$", "is_correct": false },
      { "text": "Polynomial division", "is_correct": false }
    ],
    "hint": "Check the discriminant again.",
    "explanation": "Discriminant $16-52<0$, so the quadratic does not factorise over the reals and partial fractions are unavailable. Completing the square gives $(x+2)^{2}+9$, which is the form $\\int \\frac{1}{u^{2}+a^{2}}\\,du = \\frac{1}{a}\\arctan\\frac{u}{a}$. Substitution $u = $ denominator fails because the numerator is constant, not $(2x+4)$.",
    "feedback_correct": "Irreducible quadratic handled correctly.",
    "feedback_incorrect": "Negative discriminant — it won't factorise.",
    "tags": ["Completing the square"],
    "time_limit_seconds": 15
  },
  {
    "sort_order": 6,
    "prompt_latex": "\\int \\sin^{2}x\\,dx",
    "question_text": "What is the most appropriate first manipulation?",
    "choices": [
      { "text": "Substitution $u = \\sin x$", "is_correct": false },
      { "text": "Integration by parts with $u = \\sin x$, $dv = \\sin x\\,dx$", "is_correct": false },
      { "text": "Apply the identity $\\sin^{2}x = \\tfrac12(1-\\cos 2x)$", "is_correct": true },
      { "text": "Treat it as a direct standard integral", "is_correct": false }
    ],
    "hint": "There is no $\\cos x$ factor available for a substitution.",
    "explanation": "Substitution $u = \\sin x$ needs a $\\cos x\\,dx$ to become $du$, and there is none. By parts works but loops back on itself. The power-reducing (double-angle) identity turns the integrand into $\\tfrac12 - \\tfrac12\\cos 2x$, both of which integrate directly. $\\sin^{2}x$ is not a standard integral in the formula booklet.",
    "feedback_correct": "Identity first — cleanest route.",
    "feedback_incorrect": "An identity removes the square.",
    "tags": ["Trigonometric identities"],
    "time_limit_seconds": 15
  },
  {
    "sort_order": 7,
    "prompt_latex": "\\int \\frac{x^{3}+2x}{x}\\,dx",
    "question_text": "What is the most appropriate first manipulation?",
    "choices": [
      { "text": "Partial fractions", "is_correct": false },
      { "text": "Substitution $u = x^{3}+2x$", "is_correct": false },
      { "text": "Simplify algebraically by dividing each term by $x$", "is_correct": true },
      { "text": "Integration by parts", "is_correct": false }
    ],
    "hint": "The denominator is a single term.",
    "explanation": "With a monomial denominator, split the fraction term by term: $\\frac{x^{3}+2x}{x} = x^{2}+2$, which integrates directly. Reaching for substitution or partial fractions here is over-engineering a problem that simplification dissolves. Always check for cancellation or term-wise division before choosing a heavier technique.",
    "feedback_correct": "Simplify before you integrate.",
    "feedback_incorrect": "Divide each term by $x$ first.",
    "tags": ["Algebraic simplification"],
    "time_limit_seconds": 15
  },
  {
    "sort_order": 8,
    "prompt_latex": "\\int \\frac{1}{\\sqrt{9-x^{2}}}\\,dx",
    "question_text": "What is the most appropriate approach?",
    "choices": [
      { "text": "Recognise it as the standard integral giving $\\arcsin\\frac{x}{3}$", "is_correct": true },
      { "text": "Complete the square", "is_correct": false },
      { "text": "Substitution $u = 9-x^{2}$", "is_correct": false },
      { "text": "Factorise $9-x^{2}$ and use partial fractions", "is_correct": false }
    ],
    "hint": "Compare with the forms in the formula booklet.",
    "explanation": "This is exactly $\\int \\frac{1}{\\sqrt{a^{2}-x^{2}}}\\,dx = \\arcsin\\frac{x}{a}+C$ with $a = 3$ — a booklet result, so no manipulation is needed. The trig substitution $x = 3\\sin\\theta$ is how that result is derived, but reproducing the derivation is unnecessary. Substitution $u = 9-x^{2}$ needs an $x$ in the numerator; partial fractions don't apply under a square root.",
    "feedback_correct": "Recognised the standard form.",
    "feedback_incorrect": "This one is in the formula booklet.",
    "tags": ["Direct standard integral"],
    "time_limit_seconds": 15
  },
  {
    "sort_order": 9,
    "prompt_latex": "\\int \\ln x\\,dx",
    "question_text": "What is the most appropriate technique?",
    "choices": [
      { "text": "Substitution $u = \\ln x$", "is_correct": false },
      { "text": "Direct standard integral", "is_correct": false },
      { "text": "Integration by parts with $u = \\ln x$, $dv = dx$", "is_correct": true },
      { "text": "Rewrite using a logarithm identity, then integrate directly", "is_correct": false }
    ],
    "hint": "Think of the integrand as $1\\cdot\\ln x$.",
    "explanation": "$\\ln x$ is not a standard integral, and substitution $u = \\ln x$ leaves $\\int u\\,e^{u}\\,du$, which is harder. Writing the integrand as $1\\cdot\\ln x$ and applying by parts with $u = \\ln x$, $dv = dx$ gives $x\\ln x - \\int 1\\,dx$. The same idea handles $\\arctan x$ and $\\arcsin x$.",
    "feedback_correct": "The hidden factor of 1.",
    "feedback_incorrect": "Insert a factor of 1 and integrate by parts.",
    "tags": ["Integration by parts"],
    "time_limit_seconds": 15
  },
  {
    "sort_order": 10,
    "prompt_latex": "\\int \\frac{2x+3}{x^{2}+3x+7}\\,dx",
    "question_text": "What is the most appropriate technique?",
    "choices": [
      { "text": "Factorise the denominator, then partial fractions", "is_correct": false },
      { "text": "Complete the square, then arctan", "is_correct": false },
      { "text": "Substitution $u = x^{2}+3x+7$ (the numerator is the derivative of the denominator)", "is_correct": true },
      { "text": "Polynomial division", "is_correct": false }
    ],
    "hint": "Differentiate the denominator and compare.",
    "explanation": "$\\frac{d}{dx}(x^{2}+3x+7) = 2x+3$, exactly the numerator, so the integrand is $\\frac{f'(x)}{f(x)}$ and integrates to $\\ln|f(x)|$. The discriminant $9-28<0$ rules out partial fractions; completing the square is only needed when the numerator is constant (as in Q5). Always test for the $f'/f$ pattern before anything else with rational integrands.",
    "feedback_correct": "The $f'/f$ pattern.",
    "feedback_incorrect": "Differentiate the denominator.",
    "tags": ["Substitution"],
    "time_limit_seconds": 15
  },
  {
    "sort_order": 11,
    "prompt_latex": "\\int x^{2}\\sin x\\,dx",
    "question_text": "What is the most appropriate approach?",
    "choices": [
      { "text": "Substitution $u = x^{2}$", "is_correct": false },
      { "text": "Integration by parts, applied twice", "is_correct": true },
      { "text": "Apply a trigonometric identity to $\\sin x$", "is_correct": false },
      { "text": "Substitution $u = \\sin x$", "is_correct": false }
    ],
    "hint": "What happens to the polynomial each time you differentiate it?",
    "explanation": "Polynomial times trig with unrelated factors is a by-parts case. Differentiating $x^{2}$ gives $2x$, then $2$, so two applications reduce the polynomial to a constant. Neither substitution works: $x^{2}$ is not paired with $2x$, and $\\sin x$ is not paired with $\\cos x$. Recognising in advance that the process must repeat is part of choosing the technique.",
    "feedback_correct": "Two rounds, planned in advance.",
    "feedback_incorrect": "Degree 2 means by parts more than once.",
    "tags": ["Integration by parts"],
    "time_limit_seconds": 15
  },
  {
    "sort_order": 12,
    "prompt_latex": "\\int \\frac{x+5}{x^{2}+4x+13}\\,dx",
    "question_text": "What is the most appropriate approach?",
    "choices": [
      { "text": "Partial fractions", "is_correct": false },
      { "text": "Split the numerator as $\\tfrac12(2x+4)+3$, then substitution for the first part and completing the square for the second", "is_correct": true },
      { "text": "Substitution $u = x^{2}+4x+13$ for the whole integrand", "is_correct": false },
      { "text": "Polynomial division, then complete the square", "is_correct": false }
    ],
    "hint": "Part of the numerator matches the derivative of the denominator, but not all of it.",
    "explanation": "The denominator's derivative is $2x+4$, and $x+5 = \\tfrac12(2x+4)+3$. The first piece is $f'/f \\to \\ln$; the constant remainder over the irreducible quadratic needs completing the square $\\to \\arctan$. The substitution alone doesn't work because the numerator isn't a multiple of $2x+4$; partial fractions fail (discriminant $<0$); the fraction is already proper, so no division.",
    "feedback_correct": "Both pieces identified.",
    "feedback_incorrect": "Split the numerator so part of it matches the derivative.",
    "tags": ["Substitution", "Completing the square"],
    "time_limit_seconds": 15
  },
  {
    "sort_order": 13,
    "prompt_latex": "\\int \\cos^{3}x\\,dx",
    "question_text": "What is the most appropriate approach?",
    "choices": [
      { "text": "Integration by parts with $u = \\cos^{2}x$, $dv = \\cos x\\,dx$", "is_correct": false },
      { "text": "Write $\\cos^{3}x = \\cos x\\,(1-\\sin^{2}x)$, then substitute $u = \\sin x$", "is_correct": true },
      { "text": "Apply the power-reducing identity as in $\\int \\sin^{2}x\\,dx$", "is_correct": false },
      { "text": "Substitution $u = \\cos x$", "is_correct": false }
    ],
    "hint": "Odd power of cosine: peel one factor off.",
    "explanation": "For an odd power, keep one $\\cos x$ as the future $du$ and convert the remaining even power with $\\cos^{2}x = 1-\\sin^{2}x$. Then $u = \\sin x$ gives $\\int (1-u^{2})\\,du$. Substitution $u = \\cos x$ fails because there is no $\\sin x$ available. Power-reduction identities are for even powers; by parts works but is far longer.",
    "feedback_correct": "Odd-power strategy.",
    "feedback_incorrect": "Save one $\\cos x$, convert the rest.",
    "tags": ["Trigonometric identities", "Substitution"],
    "time_limit_seconds": 15
  },
  {
    "sort_order": 14,
    "prompt_latex": "\\int \\frac{x^{2}+1}{x^{3}+x}\\,dx",
    "question_text": "What is the most appropriate first manipulation?",
    "choices": [
      { "text": "Partial fractions with denominator $x(x^{2}+1)$", "is_correct": false },
      { "text": "Factorise the denominator and cancel the common factor", "is_correct": true },
      { "text": "Substitution $u = x^{3}+x$", "is_correct": false },
      { "text": "Polynomial division", "is_correct": false }
    ],
    "hint": "Factorise both numerator and denominator before choosing anything.",
    "explanation": "$x^{3}+x = x(x^{2}+1)$, so the integrand collapses to $\\frac{1}{x}$ and integrates directly. Partial fractions would give the same answer after much more work (and a zero coefficient). Substitution $u = x^{3}+x$ needs $3x^{2}+1$ in the numerator. This is why simplification always precedes technique selection.",
    "feedback_correct": "Cancelled before committing.",
    "feedback_incorrect": "Factorise the denominator and look again.",
    "tags": ["Factoring", "Algebraic simplification"],
    "time_limit_seconds": 15
  },
  {
    "sort_order": 15,
    "prompt_latex": "\\int \\frac{x^{3}}{x^{2}+1}\\,dx",
    "question_text": "What is the most appropriate approach?",
    "choices": [
      { "text": "Partial fractions", "is_correct": false },
      { "text": "Substitution $u = x^{2}+1$ on the whole integrand", "is_correct": false },
      { "text": "Polynomial division, then substitution $u = x^{2}+1$ for the remainder term", "is_correct": true },
      { "text": "Integration by parts with $u = x^{3}$", "is_correct": false }
    ],
    "hint": "Improper fraction — but what does the remainder look like after dividing?",
    "explanation": "Degree 3 over degree 2 is improper, so divide: $\\frac{x^{3}}{x^{2}+1} = x - \\frac{x}{x^{2}+1}$. The $x$ integrates directly; the remainder $\\frac{x}{x^{2}+1}$ has numerator proportional to the derivative of the denominator, so substitution (the $f'/f$ pattern) gives $\\tfrac12\\ln(x^{2}+1)$. Partial fractions need a proper fraction and a reducible denominator — neither holds here.",
    "feedback_correct": "Division, then substitution.",
    "feedback_incorrect": "Divide first, then check the remainder.",
    "tags": ["Polynomial division", "Substitution"],
    "time_limit_seconds": 15
  },
  {
    "sort_order": 16,
    "prompt_latex": "\\int \\tan^{2}x\\,dx",
    "question_text": "What is the most appropriate first manipulation?",
    "choices": [
      { "text": "Substitution $u = \\tan x$", "is_correct": false },
      { "text": "Rewrite as $\\frac{\\sin^{2}x}{\\cos^{2}x}$ and integrate by parts", "is_correct": false },
      { "text": "Apply the identity $\\tan^{2}x = \\sec^{2}x - 1$, then integrate directly", "is_correct": true },
      { "text": "Treat it as a direct standard integral", "is_correct": false }
    ],
    "hint": "Which Pythagorean identity involves $\\tan$?",
    "explanation": "$\\tan^{2}x$ is not a standard integral, and $u = \\tan x$ needs a $\\sec^{2}x\\,dx$ that isn't present. The identity $1+\\tan^{2}x = \\sec^{2}x$ rewrites the integrand as $\\sec^{2}x - 1$, and both terms are booklet results ($\\tan x$ and $x$). Recognising which identity connects a function to a known derivative is the whole skill here.",
    "feedback_correct": "Pythagorean identity, then direct.",
    "feedback_incorrect": "Use the identity linking $\\tan^{2}$ and $\\sec^{2}$.",
    "tags": ["Trigonometric identities", "Direct standard integral"],
    "time_limit_seconds": 15
  }
]
$seed$::jsonb) as q
on conflict (bank_id, sort_order) do nothing;
