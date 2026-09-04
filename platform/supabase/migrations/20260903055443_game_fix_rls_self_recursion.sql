-- The previous fix (game_fix_rls_recursion.sql) broke the cross-table
-- game_sessions <-> game_players recursion but left one raw self-referencing
-- EXISTS on game_players itself ("am I a fellow player in this session" via
-- `exists (select 1 from game_players me where ...)`). A live smoke test
-- immediately hit the same 42P17 for that policy too: a self-referencing
-- subquery inside an RLS policy re-triggers that same policy for every
-- candidate row it scans, which Postgres does not unfold. Replace it with
-- the same is_game_player() SECURITY DEFINER helper used elsewhere, which
-- bypasses RLS entirely and so cannot recurse.

drop policy "session participants can read players" on public.game_players;
create policy "session participants can read players" on public.game_players
  for select using (is_game_host(session_id) or is_game_player(session_id));
