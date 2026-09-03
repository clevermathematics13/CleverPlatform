-- Fixes 42P17 "infinite recursion detected in policy for relation
-- game_sessions", found by a live smoke test right after
-- game_live_kahoot.sql shipped: the game_sessions SELECT policy checked
-- game_players (is the caller a player in this session?), and the
-- game_players SELECT policy checked game_sessions back (is the caller the
-- host?). Two different tables whose RLS policies each query the other form
-- a cycle Postgres cannot unfold -- unlike a same-table self-referencing
-- EXISTS (e.g. "am I a fellow player" within game_players itself), which is
-- fine and stays as-is below.
--
-- Fix: two small SECURITY DEFINER helper functions. Because they're owned
-- by the migration role (which owns these tables), they bypass RLS
-- entirely when queried from inside a policy, breaking the cycle -- the
-- same trick this migration's own submit_game_answer/advance_game_session
-- already rely on for their direct table access.

create or replace function public.is_game_host(p_session_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from game_sessions s where s.id = p_session_id and s.host_id = auth.uid()
  );
$$;
revoke all on function public.is_game_host(uuid) from public;
grant execute on function public.is_game_host(uuid) to authenticated;

create or replace function public.is_game_player(p_session_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from game_players p where p.session_id = p_session_id and p.profile_id = auth.uid()
  );
$$;
revoke all on function public.is_game_player(uuid) from public;
grant execute on function public.is_game_player(uuid) to authenticated;

drop policy "host or player can read a session" on public.game_sessions;
create policy "host or player can read a session" on public.game_sessions
  for select using (host_id = auth.uid() or is_game_player(id));

drop policy "session participants can read players" on public.game_players;
create policy "session participants can read players" on public.game_players
  for select using (
    is_game_host(session_id)
    or exists (
      select 1 from public.game_players me
      where me.session_id = game_players.session_id and me.profile_id = auth.uid()
    )
  );

drop policy "host can remove a player" on public.game_players;
create policy "host can remove a player" on public.game_players
  for delete using (is_game_host(session_id));

drop policy "host or the answering player can read answers" on public.game_answers;
create policy "host or the answering player can read answers" on public.game_answers
  for select using (
    is_game_host(session_id)
    or exists (
      select 1 from public.game_players gp
      where gp.id = game_answers.player_id and gp.profile_id = auth.uid()
    )
  );
