-- Teacher-adjustable per-game answer timer, defaulting to 10s (was a fixed
-- 15s read from game_questions.time_limit_seconds). The session-level value
-- is now the single source of truth for scoring and for what students see;
-- game_questions.time_limit_seconds is left in place but no longer read --
-- changing the per-question seed data has no effect. The teacher sets this
-- in the lobby, before starting; RLS's existing "host manages own session"
-- update policy already covers the write, so no new RPC is needed for that.

alter table public.game_sessions
  add column time_limit_seconds int not null default 10
  check (time_limit_seconds between 3 and 120);

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
      'timeLimitSeconds', v_session.time_limit_seconds,
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
    'timeLimitSeconds', v_session.time_limit_seconds,
    'questionStartedAt', v_session.current_question_started_at,
    'choices', coalesce(v_choices, '[]'::jsonb),
    'explanation', v_question.explanation,
    'feedbackCorrect', v_question.feedback_correct,
    'feedbackIncorrect', v_question.feedback_incorrect,
    'tags', to_jsonb(v_question.tags)
  );
end;
$$;

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
  v_time_limit_seconds := v_session.time_limit_seconds;
  select choices into v_choices from game_questions where id = v_question_id;

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
    -- header comment on game_live_kahoot.sql for why), then tapers off with a floor.
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
