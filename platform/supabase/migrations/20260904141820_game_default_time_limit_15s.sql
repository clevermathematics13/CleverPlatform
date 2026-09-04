-- Default answer window for a new game session, 10s -> 15s. Still
-- teacher-adjustable per session (see game_session_time_limit.sql); this
-- only changes what a brand-new session starts at before the teacher
-- touches the "Seconds per question" field in the lobby. Existing sessions
-- keep whatever value they already have.

alter table public.game_sessions
  alter column time_limit_seconds set default 15;
